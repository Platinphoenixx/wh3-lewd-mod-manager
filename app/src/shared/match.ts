import type { Catalog, Mod, ModTarget, Preset } from '@catalog/schema'
import type { InstalledPack } from './api'

/** Lookup tables from Steam ids and pack names to catalog targets. */
export interface CatalogIndex {
  mods: Map<string, Mod>
  bySteamId: Map<string, ModTarget>
  byPack: Map<string, ModTarget>
  /** Catalog mods that list a pack as a Workshop file (lower case): that same file counts for all of them. */
  packOwners: Map<string, string[]>
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
  const packOwners = new Map<string, string[]>()
  for (const e of catalog.external) {
    if (e.steamId) bySteamId.set(e.steamId, { external: e.id })
  }
  for (const m of catalog.mods) {
    // Collections only bundle other items; they must not claim them.
    if (m.kind === 'collection') continue
    for (const s of m.sources.steam ?? []) if (!bySteamId.has(s.id)) bySteamId.set(s.id, { mod: m.id })
    for (const p of m.packs ?? []) {
      if (!byPack.has(p.file.toLowerCase())) byPack.set(p.file.toLowerCase(), { mod: m.id })
      const owners = packOwners.get(p.file.toLowerCase()) ?? []
      if (p.from === 'steam' && !owners.includes(m.id)) packOwners.set(p.file.toLowerCase(), [...owners, m.id])
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
  return { mods, bySteamId, byPack, packOwners }
}

export function targetFor(index: CatalogIndex, pack: InstalledPack): ModTarget | undefined {
  if (pack.steamId) {
    const t = index.bySteamId.get(pack.steamId)
    if (t) return t
  }
  // Packs this app installed itself carry the mod they were downloaded for.
  if (pack.modId && index.mods.has(pack.modId)) return { mod: pack.modId }
  return index.byPack.get(pack.file.toLowerCase())
}

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
    for (const id of p.source === 'workshop' ? index.packOwners?.get(p.file.toLowerCase()) ?? [] : []) {
      const other = `mod:${id}`
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
  for (const p of packs.filter((x) => x.source === 'data')) {
    const name = p.file.toLowerCase()
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
