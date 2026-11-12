import type { CatalogIndex } from './match'

/**
 * Mod files the player already has in folders they named (Settings → Files you already have): loose .pack files and the
 * packs inside .7z/.zip/.rar archives. The install step takes a missing pack from here before it downloads anything.
 */
export interface LocalFile {
  /** The pack as it is called (inside an archive: its own name there). */
  name: string
  size: number
  /** YYYY-MM-DD: the upload date the file name carries (Nexus time stamp, Discord message id), else the file's date. */
  date: string
  /** The loose pack, or the archive it is in. */
  path: string
  /** Set when the pack is inside the archive at `path`. */
  inArchive?: boolean
}

export interface LocalScan {
  /** error: the folder could not be read at all (not found, no access); its files are missing from this look. */
  folders: { path: string; files: number; packs: number; error?: string }[]
  files: LocalFile[]
  scannedAt: string
}

/** One missing pack of a profile entry that a local file can stand in for. */
export interface LocalNeed {
  key: string
  modId?: string
  name: string
  packs: string[]
  /** The entry names no pack (a mod made of versions to pick from): the first of `packs` that is found will do. */
  anyOf?: boolean
}

export interface LocalMatch {
  key: string
  modId?: string
  name: string
  /** The pack's name in the catalog (the file is installed under it). */
  pack: string
  file: LocalFile
  /** Set when the file is older than the newest version the catalog knows (that date). */
  newer?: string
}

/** Discord drops a leading "@"/"!" from attachment names; exports and archives add an id in front. */
const bare = (name: string) => name.toLowerCase().replace(/^\d{17,20}_/, '').replace(/^[@!]+/, '')

const DISCORD_EPOCH = 1420070400000n

/** The date a downloaded file's name carries, else the given file date. */
export function dateOfFile(name: string, mtime: string): string {
  // Nexus Mods names its downloads "<name>-<mod id>-<version>-<unix time>.<ext>".
  const nexus = name.match(/-(1[5-9]\d{8})(?:\.[a-z0-9]+)?$/i)
  if (nexus) return new Date(Number(nexus[1]) * 1000).toISOString().slice(0, 10)
  // An archive's own folder name with an ISO date ("… 13.21 2026-10-30T12-09Z …").
  const iso = name.match(/(20\d\d-\d\d-\d\d)T\d\d-\d\dZ/)
  if (iso) return iso[1]
  // A Discord attachment id in front of the name is a snowflake: its upper bits are the posting time.
  const snow = name.match(/^(\d{17,20})_/)
  if (snow) return new Date(Number((BigInt(snow[1]) >> 22n) + DISCORD_EPOCH)).toISOString().slice(0, 10)
  return mtime.slice(0, 10)
}

/**
 * For each missing pack the best local file: same name (or the same apart from the "@"/"!" Discord drops), the newest
 * of several, a loose pack before one that has to come out of an archive. A file older than the catalog's newest date
 * for the mod (more than two days) says so in `newer`.
 */
export function findLocal(index: CatalogIndex, files: LocalFile[], needs: LocalNeed[]): LocalMatch[] {
  const byName = new Map<string, LocalFile[]>()
  for (const f of files) byName.set(bare(f.name), [...(byName.get(bare(f.name)) ?? []), f])
  const out: LocalMatch[] = []
  for (const n of needs) {
    const mod = n.modId ? index.mods.get(n.modId) : undefined
    const latest = mod?.updated
    for (const pack of n.packs) {
      const hits = byName.get(bare(pack)) ?? []
      if (!hits.length) continue
      const exact = hits.filter((f) => f.name.toLowerCase() === pack.toLowerCase())
      const pool = exact.length ? exact : hits
      // Two mods can ship a pack of the same name: a file from the mod's own download (its id in the folder or archive
      // name, as Nexus and LoversLab name them) wins.
      const num = n.modId?.match(/^(?:nx|ll)-(\d+)$/)?.[1]
      const own = (f: LocalFile) => (num && new RegExp(`(^|[/ _-])${num}([/ _-]|$)`).test(f.path.replace(/\\/g, '/')) ? 1 : 0)
      const best = [...pool].sort((a, b) => own(b) - own(a) || b.date.localeCompare(a.date) || Number(!!a.inArchive) - Number(!!b.inArchive))[0]
      // The catalog knows when a mod last changed, not each of its files: only a one-file mod can tell an old copy.
      const single = (mod?.packs ?? []).filter((x) => x.from === 'download').length <= 1
      const older = latest && single && daysBetween(best.date, latest) > 2
      out.push({ key: n.key, modId: n.modId, name: n.name, pack, file: best, ...(older ? { newer: latest } : {}) })
      if (n.anyOf) break
    }
  }
  return out
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86400000
}
