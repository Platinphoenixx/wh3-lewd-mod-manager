import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, session, type DownloadItem } from 'electron'
import { path7za } from '7zip-bin'
import { createExtractorFromFile } from 'node-unrar-js'
import { readJson, writeJson } from './store'
import { pickDownloads, type DownloadRow, type FileHint } from '@shared/install'
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

const LOGIN_HINT = 'LoversLab only allows downloads when you are logged in. Sign in here once with "Remember me" ticked (this window then keeps the login).'

const NEXUS_LOGIN = 'WH3 Lewd Mod Manager: sign in to Nexus Mods here once (this window keeps the login).'

/**
 * Opens a LoversLab download page in its own window (persistent LL login, separate from the app).
 * When the user picks a file, it is saved to the app's download folder and installed.
 */
export function downloadFromLoversLab(url: string, dataPath: string, modId: string | undefined, parent: BrowserWindow | null, hints: FileHint[] = []): Promise<InstallResult> {
  const wanted = hints.filter((h) => h.wanted)
  const what = wanted.length
    ? `Take ${wanted.map((h) => `“${h.name}”${h.note ? ` (${h.note})` : ''}`).join(' and ')} – marked in the file list.`
    : hints.some((h) => h.note)
      ? `Which file: ${hints.filter((h) => h.note).map((h) => `“${h.name}” – ${h.note}`).join(' · ')}.`
      : ''
  const closes = wanted.length > 1
    ? 'Download them one after another; each is installed automatically and this window closes after the last one.'
    : wanted.length
      ? 'Only this one file: it is installed automatically and this window closes.'
      : 'Download one file only: it is installed automatically and this window closes. For another file of this mod, start the download again.'
  const guide = guideScript(`WH3 Lewd Mod Manager: ${LOGIN_HINT}`, ['Click “Download”.', what, closes].filter(Boolean).join(' '), LL_SIGNED_IN)
  return downloadInWindow({ url, partition: 'persist:loverslab', title: 'LoversLab – pick the file to install', banner: guide + markFilesScript(hints) }, dataPath, modId, parent, { files: Math.max(1, wanted.length) })
}

// LoversLab shows the member menu when signed in; Nexus Mods shows a "Log in" button when signed out.
const LL_SIGNED_IN = `!!document.querySelector('#elUserLink')`
const NEXUS_SIGNED_IN = `![...document.querySelectorAll('a, button')].some((e) => /^\\s*(log ?in|sign ?in)\\s*$/i.test(e.textContent || ''))`

/**
 * Two boxes on top of every page of the LoversLab download window: the sign-in hint (only while signed
 * out – LoversLab shows the member menu #elUserLink when signed in) and, set apart in green, which file
 * to take. "Remember me" is ticked on the LoversLab login form, because without it LL only sets session
 * cookies and the login is gone after closing the app.
 */
const guideScript = (login: string, file: string, signedIn: string) => `(() => {
  const remember = document.querySelector('input[type=checkbox][name=remember_me]')
  if (remember) remember.checked = true
  let b = document.getElementById('wh3lmm-banner')
  if (!b) {
    b = document.createElement('div')
    b.id = 'wh3lmm-banner'
    b.style.cssText = 'position:sticky;top:0;z-index:2147483647;font:15px/1.4 system-ui,sans-serif;text-align:center'
    document.body.prepend(b)
  }
  b.replaceChildren()
  const box = (text, css) => { const d = document.createElement('div'); d.style.cssText = 'padding:10px 16px;' + css; d.textContent = text; b.append(d); return d }
  if (!(${signedIn})) box(${JSON.stringify(login)}, 'background:#c9a25a;color:#1a140a')
  box(${JSON.stringify(file)}, 'background:#22331f;color:#e4eedc;border-bottom:2px solid #6f9a5c').id = 'wh3lmm-file'
})()`

/**
 * Marks the files of a LoversLab download list: the one the profile uses, what the others are (catalog
 * notes), and preview images the game does not need. Re-runs while the page changes (the file list opens
 * as a dialog after "Download").
 */
const markFilesScript = (hints: FileHint[]) => `;(() => {
  const hints = ${JSON.stringify(hints)}
  const stem = (n) => n.trim().toLowerCase().replace(/\\.(7z|zip|rar|pack)$/, '')
  const mark = () => {
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length || el.dataset.wh3lmm || el.closest('#wh3lmm-banner')) continue
      const text = (el.textContent || '').trim()
      if (!/\\.(7z|zip|rar|pack|png|jpe?g)$/i.test(text) || text.length > 200) continue
      const hint = hints.find((h) => stem(h.name) === stem(text))
      const image = /\\.(png|jpe?g)$/i.test(text)
      if (!hint && !image) continue
      el.dataset.wh3lmm = '1'
      const note = document.createElement('div')
      note.dataset.wh3lmm = '1'
      // Green: the profile's file. Amber: another version, with what it is. Grey: not needed.
      note.style.cssText = 'font:13px/1.4 system-ui,sans-serif;margin-top:2px;' + (hint && hint.wanted ? 'color:#8fcf74;font-weight:700'
        : hint && hint.note ? 'color:#d9b25e' : 'color:#7d7d7d;font-style:italic')
      note.textContent = hint && hint.wanted ? '✔ Your profile uses this file' + (hint.note ? ' – ' + hint.note : '')
        : hint ? (hint.note || 'Not the file your profile uses')
        : '✕ Preview image for mod managers – not needed'
      el.after(note)
    }
  }
  mark()
  if (!window.__wh3lmmMarks) {
    window.__wh3lmmMarks = new MutationObserver(() => { clearTimeout(window.__wh3lmmT); window.__wh3lmmT = setTimeout(mark, 150) })
    window.__wh3lmmMarks.observe(document.body, { childList: true, subtree: true })
  }
})()`

/** The same for a Nexus Mods file page: own persistent Nexus login; Premium downloads start at once. */
export function downloadFromNexus(url: string, dataPath: string, modId: string | undefined, parent: BrowserWindow | null, hints: FileHint[] = []): Promise<InstallResult> {
  const wanted = hints.filter((h) => h.wanted).map((h) => h.name)
  const file = wanted.length
    ? `Your profile needs ${wanted.join(', ')}. The files that contain ${wanted.length > 1 ? 'them' : 'it'} are marked below – click “Manual download” on each (not “Mod manager download”).`
    : 'Click “Manual download” on one file (not “Mod manager download”).'
  const closes = wanted.length
    ? ' Each is installed automatically; this window closes when everything is installed.'
    : ' It is installed automatically and this window closes; for another file of this mod, start the download again.'
  const guide = guideScript(NEXUS_LOGIN, file + closes, NEXUS_SIGNED_IN)
  return downloadInWindow({ url, partition: 'persist:nexus', title: 'Nexus Mods – pick the file to install', banner: guide + markNexusScript(hints) }, dataPath, modId, parent, wanted.length ? { packs: wanted } : { files: 1 })
}

/**
 * Marks the files on a Nexus Mods files tab. The page lists files by title only, so each file's preview
 * (the list of its contents that "Preview file contents" opens) is read once to see which packs it holds.
 * The green box then names the files to take.
 */
const markNexusScript = (hints: FileHint[]) => `;(async () => {
  if (window.__wh3lmmNexus) return
  window.__wh3lmmNexus = true
  const hints = ${JSON.stringify(hints)}
  const take = []
  for (const dt of document.querySelectorAll('dt.file-expander-header')) {
    const dd = dt.nextElementSibling
    const btn = [...(dd ? dd.querySelectorAll('a, button') : [])].find((e) => /Preview file contents/i.test(e.textContent || ''))
    if (!btn) continue
    const url = btn.getAttribute('data-manifest-uri') || (btn.getAttribute('data-url')
      ? 'https://file-metadata.nexusmods.com/file/nexus-files-s3-meta/' + btn.getAttribute('data-gid') + '/' + btn.getAttribute('data-mid') + '/' + btn.getAttribute('data-url') + '.json' : '')
    if (!url) continue
    const text = await fetch(url).then((r) => r.text()).catch(() => '')
    const packs = (text.replace(/\\\\u0026/g, '&').match(/[^"\\/\\\\]+\\.pack/gi) || []).map((p) => p.toLowerCase())
    const found = hints.filter((h) => packs.includes(h.name.toLowerCase()))
    if (!found.length) continue
    const used = found.filter((h) => h.wanted)
    const title = dt.getAttribute('data-name') || dt.textContent.trim()
    if (used.length) take.push(title)
    const note = document.createElement('div')
    note.style.cssText = 'font:14px/1.4 system-ui,sans-serif;padding:6px 16px;' + (used.length ? 'background:#22331f;color:#8fcf74;font-weight:700' : 'color:#d9b25e')
    note.textContent = used.length ? '✔ Your profile uses this file (' + used.map((h) => h.name).join(', ') + ')'
      : found.map((h) => h.name + (h.note ? ' – ' + h.note : '')).join(' · ')
    dt.after(note)
  }
  const box = document.getElementById('wh3lmm-file')
  if (box && take.length) box.textContent = 'Take ' + take.map((t) => '“' + t + '”').join(' and ') + ' – marked below. Click “Manual download” on ' + (take.length > 1 ? 'each, one after another' : 'it') + ' (not “Mod manager download”). ' + (take.length > 1 ? 'Each is installed automatically; this window closes after the last one.' : 'Only this one file: it is installed automatically and this window closes.')
})()`

/**
 * What a download window waits for before it closes: these packs (Nexus, names known), or a number of
 * downloaded files (LoversLab). Closing the window earlier keeps what was installed so far.
 */
type WindowNeeds = { packs: string[] } | { files: number }

function downloadInWindow(site: { url: string; partition: string; title: string; banner: string }, dataPath: string, modId: string | undefined, parent: BrowserWindow | null, needs: WindowNeeds = { files: 1 }): Promise<InstallResult> {
  const { url } = site
  const ses = session.fromPartition(site.partition)
  const win = new BrowserWindow({ width: 1100, height: 800, parent: parent ?? undefined, title: site.title, webPreferences: { session: ses } })
  const downloads = join(app.getPath('userData'), 'downloads')
  const results: InstallResult[] = []
  const combined = (): InstallResult => ({ ok: results.every((r) => r.ok), message: results.map((r) => r.message).join(' · '), packs: results.flatMap((r) => r.packs) })
  return new Promise((resolve) => {
    let done = false
    const finish = (r: InstallResult) => {
      if (done) return
      done = true
      ses.removeListener('will-download', onDownload)
      if (!win.isDestroyed()) win.close()
      resolve(r)
    }
    // The save path must be set right inside the event; set any later, Electron shows Windows' save dialog.
    const onDownload = (_e: unknown, item: DownloadItem) => {
      if (IMAGE.test(item.getFilename())) return item.cancel() // preview images are not mods
      mkdirSync(downloads, { recursive: true })
      const target = join(downloads, basename(item.getFilename()))
      item.setSavePath(target)
      item.once('done', async (_ev, state) => {
        if (state !== 'completed') return finish({ ok: false, message: `Download ${state}.`, packs: [] })
        const s = await stat(target)
        if (!s.size) return finish({ ok: false, message: 'Empty download.', packs: [] })
        const r = await installFile(target, dataPath, modId)
        // The packs are in data now; the archive would only fill up the app folder.
        if (r.ok) await rm(target, { force: true })
        results.push(r)
        const got = new Set(results.flatMap((x) => x.packs.map((p) => basename(p).toLowerCase())))
        const complete = 'packs' in needs ? needs.packs.every((p) => got.has(p.toLowerCase())) : results.length >= needs.files
        if (complete || !r.ok) finish(combined())
      })
    }
    ses.on('will-download', onDownload)
    win.on('closed', () => finish(results.length ? combined() : { ok: false, message: 'Window closed without downloading.', packs: [] }))
    // Keep our title instead of the page's, and show what to do on every page.
    win.on('page-title-updated', (e) => e.preventDefault())
    win.webContents.on('did-finish-load', () => void win.webContents.executeJavaScript(site.banner).catch(() => {}))
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
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

/** A plain dark page for the queue window while a file downloads. */
const statusPage = (text: string) => 'data:text/html;charset=utf-8,' + encodeURIComponent(
  `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#151311;color:#e4eedc;font:16px/1.5 system-ui,sans-serif">` +
  `<div style="background:#22331f;border-bottom:2px solid #6f9a5c;padding:14px 18px">${text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</div></body>`
)
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
  // The same boxes as the single download window: sign-in (only while signed out) and, in green, the
  // current mod and which file to take; the page's files are marked from the job's hints.
  let guide = ''
  win.on('closed', () => (cancelled = true))
  win.on('page-title-updated', (e) => e.preventDefault())
  const onLoversLab = () => !win.isDestroyed() && win.webContents.getURL().startsWith('https://www.loverslab.com/')
  win.webContents.on('did-finish-load', () => void (onLoversLab() && win.webContents.executeJavaScript(guide).catch(() => {})))
  const setGuide = (text: string, hints: FileHint[] = []) => {
    guide = guideScript(`WH3 Lewd Mod Manager: ${LOGIN_HINT}`, text, LL_SIGNED_IN) + markFilesScript(hints)
    if (onLoversLab()) void win.webContents.executeJavaScript(guide).catch(() => {})
  }
  // A page script on a page that is not there (a download ends the navigation) never answers: wait at most 3 s.
  const pageJs = <T>(code: string, fallback: T): Promise<T> =>
    Promise.race([win.webContents.executeJavaScript(code).catch(() => fallback), sleep(3000).then(() => fallback)])
  let current = ''

  let finished: string[] = []
  let failed: string | null = null
  const onDownload = (_e: unknown, item: DownloadItem) => {
    // Preview images are not mods: skip them and keep waiting for the real file.
    if (IMAGE.test(item.getFilename())) return item.cancel()
    const target = join(downloads, basename(item.getFilename()))
    item.setSavePath(target)
    item.once('done', (_ev, state) => (state === 'completed' ? finished.push(target) : (failed = `Download ${state}.`)))
    // The download ends the page; show what is going on instead of an empty window.
    if (!win.isDestroyed()) void win.loadURL(statusPage(`${current}: downloading “${item.getFilename()}”. It is installed when it is complete, then the next mod follows. Close this window to stop.`)).catch(() => {})
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
      const waitNote = 'If LoversLab makes a download wait, the queue waits with it. Close this window to stop.'
      const hints = job.hints ?? []
      const wanted = hints.filter((h) => h.wanted).map((h) => `“${h.name}”`)
      current = `${i + 1} of ${jobs.length} – ${job.name}`
      setGuide(`${current}${wanted.length ? `: taking ${wanted.join(' and ')}` : ''}. ${waitNote}`, hints)
      progress({ ...step, status: 'downloading' })
      void win.loadURL(job.url.replace(/\/?$/, '/') + '?do=download').catch(() => {}) // a download aborts the navigation

      // Either the file arrives, or the page lists several files (only on the first page, never on a file's own page).
      let expected = 1
      for (const t0 = Date.now(); !finished.length && !failed && !cancelled && Date.now() - t0 < FILE_LIMIT_MS; await sleep(1000)) {
        if (!onLoversLab() || /[?&]r=/.test(win.webContents.getURL())) continue
        const rows: DownloadRow[] = await pageJs(ROWS_JS, [] as DownloadRow[])
        if (new Set(rows.map((r) => r.href)).size < 2) continue
        const picks = pickDownloads(rows, job.archives)
        if (!picks) {
          const which = wanted.length
            ? `click “Download” at ${wanted.join(' and ')} (marked below)`
            : hints.some((h) => h.note)
              ? 'choose one file – the notes below say what each one is; preview images (.png) are not needed'
              : 'choose one file – preview images (.png) are not needed'
          setGuide(`${i + 1} of ${jobs.length} – ${job.name}: ${which}. After it the next mod follows. ${waitNote}`, hints)
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
