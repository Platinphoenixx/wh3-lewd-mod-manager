import { execFile } from 'node:child_process'
import { appendFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { path7za } from '7zip-bin'
import { createExtractorFromFile } from 'node-unrar-js'
import { app } from 'electron'
import { readJson, writeJson } from './store'
import { dateOfFile, type LocalFile, type LocalScan } from '@shared/localfiles'

const run = promisify(execFile)
const ARCHIVES = new Set(['.7z', '.zip', '.rar'])

/** What an archive holds, kept per path + size + date so a second look does not open it again. */
interface ArchiveListing {
  size: number
  mtime: number
  packs: { name: string; size: number }[]
}

async function listArchive(file: string): Promise<{ name: string; size: number }[]> {
  if (extname(file).toLowerCase() === '.rar') {
    const ex = await createExtractorFromFile({ filepath: file })
    return [...ex.getFileList().fileHeaders]
      .filter((h) => !h.flags.directory && h.name.toLowerCase().endsWith('.pack'))
      .map((h) => ({ name: basename(h.name.replace(/\\/g, '/')), size: h.unpSize }))
  }
  // -slt prints one "Path = …" / "Size = …" block per entry; nothing is extracted.
  const { stdout } = await run(path7za.replace('app.asar', 'app.asar.unpacked'), ['l', '-slt', '-ba', file], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  const out: { name: string; size: number }[] = []
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const path = block.match(/^Path = (.+)$/m)?.[1]
    if (path && path.toLowerCase().endsWith('.pack')) out.push({ name: basename(path.replace(/\\/g, '/')), size: Number(block.match(/^Size = (\d+)$/m)?.[1] ?? 0) })
  }
  return out
}

/** A loose pack's date: its own name, else the folder it was unpacked into (Nexus and Discord names carry one). */
function looseDate(path: string, mtime: Date): string {
  const own = dateOfFile(basename(path), '')
  if (own) return own
  for (let d = dirname(path), i = 0; i < 3; i++, d = dirname(d)) {
    const fromFolder = dateOfFile(basename(d), '')
    if (fromFolder) return fromFolder
  }
  return mtime.toISOString().slice(0, 10)
}

/**
 * Every .pack (loose or inside an archive) below the given folders. Archives are listed with 7-Zip / unrar without
 * extracting anything; listings are cached in userData/local-files.json.
 */
export async function scanSourceFolders(folders: string[]): Promise<LocalScan> {
  const started = Date.now()
  const cache = await readJson<Record<string, ArchiveListing>>('local-files.json', {}).catch(() => ({}) as Record<string, ArchiveListing>)
  const next: Record<string, ArchiveListing> = {}
  const files: LocalFile[] = []
  const summary: LocalScan['folders'] = []
  for (const root of folders) {
    let count = 0
    let packs = 0
    let error: string | undefined
    let unreadable = 0
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 8) return
      // A folder that cannot be read is said, not passed over: the root as the folder's error, sub-folders counted.
      const entries = await readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
        if (depth === 0) error = e.code === 'ENOENT' ? 'not found' : `could not be read (${e.code ?? e.message})`
        else unreadable++
        return []
      })
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory()) { await walk(p, depth + 1); continue }
        const ext = extname(e.name).toLowerCase()
        if (ext !== '.pack' && !ARCHIVES.has(ext)) continue
        const st = await stat(p).catch(() => null)
        if (!st) continue
        count++
        if (ext === '.pack') {
          files.push({ name: e.name, size: st.size, date: looseDate(p, st.mtime), path: p })
          packs++
          continue
        }
        const old = cache[p]
        const listing = old && old.size === st.size && old.mtime === st.mtimeMs
          ? old
          : { size: st.size, mtime: st.mtimeMs, packs: await listArchive(p).catch(() => []) }
        next[p] = listing
        const date = dateOfFile(e.name, '') || looseDate(p, st.mtime)
        for (const x of listing.packs) files.push({ name: x.name, size: x.size, date, path: p, inArchive: true })
        packs += listing.packs.length
      }
    }
    await walk(root, 0)
    // The listings of a folder that could not be read stay cached for the next look.
    if (error) for (const [p, l] of Object.entries(cache)) if (p.toLowerCase().startsWith(root.toLowerCase())) next[p] = l
    summary.push({ path: root, files: count, packs, ...(error ? { error } : unreadable ? { error: `${unreadable} sub-folder${unreadable === 1 ? '' : 's'} could not be read` } : {}) })
  }
  // The cache only saves time; a look that cannot write it still returns what it found.
  await writeJson('local-files.json', next).catch(() => {})
  await logScan(summary, files.length, Date.now() - started)
  return { folders: summary, files, scannedAt: new Date().toISOString() }
}

/** One line per look (userData/local-files.log, restarted at 64 KB): what each folder gave, so a look that found nothing can be explained. */
async function logScan(folders: LocalScan['folders'], packs: number, ms: number): Promise<void> {
  const file = join(app.getPath('userData'), 'local-files.log')
  const line = `${new Date().toISOString()} ${ms} ms, ${packs} packs: ${folders.map((f) => `${f.path} = ${f.error ?? `${f.files} files, ${f.packs} packs`}`).join('; ') || 'no folders'}\n`
  const size = await stat(file).then((s) => s.size, () => 0)
  if (size > 64 * 1024) await writeFile(file, line).catch(() => {})
  else await appendFile(file, line).catch(() => {})
}
