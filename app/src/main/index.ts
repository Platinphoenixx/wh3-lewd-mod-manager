import { appendFileSync, existsSync, readdirSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, crashReporter, dialog, ipcMain, net, protocol, shell } from 'electron'
import type { FileHint } from '@shared/install'
import { DEFAULTS, type GameScan, type RelayContribution, type RelayReport, type RelayResult, type ScriptReport, type Settings } from '@shared/api'
import { parseLuaLog } from '@shared/health'
import { parseCaModdata, parseTwmods, parseWh3mm, type ImportSource } from '@shared/importlist'
import type { Contribution, UserRule } from '@shared/community'
import type { Profile } from '@shared/profile'
import type { LaunchSnapshot } from '@shared/report'
import type { SharedSetup } from '@shared/setups'
import { loadCatalog } from './catalog'
import { scanGame } from './game'
import { cachedPackIndex, packConflicts, packFacts } from './pack'
import { launchGame } from './launch'
import { checkAppUpdate } from './appUpdate'
import { accept, clearToken, listReview, reject, setToken, status as maintainerStatus } from './maintainer'
import { subscribeWorkshop, workshopDetails } from './steam'
import {
  backupPacks, downloadFromLoversLab, downloadFromNexus, downloadQueueFromLoversLab, installFile, installFiles, setCatalogPacks, type InstalledRecord, type QueueJob
} from './installer'
import {
  addContribution, deleteProfile, getSettings, listContributions, listProfiles, listRules, readJson, saveProfile, saveRules, saveSettings, writeJson
} from './store'

// WH3LMM_USER_DATA puts profiles/settings into another folder (portable use, tests with throwaway data).
if (process.env.WH3LMM_USER_DATA) app.setPath('userData', process.env.WH3LMM_USER_DATA)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'WH3 Lewd Mod Manager',
    backgroundColor: '#141311',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  // Links in mod descriptions open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // --tab=<name> opens a given tab first (handy for checking a view after a change).
  const tab = process.argv.find((a) => a.startsWith('--tab='))?.slice(6)
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + (tab ? `#${tab}` : ''))
  else void win.loadFile(join(__dirname, '../renderer/index.html'), tab ? { hash: tab } : undefined)
}

// The installer gives downloaded packs their catalog names (Discord drops a leading "@" or "!") and keeps old optional
// copies from overwriting a fixed one; it asks the catalog the app uses.
let catalogNow: ReturnType<typeof loadCatalog> | null = null
const currentCatalog = async () => (catalogNow ??= loadCatalog((await getSettings()).catalogUrl || DEFAULTS.catalogUrl))
setCatalogPacks(async (id) => {
  const mods = (await currentCatalog()).mods
  return id ? mods.find((m) => m.id === id)?.packs ?? [] : mods.flatMap((m) => m.packs)
})
ipcMain.handle('catalog:get', async () => (catalogNow = loadCatalog((await getSettings()).catalogUrl || DEFAULTS.catalogUrl)))
ipcMain.handle('rules:list', () => listRules())
ipcMain.handle('rules:save', (_e, r: UserRule[]) => saveRules(r))
ipcMain.handle('contributions:list', () => listContributions())
ipcMain.handle('contributions:add', (_e, c: Contribution) => addContribution(c))
// Every scan knows which data packs this app installed and for which mod (installed.json).
let lastScan: GameScan | null = null
const currentScan = async () =>
  (lastScan = await scanGame((await getSettings()).gamePath, await readJson<InstalledRecord[]>('installed.json', [])))
ipcMain.handle('install:file', async (e, modId?: string) => {
  const scan = await currentScan()
  if (!scan.dataPath) return { ok: false, message: 'The game folder was not found.', packs: [] }
  const pick = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
    title: 'Choose a downloaded mod file',
    properties: ['openFile'],
    filters: [{ name: 'Mod files', extensions: ['pack', '7z', 'zip', 'rar'] }]
  })
  // The picked download is moved into the game, not copied: nothing is left behind in Downloads.
  return pick.canceled ? { ok: false, message: '', packs: [] } : installFile(pick.filePaths[0], scan.dataPath, modId, true)
})
ipcMain.handle('install:loverslab', async (e, url: string, modId?: string, hints?: FileHint[]) => {
  const scan = await currentScan()
  if (!scan.dataPath) return { ok: false, message: 'The game folder was not found.', packs: [] }
  if (!/^https:\/\/www\.loverslab\.com\/files\/file\//.test(url)) return { ok: false, message: 'Not a LoversLab file page.', packs: [] }
  return downloadFromLoversLab(url, scan.dataPath, modId, BrowserWindow.fromWebContents(e.sender), hints ?? [])
})
ipcMain.handle('install:loverslabQueue', async (e, jobs: QueueJob[]) => {
  const scan = await currentScan()
  if (!scan.dataPath) return []
  const valid = jobs.filter((j) => /^https:\/\/www\.loverslab\.com\/files\/file\//.test(j.url))
  return downloadQueueFromLoversLab(valid, scan.dataPath, BrowserWindow.fromWebContents(e.sender), (p) => e.sender.send('install:queue', p))
})
ipcMain.handle('install:paths', async (_e, paths: string[]) => {
  const scan = await currentScan()
  if (!scan.dataPath) return { ok: false, message: 'The game folder was not found.', packs: [] }
  return installFiles(paths.filter((p) => typeof p === 'string'), scan.dataPath)
})
// Only Nexus Mods pages of this game open in the Nexus window.
ipcMain.handle('install:nexus', async (e, url: string, modId?: string, hints?: FileHint[]) => {
  const scan = await currentScan()
  if (!scan.dataPath) return { ok: false, message: 'The game folder was not found.', packs: [] }
  if (!/^https:\/\/www\.nexusmods\.com\/totalwarwarhammer3\/mods\/\d+/.test(url)) return { ok: false, message: 'Not a Nexus Mods page of this game.', packs: [] }
  return downloadFromNexus(url, scan.dataPath, modId, BrowserWindow.fromWebContents(e.sender), hints ?? [])
})
ipcMain.handle('install:backup', async (_e, paths: string[]) => {
  const scan = await currentScan()
  const dataPacks = new Set(scan.packs.filter((p) => p.source === 'data').map((p) => p.path))
  return scan.dataPath ? backupPacks(paths.filter((p) => dataPacks.has(p)), scan.dataPath) : { moved: [], folder: '' }
})
ipcMain.handle('steam:subscribe', (e, ids: string[]) => subscribeWorkshop(ids.filter((x) => /^\d{6,12}$/.test(x)), e.sender))
// The snapshot of what was started is kept for problem reports; the renderer hears when the game closes.
ipcMain.handle('game:launch', async (e, paths: string[], snapshot?: LaunchSnapshot) => {
  const startedAt = Date.now()
  const r = await launchGame(await currentScan(), paths, (ranMs) => !e.sender.isDestroyed() && e.sender.send('game:exited', { startedAt, ranMs }))
  if (r.ok && snapshot) await writeJson('last-launch.json', { ...snapshot, at: startedAt })
  return r
})
ipcMain.handle('game:lastLaunch', () => readJson<LaunchSnapshot | null>('last-launch.json', null))
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:build', () => __BUILD_INFO__)
ipcMain.handle('app:home', () => homedir())
ipcMain.handle('app:update', async () => checkAppUpdate((await getSettings()).contribRepo || DEFAULTS.contribRepo))

// The relay gets only what the player saw in the dialog, plus a random id made once on this PC so the
// weekly update can count players instead of reports.
async function relay(path: string, body: object): Promise<RelayResult> {
  const base = ((await getSettings()).relayUrl || DEFAULTS.relayUrl).replace(/\/$/, '')
  if (!base) return { ok: false, message: 'Sending is not set up yet.' }
  try {
    const res = await net.fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const r = (await res.json().catch(() => ({}))) as Partial<RelayResult>
    return { ok: res.ok && !!r.ok, message: r.message ?? `The relay answered ${res.status}.`, url: r.url }
  } catch (e) {
    return { ok: false, message: `Could not reach the relay: ${(e as Error).message}` }
  }
}
async function installId(): Promise<string> {
  const saved = await readJson<{ id?: string }>('install-id.json', {})
  if (saved.id) return saved.id
  const id = crypto.randomUUID()
  await writeJson('install-id.json', { id })
  return id
}
ipcMain.handle('relay:report', async (_e, r: RelayReport) => relay('/report', { ...r, installId: await installId() }))
ipcMain.handle('relay:contribution', (_e, c: RelayContribution) => relay('/contribution', c))
ipcMain.handle('relay:setup', async (_e, s: SharedSetup) =>
  relay('/setup', { ...s, app: app.getVersion(), installId: await installId() }))
// Maintainer access (maintainer.ts): the catalog repository from the settings, as for contributions.
const repo = async () => (await getSettings()).contribRepo || DEFAULTS.contribRepo
ipcMain.handle('maint:status', async () => maintainerStatus(await repo()))
ipcMain.handle('maint:setToken', async (_e, t: string) => setToken(await repo(), t))
ipcMain.handle('maint:clear', () => clearToken())
ipcMain.handle('maint:list', async () => listReview(await repo()))
ipcMain.handle('maint:accept', async (_e, n: number) => accept(await repo(), n))
ipcMain.handle('maint:reject', async (_e, n: number, reason: string) => reject(await repo(), n, reason))
ipcMain.handle('relay:vote', async (_e, v: { setup: string; worked: boolean; reason?: string }) => relay('/vote', { ...v, installId: await installId() }))
ipcMain.handle('dialog:saveText', async (e, name: string, text: string) => {
  const pick = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, {
    defaultPath: name.replace(/[<>:"/\\|?*]/g, '_'), filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }]
  })
  if (pick.canceled || !pick.filePath) return null
  await writeFile(pick.filePath, text, 'utf8')
  return pick.filePath
})
// Only paths the last game scan found may be opened (the renderer never names arbitrary files).
ipcMain.handle('packs:conflicts', async (_e, paths: string[]) => {
  const known = new Set((await currentScan()).packs.map((p) => p.path))
  return packConflicts(paths.filter((p) => known.has(p)))
})
ipcMain.handle('packs:facts', async (_e, paths: string[]) => {
  const known = new Set((await currentScan()).packs.map((p) => p.path))
  return packFacts(paths.filter((p) => known.has(p)))
})
ipcMain.handle('steam:details', (_e, ids: string[]) => workshopDetails(ids.filter((x) => /^\d{6,12}$/.test(x))))
ipcMain.handle('game:scan', () => currentScan())
// Mod lists of other launchers on this PC; read only, never changed.
ipcMain.handle('import:sources', async () => {
  const out: ImportSource[] = []
  const ca = join(app.getPath('appData'), 'The Creative Assembly', 'Launcher', '20190104-moddata.dat')
  try {
    const mods = parseCaModdata(await readFile(ca, 'utf8'))
    if (mods.length) out.push({ id: 'ca:current', label: 'CA launcher – current mod list', mods })
  } catch { /* no CA launcher data */ }
  try {
    out.push(...parseWh3mm(await readFile(join(app.getPath('appData'), 'wh3mm', 'config.json'), 'utf8')))
  } catch { /* no WH3 Mod Manager */ }
  return out
})
ipcMain.handle('import:twmods', async (e) => {
  const pick = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
    title: 'Choose a mod profile exported by the CA launcher', properties: ['openFile'], filters: [{ name: 'Mod profile', extensions: ['twmods'] }]
  })
  if (pick.canceled) return null
  const file = pick.filePaths[0]
  return { id: `twmods:${file}`, label: basename(file), mods: parseTwmods(await readFile(file, 'utf8')) }
})
ipcMain.handle('game:scriptReport', async (): Promise<ScriptReport> => {
  const scan = await currentScan()
  const file = scan.gamePath ? join(scan.gamePath, 'lua_mod_log.txt') : ''
  if (!file || !existsSync(file)) return { written: null, loaded: 0, failed: [] }
  const log = parseLuaLog(await readFile(file, 'utf8'))
  // Which installed packs contain the failing scripts (vanilla scripts have none).
  const owners = new Map<string, string[]>()
  if (log.failed.some((f) => f.script)) {
    for (const p of scan.packs) {
      try {
        for (const f of (await cachedPackIndex(p.path)).files) if (f.path.endsWith('.lua')) owners.set(f.path, [...(owners.get(f.path) ?? []), p.path])
      } catch { /* unreadable pack */ }
    }
  }
  return {
    written: (await stat(file)).mtimeMs,
    loaded: log.loaded.length,
    failed: log.failed.map((f) => ({ ...f, packs: f.script ? owners.get(f.script) ?? [] : [] }))
  }
})
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url)
})
ipcMain.handle('profiles:list', () => listProfiles())
ipcMain.handle('profiles:save', (_e, p: Profile) => saveProfile(p))
ipcMain.handle('profiles:delete', (_e, id: string) => deleteProfile(id))
ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('settings:save', (_e, s: Settings) => saveSettings(s))
ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Choose the Total War WARHAMMER III folder' })
  return r.canceled ? null : r.filePaths[0]
})

// wh3lmm://workshop/<id> serves the preview image Steam puts next to a Workshop item's pack.
protocol.registerSchemesAsPrivileged([{ scheme: 'wh3lmm', privileges: { standard: true, secure: true } }])

async function workshopPreview(id: string): Promise<Response> {
  if (!/^\d{6,12}$/.test(id)) return new Response(null, { status: 404 })
  for (const dir of (lastScan ?? (await currentScan())).workshopPaths) {
    const item = join(dir, id)
    const png = existsSync(item) ? readdirSync(item).find((f) => f.toLowerCase().endsWith('.png')) : undefined
    if (png) return net.fetch(pathToFileURL(join(item, png)).toString())
  }
  return new Response(null, { status: 404 })
}

crashReporter.start({ uploadToServer: false })
const crashLog = (text: string) => {
  try {
    appendFileSync(join(app.getPath('userData'), 'queue.log'), `${new Date().toISOString()} ${text}\n`)
  } catch {
    // never let logging fail the app
  }
}
app.on('render-process-gone', (_e, _w, d) => crashLog(`renderer gone: ${d.reason} (${d.exitCode})`))
app.on('child-process-gone', (_e, d) => crashLog(`child process gone: ${d.type} ${d.reason} (${d.exitCode})`))
process.on('uncaughtException', (err) => crashLog(`uncaught: ${err.stack ?? err}`))
app.on('will-quit', () => crashLog('app quits'))

app.whenReady().then(() => {
  protocol.handle('wh3lmm', (req) => {
    const u = new URL(req.url)
    return u.host === 'workshop' ? workshopPreview(u.pathname.slice(1)) : new Response(null, { status: 404 })
  })
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => app.quit())
