import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, session, type DownloadItem } from 'electron'
import { path7za } from '7zip-bin'
import { createExtractorFromFile } from 'node-unrar-js'
import { readJson, writeJson } from './store'

const run = promisify(execFile)

/** What the app put into the data folder, so it can tell its own files from others and remove them. */
export interface InstalledRecord {
  pack: string
  modId?: string
  source: string // archive or pack the file came from
  installedAt: string
}

export interface InstallResult {
  ok: boolean
  message: string
  packs: string[]
}

const ARCHIVES = new Set(['.7z', '.zip', '.rar'])

async function listPacks(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listPacks(p)))
    else if (e.name.toLowerCase().endsWith('.pack')) out.push(p)
  }
  return out
}

async function extract(archive: string, target: string): Promise<void> {
  if (extname(archive).toLowerCase() === '.rar') {
    const extractor = await createExtractorFromFile({ filepath: archive, targetPath: target })
    // extract() is lazy: walking the files is what writes them.
    for (const _ of extractor.extract().files) void _
  } else {
    // 7za keeps archive paths below the target (-o) and refuses absolute/parent paths by default.
    await run(path7za.replace('app.asar', 'app.asar.unpacked'), ['x', '-y', `-o${target}`, archive], { windowsHide: true })
  }
}

/**
 * Installs a downloaded .pack or archive into the game's data folder. Only .pack files are copied;
 * anything else in an archive (readmes, images, scripts) is ignored.
 */
export async function installFile(file: string, dataPath: string, modId?: string): Promise<InstallResult> {
  const ext = extname(file).toLowerCase()
  if (ext !== '.pack' && !ARCHIVES.has(ext)) return { ok: false, message: `Unsupported file type: ${basename(file)}`, packs: [] }
  let temp: string | null = null
  try {
    let packs: string[]
    if (ext === '.pack') packs = [file]
    else {
      temp = await mkdtemp(join(app.getPath('temp'), 'wh3lmm-'))
      await extract(file, temp)
      packs = await listPacks(temp)
      if (!packs.length) return { ok: false, message: `${basename(file)} contains no .pack file.`, packs: [] }
    }
    const records = await readJson<InstalledRecord[]>('installed.json', [])
    for (const p of packs) {
      await copyFile(p, join(dataPath, basename(p)))
      const rec: InstalledRecord = { pack: basename(p), modId, source: basename(file), installedAt: new Date().toISOString() }
      const i = records.findIndex((r) => r.pack.toLowerCase() === rec.pack.toLowerCase())
      if (i >= 0) records[i] = rec
      else records.push(rec)
    }
    await writeJson('installed.json', records)
    return { ok: true, message: `Installed ${packs.map((p) => basename(p)).join(', ')}`, packs: packs.map((p) => basename(p)) }
  } catch (e) {
    return { ok: false, message: `Installing ${basename(file)} failed: ${(e as Error).message}`, packs: [] }
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true })
  }
}

/** Moves data-folder packs into a dated backup folder (never deletes). */
export async function backupPacks(paths: string[], dataPath: string): Promise<{ moved: string[]; folder: string }> {
  const folder = join(app.getPath('userData'), 'backup', new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(folder, { recursive: true })
  const moved: string[] = []
  for (const p of paths) {
    // Only files directly inside the data folder are touched.
    if (join(p, '..').toLowerCase() !== dataPath.toLowerCase() || !existsSync(p)) continue
    const dest = join(folder, basename(p))
    try {
      await rename(p, dest)
    } catch {
      await copyFile(p, dest) // across drives rename fails; copy then remove
      await rm(p)
    }
    moved.push(basename(p))
  }
  return { moved, folder }
}

// Runs on every LL page in that window: an info bar, and "Remember me" ticked on the login form,
// because without it LL only sets session cookies and the login is gone after closing the app.
const LL_BANNER = `(() => {
  const remember = document.querySelector('input[type=checkbox][name=remember_me]')
  if (remember) remember.checked = true
  if (document.getElementById('wh3lmm-banner')) return
  const b = document.createElement('div')
  b.id = 'wh3lmm-banner'
  b.textContent = 'WH3 Lewd Mod Manager: LoversLab only allows downloads when you are logged in. Sign in here once with "Remember me" ticked (this window then keeps the login), then click "Download" and pick the file. It is installed automatically and this window closes.'
  b.style.cssText = 'position:sticky;top:0;z-index:2147483647;background:#7a2f5b;color:#fff;font:15px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center'
  document.body.prepend(b)
})()`

/**
 * Opens a LoversLab download page in its own window (persistent LL login, separate from the app).
 * When the user picks a file, it is saved to the app's download folder and installed.
 */
export function downloadFromLoversLab(url: string, dataPath: string, modId: string | undefined, parent: BrowserWindow | null): Promise<InstallResult> {
  const ses = session.fromPartition('persist:loverslab')
  const win = new BrowserWindow({ width: 1100, height: 800, parent: parent ?? undefined, title: 'LoversLab – sign in, then pick the file to install', webPreferences: { session: ses } })
  const downloads = join(app.getPath('userData'), 'downloads')
  return new Promise((resolve) => {
    let done = false
    const finish = (r: InstallResult) => {
      if (done) return
      done = true
      ses.removeListener('will-download', onDownload)
      if (!win.isDestroyed()) win.close()
      resolve(r)
    }
    const onDownload = (_e: unknown, item: DownloadItem) => {
      void mkdir(downloads, { recursive: true }).then(() => {
        const target = join(downloads, basename(item.getFilename()))
        item.setSavePath(target)
        item.once('done', async (_ev, state) => {
          if (state !== 'completed') return finish({ ok: false, message: `Download ${state}.`, packs: [] })
          const s = await stat(target)
          if (!s.size) return finish({ ok: false, message: 'Empty download.', packs: [] })
          const r = await installFile(target, dataPath, modId)
          // The packs are in data now; the archive would only fill up the app folder.
          if (r.ok) await rm(target, { force: true })
          finish(r)
        })
      })
    }
    ses.on('will-download', onDownload)
    win.on('closed', () => finish({ ok: false, message: 'Window closed without downloading.', packs: [] }))
    // Keep our title instead of the page's, and show what to do on every LL page.
    win.on('page-title-updated', (e) => e.preventDefault())
    win.webContents.on('did-finish-load', () => void win.webContents.executeJavaScript(LL_BANNER).catch(() => {}))
    void win.loadURL(url)
  })
}
