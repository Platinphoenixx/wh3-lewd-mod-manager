import type { Catalog, Mod } from '@catalog/schema'
import { parseTargetKey, type CatalogIndex } from './match'

export type InstallSource =
  | { kind: 'steam'; id: string }
  | { kind: 'loverslab'; url: string }
  | { kind: 'discord'; url: string }
  | { kind: 'manual'; url?: string }

/**
 * Where to get a missing profile entry. Steam comes first (it updates itself), then LoversLab,
 * then a Discord post; anything else has to be added by hand from wherever it is linked.
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
  const steam = mod.sources.steam?.find((s) => !s.title?.toLowerCase().includes('(removed)'))
  if (steam && mod.status !== 'superseded') return { kind: 'steam', id: steam.id }
  const ll = mod.sources.loverslab
  if (ll && !ll.externalDownload) return { kind: 'loverslab', url: ll.url }
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
  if (!packs.length || packs.some((p) => !p.archive)) return undefined
  return [...new Set(packs.map((p) => p.archive!))]
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
