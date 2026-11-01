import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { DEFAULTS, type Settings } from '@shared/api'
import type { Contribution, UserRule } from '@shared/community'
import type { Profile } from '@shared/profile'
import { loadCatalog } from './catalog'
import { scanGame } from './game'
import { packConflicts } from './pack'
import { launchGame } from './launch'
import { subscribeWorkshop } from './steam'
import { backupPacks, downloadFromLoversLab, installFile, type InstalledRecord } from './installer'
import {
  addContribution, deleteProfile, getSettings, listContributions, listProfiles, listRules, readJson, saveProfile, saveRules, saveSettings
} from './store'

// WH3LMM_USER_DATA puts profiles/settings into another folder (portable use, tests with throwaway data).
if (process.env.WH3LMM_USER_DATA) app.setPath('userData', process.env.WH3LMM_USER_DATA)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'WH3 Lewd Mod Manager',
    backgroundColor: '#15131a',
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

ipcMain.handle('catalog:get', async () => loadCatalog((await getSettings()).catalogUrl || DEFAULTS.catalogUrl))
ipcMain.handle('rules:list', () => listRules())
ipcMain.handle('rules:save', (_e, r: UserRule[]) => saveRules(r))
ipcMain.handle('contributions:list', () => listContributions())
ipcMain.handle('contributions:add', (_e, c: Contribution) => addContribution(c))
// Every scan knows which data packs this app installed and for which mod (installed.json).
const currentScan = async () =>
  scanGame((await getSettings()).gamePath, await readJson<InstalledRecord[]>('installed.json', []))
ipcMain.handle('install:file', async (e, modId?: string) => {
  const scan = await currentScan()
  if (!scan.dataPath) return { ok: false, message: 'The game folder was not found.', packs: [] }
  const pick = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
    title: 'Choose a downloaded mod file',
    properties: ['openFile'],
    filters: [{ name: 'Mod files', extensions: ['pack', '7z', 'zip', 'rar'] }]
  })
  return pick.canceled ? { ok: false, message: '', packs: [] } : installFile(pick.filePaths[0], scan.dataPath, modId)
})
ipcMain.handle('install:loverslab', async (e, url: string, modId?: string) => {
  const scan = await currentScan()
  if (!scan.dataPath) return { ok: false, message: 'The game folder was not found.', packs: [] }
  if (!/^https:\/\/www\.loverslab\.com\/files\/file\//.test(url)) return { ok: false, message: 'Not a LoversLab file page.', packs: [] }
  return downloadFromLoversLab(url, scan.dataPath, modId, BrowserWindow.fromWebContents(e.sender))
})
ipcMain.handle('install:backup', async (_e, paths: string[]) => {
  const scan = await currentScan()
  const dataPacks = new Set(scan.packs.filter((p) => p.source === 'data').map((p) => p.path))
  return scan.dataPath ? backupPacks(paths.filter((p) => dataPacks.has(p)), scan.dataPath) : { moved: [], folder: '' }
})
ipcMain.handle('steam:subscribe', (e, ids: string[]) => subscribeWorkshop(ids.filter((x) => /^\d{6,12}$/.test(x)), e.sender))
ipcMain.handle('game:launch', async (_e, paths: string[]) => launchGame(await currentScan(), paths))
// Only paths the last game scan found may be opened (the renderer never names arbitrary files).
ipcMain.handle('packs:conflicts', async (_e, paths: string[]) => {
  const known = new Set((await currentScan()).packs.map((p) => p.path))
  return packConflicts(paths.filter((p) => known.has(p)))
})
ipcMain.handle('game:scan', () => currentScan())
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

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => app.quit())
