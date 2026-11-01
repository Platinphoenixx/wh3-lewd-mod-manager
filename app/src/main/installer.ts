import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, session, type DownloadItem } from 'electron'
import { path7za } from '7zip-bin'
import { createExtractorFromFile } from 'node-unrar-js'
import { readJson, writeJson } from './store'
import { pickDownloads, type DownloadRow } from '@shared/install'
import type { LoversLabJob, LoversLabProgress } from '@shared/api'

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

/** Installs several files at once (files dropped onto the window). */
export async function installFiles(files: string[], dataPath: string): Promise<InstallResult> {
  const results = []
  for (const f of files) results.push(await installFile(f, dataPath))
  return {
    ok: results.some((r) => r.ok),
    message: results.map((r) => r.message).filter(Boolean).join(' · '),
    packs: results.flatMap((r) => r.packs)
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

// Runs on every LL page in the app's LL windows: an info bar, and "Remember me" ticked on the login
// form, because without it LL only sets session cookies and the login is gone after closing the app.
const bannerScript = (text: string) => `(() => {
  const remember = document.querySelector('input[type=checkbox][name=remember_me]')
  if (remember) remember.checked = true
  let b = document.getElementById('wh3lmm-banner')
  if (!b) {
    b = document.createElement('div')
    b.id = 'wh3lmm-banner'
    b.style.cssText = 'position:sticky;top:0;z-index:2147483647;background:#c9a25a;color:#1a140a;font:15px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center'
    document.body.prepend(b)
  }
  b.textContent = ${JSON.stringify(text)}
})()`
const LOGIN_HINT = 'LoversLab only allows downloads when you are logged in. Sign in here once with "Remember me" ticked (this window then keeps the login).'
const LL_BANNER = bannerScript(`WH3 Lewd Mod Manager: ${LOGIN_HINT} Then click "Download" and pick the file. It is installed automatically and this window closes.`)

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

export type QueueJob = LoversLabJob
export type QueueProgress = LoversLabProgress

// Files listed on a LoversLab download page (a page with several files).
const ROWS_JS = `[...document.querySelectorAll('li.ipsDataItem, .ipsDataItem')].map(row => {
  const a = row.querySelector('a[href*="do=download"][href*="r="]')
  const t = row.querySelector('.ipsType_break, h4, .ipsDataItem_title') || row
  return a ? { href: a.href, name: t.textContent.trim().split(/\\s*\\n/)[0].trim() } : null
}).filter(Boolean)`

const FILE_LIMIT_MS = 15 * 60 * 1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Downloads several mods from LoversLab one after another in one visible window, with the saved
 * login, and installs each. Nothing is clicked for the player: with a free account LoversLab shows
 * its wait page before every download, and the queue simply waits until LoversLab hands out the file
 * (or the player clicks its Download button). On pages with several files the queue takes the
 * downloads the profile needs (pickDownloads); when that is unclear, the player picks the file.
 */
export async function downloadQueueFromLoversLab(
  jobs: QueueJob[],
  dataPath: string,
  parent: BrowserWindow | null,
  progress: (p: QueueProgress) => void
): Promise<{ modId: string; ok: boolean; message: string }[]> {
  const ses = session.fromPartition('persist:loverslab')
  const win = new BrowserWindow({ width: 1100, height: 800, parent: parent ?? undefined, title: 'LoversLab – downloads for your profile', webPreferences: { session: ses } })
  const downloads = join(app.getPath('userData'), 'downloads')
  await mkdir(downloads, { recursive: true })
  let cancelled = false
  let banner = ''
  win.on('closed', () => (cancelled = true))
  win.on('page-title-updated', (e) => e.preventDefault())
  win.webContents.on('did-finish-load', () => void win.webContents.executeJavaScript(bannerScript(banner)).catch(() => {}))
  const setBanner = (text: string) => {
    banner = `WH3 Lewd Mod Manager: ${text}`
    if (!win.isDestroyed()) void win.webContents.executeJavaScript(bannerScript(banner)).catch(() => {})
  }

  let finished: string[] = []
  let failed: string | null = null
  const onDownload = (_e: unknown, item: DownloadItem) => {
    const target = join(downloads, basename(item.getFilename()))
    item.setSavePath(target)
    item.once('done', (_ev, state) => (state === 'completed' ? finished.push(target) : (failed = `Download ${state}.`)))
  }
  ses.on('will-download', onDownload)
  const waitFor = async (count: number) => {
    for (const t0 = Date.now(); finished.length < count && !failed && !cancelled && Date.now() - t0 < FILE_LIMIT_MS; ) await sleep(1000)
    return finished.length >= count
  }

  const results: { modId: string; ok: boolean; message: string }[] = []
  try {
    for (const [i, job] of jobs.entries()) {
      const step = { modId: job.modId, index: i + 1, total: jobs.length }
      if (cancelled) {
        results.push({ modId: job.modId, ok: false, message: 'Cancelled.' })
        progress({ ...step, status: 'skipped' })
        continue
      }
      finished = []
      failed = null
      const waitNote = 'If LoversLab asks you to sign in, do that first (tick "Remember me"). If LoversLab makes a download wait, the queue waits with it. Close this window to stop.'
      setBanner(`${i + 1} of ${jobs.length}: ${job.name}. ${waitNote}`)
      progress({ ...step, status: 'downloading' })
      void win.loadURL(job.url.replace(/\/?$/, '/') + '?do=download').catch(() => {}) // a download aborts the navigation

      // Either the file arrives, or the page lists several files (only on the first page, never on a file's own page).
      let expected = 1
      for (const t0 = Date.now(); !finished.length && !failed && !cancelled && Date.now() - t0 < FILE_LIMIT_MS; await sleep(1000)) {
        if (win.isDestroyed() || /[?&]r=/.test(win.webContents.getURL())) continue
        const rows: DownloadRow[] = await win.webContents.executeJavaScript(ROWS_JS).catch(() => [])
        if (new Set(rows.map((r) => r.href)).size < 2) continue
        const picks = pickDownloads(rows, job.archives)
        if (!picks) {
          setBanner(`${i + 1} of ${jobs.length}: choose the file you want for ${job.name}. ${waitNote}`)
          progress({ ...step, status: 'choose' })
          break // the player's click starts the download
        }
        expected = picks.length
        for (const [n, p] of picks.entries()) {
          void win.loadURL(p.href).catch(() => {})
          if (!(await waitFor(n + 1))) break
        }
        break
      }
      const ok = await waitFor(expected)
      if (!ok) {
        const message = cancelled ? 'Cancelled.' : failed ?? 'No download arrived in time.'
        results.push({ modId: job.modId, ok: false, message })
        progress({ ...step, status: cancelled ? 'skipped' : 'failed', message })
        continue
      }
      const installed = []
      for (const f of finished) {
        const r = await installFile(f, dataPath, job.modId)
        if (r.ok) await rm(f, { force: true })
        installed.push(r)
      }
      const message = installed.map((r) => r.message).join(' · ')
      const allOk = installed.every((r) => r.ok)
      results.push({ modId: job.modId, ok: allOk, message })
      progress({ ...step, status: allOk ? 'installed' : 'failed', message })
    }
  } finally {
    ses.removeListener('will-download', onDownload)
    if (!win.isDestroyed()) win.close()
  }
  return results
}
