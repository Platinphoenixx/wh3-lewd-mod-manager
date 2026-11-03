import type { Catalog, Mod, PackRef } from '@catalog/schema'
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
  entry: { key: string; pack?: string; steamId?: string; from?: 'steam' | 'download' }
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
  // A pack that lives somewhere else than the mod's pages (a fix posted on Discord) comes from there.
  const elsewhere = entry.pack ? mod.packs.find((p) => p.file.toLowerCase() === entry.pack!.toLowerCase())?.url : undefined
  if (elsewhere) return /discord\.com/.test(elsewhere) ? { kind: 'discord', url: elsewhere } : { kind: 'manual', url: elsewhere }
  const ll = mod.sources.loverslab
  // A file the template loads from data (a download) comes from the mod's LoversLab page even when the
  // mod's main pack is on Steam (e.g. Azazel's Realm's "Play as Azazel" overwrite).
  if (entry.from === 'download' && ll && !ll.externalDownload) return { kind: 'loverslab', url: ll.url }
  const steam = mod.sources.steam?.find((s) => !s.removed && !s.title?.toLowerCase().includes('(removed)'))
  if (steam && mod.status !== 'superseded') return { kind: 'steam', id: steam.id }
  if (ll && !ll.externalDownload) return { kind: 'loverslab', url: ll.url }
  if (mod.sources.nexus) return { kind: 'nexus', url: `${mod.sources.nexus.url}?tab=files` }
  const dc = mod.sources.discord?.find((d) => d.messageUrl)?.messageUrl ?? mod.sources.downloads?.find((d) => d.url.includes('discord.com'))?.url
  if (dc) return { kind: 'discord', url: dc }
  return { kind: 'manual', url: ll?.url ?? mod.sources.downloads?.[0]?.url }
}

/**
 * Packs of a mod that the profile needs and that are not installed: the pack its template names, the mod's
 * packs that are neither optional nor a variant, and of a required pick-one group at least one. A mod with
 * only some of them (e.g. Kerberos' shared assets without the main ATB pack) is not installed.
 */
export function missingPacks(mod: Mod | undefined, templatePacks: string | string[] | undefined, installed: { file: string }[]): PackRef[] {
  const have = new Set(installed.map((p) => p.file.toLowerCase()))
  const out: PackRef[] = []
  const listed = (Array.isArray(templatePacks) ? templatePacks : templatePacks ? [templatePacks] : []).filter((p) => /\.pack$/i.test(p))
  let named: PackRef | undefined
  for (const t of listed) {
    const ref = mod?.packs.find((p) => p.file.toLowerCase() === t.toLowerCase())
    named ??= ref
    if (!have.has(t.toLowerCase())) out.push(ref ?? { file: t, from: 'download' })
  }
  const groups = new Map<string, PackRef[]>()
  for (const p of mod?.packs ?? []) {
    if (p.optional) continue
    if (p.exclusiveGroup) groups.set(p.exclusiveGroup, [...(groups.get(p.exclusiveGroup) ?? []), p])
    else if (!have.has(p.file.toLowerCase()) && !out.some((o) => o.file.toLowerCase() === p.file.toLowerCase())) out.push(p)
  }
  for (const list of groups.values()) if (!list.some((p) => have.has(p.file.toLowerCase())) && !named) out.push(list[0])
  return out
}

const bare = (name: string) => name.toLowerCase().replace(/^[@!]+/, '')

/**
 * The name a downloaded pack is installed under. Discord drops leading "@" and "!" from the names of attached files
 * ("@Soil_Kislev_Corrupted_Units.pack" arrives as "Soil_Kislev_Corrupted_Units.pack"); the catalog and the templates
 * know the original name, so such a file gets it back. Anything else keeps its name.
 */
export function catalogPackName(file: string, packs: { file: string }[]): string {
  if (packs.some((p) => p.file.toLowerCase() === file.toLowerCase())) return file
  const hits = [...new Set(packs.filter((p) => bare(p.file) === bare(file)).map((p) => p.file))]
  return hits.length === 1 ? hits[0] : file
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

/**
 * The packs of a mod a profile needs: the one its template names, else – for mods with one version per
 * character ("Miao Ying version", "Katarin version") – the versions for the profile's characters. Undefined
 * when that does not narrow it down (no match, or every version matches).
 */
export function wantedPacks(mod: Mod, templatePack: string | undefined, characters: string[] = []): string[] | undefined {
  if (templatePack && mod.packs.some((p) => p.file.toLowerCase() === templatePack.toLowerCase())) return [templatePack]
  const word = (s: string) => s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean)
  const names = characters.flatMap((c) => word(c).slice(0, 1)).filter((w) => w.length >= 4)
  if (!names.length || mod.packs.length < 2) return undefined
  const describe = (file: string) => [
    mod.packs.find((p) => p.file === file)?.note ?? '',
    ...(mod.sources.downloads ?? []).filter((d) => d.name.toLowerCase() === file.toLowerCase()).map((d) => d.description ?? '')
  ].join(' ')
  // Only the first words of a note count ("Katarin version; needs …"), not characters named as requirements.
  const forChar = mod.packs.filter((p) => {
    const head = word(describe(p.file).split(/[;:(]/)[0]).slice(0, 3)
    return names.some((n) => head.includes(n))
  })
  return forChar.length && forChar.length < mod.packs.length ? forChar.map((p) => p.file) : undefined
}

/**
 * The packs to download for a mod the install step lists: every missing download pack (`need`), with the profile's
 * version of a pick-one group (`wantedPacks`) – so a page with one file per pack (a base pack and six stage packs) is
 * done in one window instead of one round per file. Without `need`, as `wantedPacks`.
 */
export function packsToFetch(mod: Mod, templatePack: string | undefined, need: string[] | undefined, characters: string[] = []): string[] | undefined {
  const base = wantedPacks(mod, templatePack, characters)
  const ref = (f: string) => mod.packs.find((p) => p.file.toLowerCase() === f.toLowerCase())
  const missing = (need ?? []).filter((f) => ref(f))
  if (!missing.length) return base
  // Of a pick-one group: the pack the template names, else the version for the profile's characters.
  const chosen = [...(templatePack && ref(templatePack) ? [templatePack] : []), ...(wantedPacks(mod, undefined, characters) ?? [])]
  const out: string[] = []
  for (const f of missing) {
    const group = ref(f)!.exclusiveGroup
    const pick = group ? chosen.find((b) => ref(b)?.exclusiveGroup === group) ?? f : f
    if (!out.includes(pick)) out.push(pick)
  }
  return out
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
  // The page's own size goes with it ("254 MB"), so the player can tell the files apart.
  for (const d of mod.sources.downloads ?? []) if (!/discord\.com/.test(d.url)) add(d.name, [d.description, d.note].filter(Boolean).join(' · ') || undefined)
  for (const p of mod.packs) if (p.archive) add(p.archive, p.note)
  return [...hints.values()]
}

/**
 * The same by pack name, for pages that do not show pack names (Nexus Mods lists files by title; the
 * window looks into each file's preview). Without template packs, the profile uses what the mod needs:
 * packs that are neither optional nor a variant, and of each required pick-one group the first (the usual one).
 */
export function packHints(mod: Mod, wanted?: string[]): FileHint[] {
  const want = new Set((wanted ?? []).map((w) => w.toLowerCase()))
  const useful = mod.packs.some((p) => want.has(p.file.toLowerCase()))
  const groups = new Set<string>()
  return mod.packs.map((p) => {
    let used: boolean
    if (useful) used = want.has(p.file.toLowerCase())
    else if (p.optional) used = false
    else if (p.exclusiveGroup) used = !groups.has(p.exclusiveGroup) && groups.add(p.exclusiveGroup).size > 0
    else used = true
    return { name: p.file, note: p.note, wanted: used }
  })
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
