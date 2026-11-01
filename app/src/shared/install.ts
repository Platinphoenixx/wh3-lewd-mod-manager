import type { Catalog, Mod } from '@catalog/schema'
import { parseTargetKey, type CatalogIndex } from './match'

export type InstallSource =
  | { kind: 'steam'; id: string }
  | { kind: 'loverslab'; url: string }
  | { kind: 'nexus'; url: string }
  | { kind: 'discord'; url: string }
  | { kind: 'manual'; url?: string }

/**
 * Where to get a missing profile entry. Steam comes first (it updates itself), then LoversLab, then
 * Nexus Mods (opened in the player's own browser), then a Discord post; anything else has to be added by
 * hand from wherever it is linked.
 */
export function installSourceFor(
  catalog: Catalog,
  index: CatalogIndex,
  entry: { key: string; steamId?: string; from?: 'steam' | 'download' }
): InstallSource {
  if (entry.steamId && entry.from !== 'download') return { kind: 'steam', id: entry.steamId }
  const t = parseTargetKey(entry.key)
  if ('steamId' in t) return { kind: 'steam', id: t.steamId }
  if ('external' in t) {
    const ext = catalog.external.find((e) => e.id === t.external)
    return ext?.steamId ? { kind: 'steam', id: ext.steamId } : { kind: 'manual', url: ext?.url }
  }
  if (!('mod' in t)) return { kind: 'manual' }
  const mod = index.mods.get(t.mod)
  if (!mod) return { kind: 'manual' }
  const steam = mod.sources.steam?.find((s) => !s.removed && !s.title?.toLowerCase().includes('(removed)'))
  if (steam && mod.status !== 'superseded') return { kind: 'steam', id: steam.id }
  const ll = mod.sources.loverslab
  if (ll && !ll.externalDownload) return { kind: 'loverslab', url: ll.url }
  if (mod.sources.nexus) return { kind: 'nexus', url: `${mod.sources.nexus.url}?tab=files` }
  const dc = mod.sources.discord?.find((d) => d.messageUrl)?.messageUrl ?? mod.sources.downloads?.find((d) => d.url.includes('discord.com'))?.url
  if (dc) return { kind: 'discord', url: dc }
  return { kind: 'manual', url: ll?.url ?? mod.sources.downloads?.[0]?.url }
}

/** One file of a LoversLab download page. */
export interface DownloadRow {
  name: string
  href: string
}

const stem = (name: string) => name.replace(/\.(7z|zip|rar|pack)$/i, '').toLowerCase()

/**
 * The LoversLab downloads (archive names without extension, from the pack analysis) that contain the
 * wanted packs. `wanted` = pack names a template asks for; without it, the mod's packs only count when
 * there is a single download anyway. Undefined = unknown, the player has to choose.
 */
export function archivesFor(mod: Mod, wanted?: string[]): string[] | undefined {
  const packs = wanted?.length ? mod.packs.filter((p) => wanted.some((w) => w.toLowerCase() === p.file.toLowerCase())) : []
  const archives = packs.map((p) => archiveOf(mod, p.file, p.archive))
  if (!archives.length || archives.some((a) => !a)) return undefined
  return [...new Set(archives as string[])]
}

/** The download that holds a pack: the analysed archive, or the pack itself when the page offers it directly. */
function archiveOf(mod: Mod, file: string, archive?: string): string | undefined {
  if (archive) return archive
  return mod.sources.downloads?.some((d) => d.name.toLowerCase() === file.toLowerCase()) ? stem(file) : undefined
}

/** A note for one file of a mod's download page, shown in the download window. */
export interface FileHint {
  name: string
  note?: string
  /** The profile uses this file. */
  wanted: boolean
}

/**
 * What the download window tells the player about the files of a page: which one the profile uses
 * (`wanted` = pack names the template asks for) and what the others are, from the catalog's notes.
 */
export function downloadHints(mod: Mod, wanted?: string[]): FileHint[] {
  const want = new Set(archivesFor(mod, wanted) ?? [])
  const hints = new Map<string, FileHint>()
  const add = (name: string, note?: string) => {
    const key = stem(name)
    const old = hints.get(key)
    hints.set(key, { name: old?.name ?? name, note: old?.note ?? note, wanted: want.has(key) })
  }
  for (const d of mod.sources.downloads ?? []) if (!/discord\.com/.test(d.url)) add(d.name, d.description)
  for (const p of mod.packs) if (p.archive) add(p.archive, p.note)
  return [...hints.values()]
}

/**
 * Which rows of a download page to fetch. A page with one file needs no choice; with several, every
 * wanted archive has to match exactly one row, otherwise null (the player picks).
 */
export function pickDownloads(rows: DownloadRow[], archives?: string[]): DownloadRow[] | null {
  if (rows.length === 1) return rows
  if (!archives?.length) return null
  const picked: DownloadRow[] = []
  for (const a of archives) {
    const hits = rows.filter((r) => stem(r.name) === stem(a))
    if (hits.length !== 1) return null
    picked.push(hits[0])
  }
  return picked
}
