import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { analyzeConflicts, type ConflictReport } from '@shared/conflicts'
import { collectFacts, type FactsReport } from '@shared/own'

/**
 * Reader for the index of Total War .pack files (PFH5/PFH6, as used by Warhammer III).
 *
 * Layout (little endian):
 *   0  magic "PFH5"/"PFH6"
 *   4  u32 pack type + flags (low byte: 0 boot, 1 release, 2 patch, 3 mod, 4 movie)
 *   8  u32 number of packs in the dependency index      12 u32 byte size of that index
 *  16  u32 number of files                              20 u32 byte size of the file index
 *  24  u32 timestamp                                    (+20 bytes when HAS_EXTENDED_HEADER)
 *  then the dependency index: NUL-terminated pack names
 *  then the file index, per file: u32 size, [u32 timestamp], u8 compressed (PFH5+), NUL-terminated path
 *  then the file data in index order.
 * Only the header and the index are read; file data is read only for RPFM's small dependency note.
 */

const HAS_EXTENDED_HEADER = 0x100
const HAS_ENCRYPTED_INDEX = 0x80
const HAS_INDEX_WITH_TIMESTAMPS = 0x40

export interface PackFileEntry {
  path: string // lower-case, forward slashes
  size: number
}

export interface PackIndex {
  version: string
  type: 'boot' | 'release' | 'patch' | 'mod' | 'movie' | 'unknown'
  /** Packs this pack declares it needs (header list plus RPFM's dependency manager note). */
  dependencies: string[]
  files: PackFileEntry[]
}

const TYPES = ['boot', 'release', 'patch', 'mod', 'movie'] as const

/** Parses the header + index bytes. Exported separately so it can be tested without files. */
export function parsePackIndex(buf: Buffer): { index: PackIndex; dataStart: number; rawPaths: string[] } {
  const magic = buf.toString('latin1', 0, 4)
  if (magic !== 'PFH5' && magic !== 'PFH6') throw new Error(`unsupported pack format ${JSON.stringify(magic)}`)
  const flags = buf.readUInt32LE(4)
  if (flags & HAS_ENCRYPTED_INDEX) throw new Error('encrypted pack index')
  const depCount = buf.readUInt32LE(8)
  const depSize = buf.readUInt32LE(12)
  const fileCount = buf.readUInt32LE(16)
  const indexSize = buf.readUInt32LE(20)
  let pos = 28 + (flags & HAS_EXTENDED_HEADER ? 20 : 0)

  const dependencies: string[] = []
  const depEnd = pos + depSize
  while (dependencies.length < depCount && pos < depEnd) {
    const end = buf.indexOf(0, pos)
    dependencies.push(buf.toString('utf8', pos, end))
    pos = end + 1
  }
  pos = depEnd

  const files: PackFileEntry[] = []
  const rawPaths: string[] = []
  const indexEnd = pos + indexSize
  for (let i = 0; i < fileCount; i++) {
    const size = buf.readUInt32LE(pos)
    pos += 4
    if (flags & HAS_INDEX_WITH_TIMESTAMPS) pos += 4
    pos += 1 // compressed flag (PFH5 and newer)
    const end = buf.indexOf(0, pos)
    if (end < 0 || end >= indexEnd) throw new Error('truncated pack index')
    const raw = buf.toString('utf8', pos, end)
    rawPaths.push(raw)
    files.push({ path: raw.replace(/\\/g, '/').toLowerCase(), size })
    pos = end + 1
  }
  return {
    index: { version: magic, type: TYPES[flags & 0xf] ?? 'unknown', dependencies, files },
    dataStart: indexEnd,
    rawPaths
  }
}

/** RPFM stores a mod's dependencies as a small JSON note inside the pack. */
export function parseRpfmDependencies(text: string): string[] {
  try {
    const data = JSON.parse(text) as unknown
    const names: string[] = []
    const walk = (v: unknown) => {
      if (typeof v === 'string' && v.toLowerCase().endsWith('.pack')) names.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(data)
    return names
  } catch {
    return []
  }
}

// Indexes are cached per file and re-read only when size or modification time change.
const cache = new Map<string, { key: string; index: PackIndex }>()

export async function cachedPackIndex(path: string): Promise<PackIndex> {
  const s = await stat(path)
  const key = `${s.size}:${s.mtimeMs}`
  const hit = cache.get(path)
  if (hit?.key === key) return hit.index
  const index = await readPackIndex(path)
  cache.set(path, { key, index })
  return index
}

/** Overlaps between the given packs; `paths` in load order, highest priority first. */
export async function packConflicts(paths: string[]): Promise<ConflictReport & { unreadable: string[] }> {
  const packs: { name: string; files: PackIndex['files'] }[] = []
  const unreadable: string[] = []
  for (const p of paths) {
    try {
      packs.push({ name: basename(p), files: (await cachedPackIndex(p)).files })
    } catch {
      unreadable.push(basename(p))
    }
  }
  return { ...analyzeConflicts(packs), unreadable }
}

/** Dependencies, file counts, tables and shared files of the given packs (for placing own mods). */
export async function packFacts(paths: string[]): Promise<FactsReport> {
  const packs: Parameters<typeof collectFacts>[0] = []
  const unreadable: string[] = []
  for (const p of paths) {
    try {
      const index = await cachedPackIndex(p)
      packs.push({ path: p, files: index.files, dependencies: index.dependencies })
    } catch {
      unreadable.push(p)
    }
  }
  const report = collectFacts(packs)
  for (const p of unreadable) report.packs[p] = null
  return report
}

export async function readPackIndex(path: string): Promise<PackIndex> {
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(48)
    await fh.read(head, 0, 48, 0)
    const flags = head.readUInt32LE(4)
    const total = 28 + (flags & HAS_EXTENDED_HEADER ? 20 : 0) + head.readUInt32LE(12) + head.readUInt32LE(20)
    const buf = Buffer.alloc(total)
    await fh.read(buf, 0, total, 0)
    const { index, dataStart } = parsePackIndex(buf)

    // Data follows the index in file order; read only RPFM's dependency note (a few bytes).
    let offset = dataStart
    for (const f of index.files) {
      if (f.path.startsWith('dependencies_manager') && f.path.endsWith('.rpfm_reserved') && f.size < 64 * 1024) {
        const note = Buffer.alloc(f.size)
        await fh.read(note, 0, f.size, offset)
        for (const dep of parseRpfmDependencies(note.toString('utf8'))) {
          if (!index.dependencies.includes(dep)) index.dependencies.push(dep)
        }
      }
      offset += f.size
    }
    return index
  } finally {
    await fh.close()
  }
}
