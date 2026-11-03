import type { Catalog, Mod, ModTarget, Preset } from '@catalog/schema'
import type { InstalledPack } from './api'

/** Lookup tables from Steam ids and pack names to catalog targets. */
export interface CatalogIndex {
  mods: Map<string, Mod>
  bySteamId: Map<string, ModTarget>
  byPack: Map<string, ModTarget>
  /** Pack names without leading "@"/"!" (Discord drops or keeps them), only where one mod has that name. */
  byBarePack: Map<string, ModTarget>
  /**
   * Catalog mods that list a pack as a Workshop file (lower case), with the Workshop item they name: the same
   * file counts for all of them, unless one names another item (a re-upload with the same pack name).
   */
  packOwners: Map<string, { mod: string; steamId?: string }[]>
}

export function targetKey(t: ModTarget): string {
  const [k, v] = Object.entries(t)[0]
  return `${k}:${v}`
}

export function parseTargetKey(key: string): ModTarget {
  const i = key.indexOf(':')
  return { [key.slice(0, i)]: key.slice(i + 1) } as ModTarget
}

export function buildIndex(catalog: Catalog): CatalogIndex {
  const mods = new Map(catalog.mods.map((m) => [m.id, m]))
  const bySteamId = new Map<string, ModTarget>()
  const byPack = new Map<string, ModTarget>()
  const packOwners = new Map<string, { mod: string; steamId?: string }[]>()
  // A pack name several mods list (a fixed re-upload, a translation, a bundle that carries another mod's pack) means,
  // when nothing else tells, the mod it is a main pack of that is still current – not the superseded original.
  const rank = (m: Mod, optional?: boolean) =>
    (optional ? 1 : 0) + (m.status === 'superseded' || m.status === 'abandoned' ? 2 : 0)
  const packRank = new Map<string, number>()
  for (const e of catalog.external) {
    if (e.steamId) bySteamId.set(e.steamId, { external: e.id })
  }
  for (const m of catalog.mods) {
    // Collections only bundle other items; they must not claim them.
    if (m.kind === 'collection') continue
    for (const s of m.sources.steam ?? []) if (!bySteamId.has(s.id)) bySteamId.set(s.id, { mod: m.id })
    for (const p of m.packs ?? []) {
      const r = rank(m, p.optional)
      if (!byPack.has(p.file.toLowerCase()) || r < packRank.get(p.file.toLowerCase())!) {
        byPack.set(p.file.toLowerCase(), { mod: m.id })
        packRank.set(p.file.toLowerCase(), r)
      }
      const owners = packOwners.get(p.file.toLowerCase()) ?? []
      if (p.from === 'steam' && !owners.some((o) => o.mod === m.id)) packOwners.set(p.file.toLowerCase(), [...owners, { mod: m.id, steamId: p.steamId }])
      if (p.steamId && !bySteamId.has(p.steamId)) bySteamId.set(p.steamId, { mod: m.id })
    }
  }
  // Preset entries are the most reliable pack<->item pairs we have (tested lists).
  for (const preset of catalog.presets) {
    for (const e of preset.entries) {
      if (!e.target) continue
      if (!byPack.has(e.pack.toLowerCase())) byPack.set(e.pack.toLowerCase(), e.target)
      if (e.steamId && !bySteamId.has(e.steamId)) bySteamId.set(e.steamId, e.target)
    }
  }
  const bare = new Map<string, ModTarget[]>()
  for (const [file, t] of byPack) {
    const list = bare.get(bareName(file)) ?? []
    if (!list.some((x) => targetKey(x) === targetKey(t))) bare.set(bareName(file), [...list, t])
  }
  const byBarePack = new Map([...bare].filter(([, l]) => l.length === 1).map(([b, l]) => [b, l[0]]))
  return { mods, bySteamId, byPack, byBarePack, packOwners }
}

export function targetFor(index: CatalogIndex, pack: InstalledPack): ModTarget | undefined {
  if (pack.steamId) {
    const t = index.bySteamId.get(pack.steamId)
    if (t) return t
  }
  // Packs this app installed itself carry the mod they were downloaded for.
  if (pack.modId && index.mods.has(pack.modId)) return { mod: pack.modId }
  return index.byPack.get(pack.file.toLowerCase()) ?? index.byBarePack?.get(bareName(pack.file))
}

const bareName = (file: string) => file.toLowerCase().replace(/^[@!]+/, '')

/** Installed packs grouped by catalog target, plus the ones the catalog does not know. */
export function matchInstalled(index: CatalogIndex, packs: InstalledPack[]) {
  const known = new Map<string, InstalledPack[]>()
  const unknown: InstalledPack[] = []
  for (const p of packs) {
    const t = targetFor(index, p)
    if (!t) {
      unknown.push(p)
      continue
    }
    const key = targetKey(t)
    known.set(key, [...(known.get(key) ?? []), p])
    // A Workshop file is there for every mod that lists it (e.g. a mod that moved to Steam and its new items).
    for (const o of p.source === 'workshop' ? index.packOwners?.get(p.file.toLowerCase()) ?? [] : []) {
      if (o.steamId && p.steamId && o.steamId !== p.steamId) continue
      const other = `mod:${o.mod}`
      if (other !== key && !(known.get(other) ?? []).some((x) => x.path === p.path)) known.set(other, [...(known.get(other) ?? []), p])
    }
  }
  return { known, unknown }
}

export type EntryState = 'installed' | 'missing' | 'other-version'

export interface PresetEntryStatus {
  pack: string
  steamId?: string
  target?: ModTarget
  from: 'steam' | 'download'
  state: EntryState
  /** Pack actually found when state is 'other-version' (e.g. LL copy instead of Workshop). */
  found?: InstalledPack
}

/**
 * Compare a preset with what is installed. An entry counts as installed when its exact
 * Workshop item / pack is present; 'other-version' means the same catalog mod is installed
 * from another source (LL vs Steam) or under another pack name.
 */
export function presetStatus(index: CatalogIndex, preset: Preset, packs: InstalledPack[]): PresetEntryStatus[] {
  const bySteam = new Map(packs.filter((p) => p.steamId).map((p) => [p.steamId!, p]))
  const byFile = new Map(packs.map((p) => [p.file.toLowerCase(), p]))
  const byTarget = matchInstalled(index, packs).known
  return preset.entries.map((e) => {
    const base = { pack: e.pack, steamId: e.steamId, target: e.target, from: e.from }
    if (e.steamId && bySteam.has(e.steamId)) return { ...base, state: 'installed' as const }
    if (!e.steamId && byFile.has(e.pack.toLowerCase())) return { ...base, state: 'installed' as const }
    const alt = e.target ? byTarget.get(targetKey(e.target))?.[0] : undefined
    if (alt) return { ...base, state: 'other-version' as const, found: alt }
    return { ...base, state: 'missing' as const }
  })
}

export interface StaleWarning {
  pack: InstalledPack
  modId?: string
  reason: string
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${esc}$`)
}

/**
 * Data-folder packs that shadow Workshop copies. The game prefers data/ over the Workshop,
 * so an old LoversLab copy of a mod that moved to Steam breaks it.
 */
export function staleDataPacks(index: CatalogIndex, packs: InstalledPack[]): StaleWarning[] {
  const workshop = packs.filter((p) => p.source === 'workshop')
  const workshopFiles = new Set(workshop.map((p) => p.file.toLowerCase()))
  const workshopTargets = new Set(
    workshop.map((p) => targetFor(index, p)).filter((t): t is ModTarget => !!t).map(targetKey)
  )
  const warnings: StaleWarning[] = []
  // A pack from a community fix stands in for the Workshop copy on purpose, and so does one the app installed for a
  // current mod that lists it as its download (a working re-upload of a Workshop item with the same file name).
  const deliberate = (p: InstalledPack) => {
    const m = p.modId ? index.mods.get(p.modId) : undefined
    return !!m && m.status !== 'superseded' && m.status !== 'abandoned' &&
      !!m.packs?.some((x) => x.from === 'download' && x.file.toLowerCase() === p.file.toLowerCase()) &&
      !workshop.some((w) => w.file.toLowerCase() === p.file.toLowerCase() && (targetFor(index, w) as { mod?: string } | undefined)?.mod === m.id)
  }
  for (const p of packs.filter((x) => x.source === 'data' && !x.fix)) {
    const name = p.file.toLowerCase()
    if (workshopFiles.has(name) && deliberate(p)) continue
    if (workshopFiles.has(name)) {
      warnings.push({ pack: p, reason: 'Same file name as a subscribed Workshop item; the data copy wins and is probably outdated.' })
      continue
    }
    for (const m of index.mods.values()) {
      const rules = m.cleanup?.staleDataPacks
      if (!rules?.length || !workshopTargets.has(`mod:${m.id}`)) continue
      if (rules.some((g) => globToRegExp(g).test(name))) {
        warnings.push({ pack: p, modId: m.id, reason: m.cleanup!.note })
        break
      }
    }
  }
  return warnings
}
