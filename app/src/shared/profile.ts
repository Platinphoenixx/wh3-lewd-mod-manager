import type { Catalog, Mod, ModTarget, Preset, Relation } from '@catalog/schema'
import { parseTargetKey, targetKey, type CatalogIndex } from './match'
import { isOwnKey } from './own'
import { missingPacks, wantedPacks } from './install'

/** A user's profile: a community preset as base, plus switched-on extras and switched-off base entries. */
export interface Profile {
  id: string
  name: string
  presetId: string
  /** targetKeys of optional mods the user switched on. */
  extras: string[]
  /** targetKeys of base entries the user switched off (they stay in the load order view, switched off). */
  removed: string[]
  /** Added mods (extras, own mods) the player switched off in the load order: kept in the profile, not loaded or installed. */
  off?: string[]
  /** Positions the user chose for own mods: own key → key of the entry it sits above (null = bottom). */
  pins?: Record<string, string | null>
  /** Pick-one pack variants the player chose: entry key → exclusiveGroup → pack file (default: first installed). */
  variants?: Record<string, Record<string, string>>
  /** Suggestions the player turned down ("None of these"); they are not offered again. */
  declined?: string[]
  /** Community fixes the profile uses: mod id → fix id (Mod.fixes). */
  fixes?: Record<string, string>
  /**
   * A list imported from another launcher, kept as it was played: its load order (entry keys, highest priority first) and
   * the exact packs per entry. Nothing is added to it on its own; a mod the player adds later is placed by the catalog's rules.
   */
  imported?: { source: string; at: string; order: string[]; packs: Record<string, string[]> }
  /** Rule ids of points the player keeps as they are (Check tab). */
  keptPoints?: string[]
  /** Rule ids the player flagged as wrong → the day it was sent. */
  flagged?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type CandidateGroup = 'recommended' | 'character' | 'translation' | 'other' | 'general'
const GROUP_RANK: Record<CandidateGroup, number> = { recommended: 0, character: 1, translation: 2, other: 3, general: 4 }

export interface Candidate {
  key: string
  mod?: Mod
  name: string
  group: CandidateGroup
  /** Why it is offered: relation notes / "Extends X" / "For Alarielle". */
  reasons: string[]
  /** Profile mods this one conflicts with. */
  conflicts: string[]
  /** Profile mods this one is an alternative to (same exclusiveGroup: pick one). */
  alternativeTo: string[]
  /** Dependencies that would be added automatically. */
  addsDependencies: string[]
  /** Outdated/abandoned; only switched-on mods can have this (such mods are not offered). */
  superseded: boolean
}

export interface ResolvedEntry {
  key: string
  name: string
  /** 'base' = from the preset, 'extra' = switched on, 'dependency' = pulled in by an extra. */
  origin: 'base' | 'extra' | 'dependency'
  pack?: string
  /** Every pack the template lists for this mod (e.g. Azazel's Realm's main pack and its overwrite); all are loaded. */
  packs?: string[]
  steamId?: string
  from?: 'steam' | 'download'
  requiredBy?: string
  /** Set by the install step: the download packs of the mod still missing (all are fetched in one go). */
  need?: string[]
}

export interface ResolvedProfile {
  entries: ResolvedEntry[]
  conflicts: { a: string; b: string; note?: string }[]
  /**
   * Incompatibilities between mods a tested template contains together: the community played them
   * together, so the catalog's rule only applies in a special case (a variant, a faction, old versions).
   */
  notes: { a: string; b: string; note?: string }[]
}

const OPTIONAL_KINDS: Relation['kind'][] = ['recommends', 'optional']

export function nameOf(catalog: Catalog, index: CatalogIndex, key: string): string {
  const t = parseTargetKey(key)
  if ('mod' in t) return index.mods.get(t.mod)?.name ?? t.mod
  if ('external' in t) return catalog.external.find((e) => e.id === t.external)?.name ?? t.external
  if ('steamId' in t) return `Steam ${t.steamId}`
  return t.pack
}

/** Target keys of the preset's entries (entries without a known target fall back to their pack). */
export function baseKeys(preset: Preset): string[] {
  return preset.entries.map((e) => targetKey(e.target ?? (e.steamId ? { steamId: e.steamId } : { pack: e.pack })))
}

function relationsOf(index: CatalogIndex, key: string): Relation[] {
  const t = parseTargetKey(key)
  return 'mod' in t ? index.mods.get(t.mod)?.relations ?? [] : []
}

/**
 * The packs an entry loads, for requirements tied to one pack (`whenPack`): the template's packs when it names them,
 * else what the install step fetches (needed packs, the profile's characters' version of a pick-one group).
 */
export type PacksOf = (key: string) => string[] | undefined
export function defaultPacksOf(index: CatalogIndex, characters: string[] = [], known: Map<string, string[]> = new Map()): PacksOf {
  return (key) => {
    if (known.has(key)) return known.get(key)
    const t = parseTargetKey(key)
    const mod = 'mod' in t ? index.mods.get(t.mod) : undefined
    if (!mod) return undefined
    const need = missingPacks(mod, undefined, []).map((p) => p.file)
    return need.length ? need : wantedPacks(mod, undefined, characters) ?? []
  }
}

/** All dependencies (transitively) of the given keys that are not in `have`. */
export function missingDependencies(index: CatalogIndex, keys: string[], have: Set<string>, packsOf?: PacksOf): Map<string, string> {
  const added = new Map<string, string>() // dependency key -> required by key
  const queue = [...keys]
  // A mod that replaces the required one does its job (Soil's merged pack for Soil's Corrupted Units).
  const replaced = (dk: string) => [...have, ...keys, ...added.keys()]
    .some((k) => relationsOf(index, k).some((r) => r.kind === 'supersedes' && targetKey(r.target) === dk))
  while (queue.length) {
    const k = queue.shift()!
    for (const r of relationsOf(index, k)) {
      if (r.kind !== 'requires') continue
      // A condition the app can read is a pack of the mod itself; other conditions stay with the player.
      if (r.condition && !(r.whenPack && packsOf?.(k)?.some((p) => p.toLowerCase() === r.whenPack!.toLowerCase()))) continue
      const dk = targetKey(r.target)
      if (have.has(dk) || added.has(dk) || replaced(dk)) continue
      added.set(dk, k)
      queue.push(dk)
    }
  }
  return added
}

/**
 * The profile as it is loaded: added mods switched off in the load order (`off`) left out. Template mods switched off
 * are in `removed` already.
 */
export function activeProfile<P extends Pick<Profile, 'extras' | 'removed' | 'off'>>(profile: P): P {
  const off = new Set(profile.off ?? [])
  return off.size ? { ...profile, extras: profile.extras.filter((k) => !off.has(k)) } : profile
}

/** The profile with everything switched on: what the load order view lists, the switched-off mods in their places. */
export function everythingOn<P extends Pick<Profile, 'extras' | 'removed' | 'off'>>(profile: P): P {
  return { ...profile, removed: [], off: [] }
}

/**
 * What else has to go when `key` is switched off: the loaded mods that need it, and the mods that need those (strict
 * requirements, the same the profile builder follows). `loaded` is the load order as it is now.
 */
export function dependentsOf(index: CatalogIndex, loaded: string[], key: string, packsOf?: PacksOf): string[] {
  const gone = new Set([key])
  for (let grew = true; grew;) {
    grew = false
    const have = new Set(loaded.filter((k) => !gone.has(k)))
    for (const k of have) {
      const needs = missingDependencies(index, [k], have, packsOf)
      if ([...needs.keys()].some((d) => gone.has(d))) { gone.add(k); grew = true }
    }
  }
  gone.delete(key)
  return loaded.filter((k) => gone.has(k))
}

/** Incompatibility pairs inside a set of keys (declared on either side). */
export function conflictsIn(index: CatalogIndex, keys: string[], packsOf?: PacksOf): ResolvedProfile['conflicts'] {
  const set = new Set(keys)
  const out: ResolvedProfile['conflicts'] = []
  const seen = new Set<string>()
  for (const k of keys) {
    for (const r of relationsOf(index, k)) {
      // Rules with a condition ('only when playing as Miao') are not a general conflict, unless the condition is one of
      // the mod's own packs and that pack is loaded (Beauty and Beasts with the full Community Beastmen).
      if (r.kind !== 'incompatible') continue
      if (r.condition && !(r.whenPack && packsOf?.(k)?.some((p) => p.toLowerCase() === r.whenPack!.toLowerCase()))) continue
      const other = targetKey(r.target)
      const pair = [k, other].sort().join('|')
      if (set.has(other) && !seen.has(pair)) {
        seen.add(pair)
        out.push({ a: k, b: other, note: r.note })
      }
    }
  }
  return out
}

function isSuperseded(index: CatalogIndex, key: string): boolean {
  const t = parseTargetKey(key)
  return 'mod' in t && ['superseded', 'abandoned'].includes(index.mods.get(t.mod)?.status ?? '')
}

/**
 * Everything the user could add to a profile, grouped by how closely it relates to it.
 * Translations are offered only when they translate something in the profile.
 */
export function candidates(catalog: Catalog, index: CatalogIndex, preset: Preset, profile: Pick<Profile, 'extras' | 'removed' | 'imported' | 'variants'>): Candidate[] {
  const removed = new Set(profile.removed)
  const chosen = [...baseKeys(preset).filter((k) => !removed.has(k)), ...profile.extras]
  // What the extras pull in is part of the profile too (a conflict with SFO counts when a switched-on patch needs SFO).
  const known = new Map<string, string[]>()
  preset.entries.forEach((e, i) => { const k = baseKeys(preset)[i]; known.set(k, [...(known.get(k) ?? []), e.pack]) })
  // The version the player chose for an added mod is the one it loads (resolveProfile does the same).
  for (const k of profile.extras) if (!known.has(k) && profile.variants?.[k]) known.set(k, Object.values(profile.variants[k]))
  const packsOf = defaultPacksOf(index, preset.playAs, known)
  // A relation that holds for one version of a mod ("with the full version") counts while the list loads that version.
  const loads = (key: string, pack?: string) => !pack || !!packsOf(key)?.some((p) => p.toLowerCase() === pack.toLowerCase())
  // (An imported list pulls nothing in: what its mods miss is not part of it, so nothing is offered as an add-on of that.)
  const asPlayed = new Set(profile.imported?.order ?? [])
  const current = [...chosen, ...missingDependencies(index, chosen.filter((k) => !asPlayed.has(k)), new Set(chosen), packsOf).keys()]
  const inProfile = new Set(current)
  const found = new Map<string, Candidate>()

  // Alternatives: options that share an exclusiveGroup on the same mod ("pick one of these versions").
  const groupMembers = new Map<string, string[]>()
  for (const k of current) {
    for (const r of relationsOf(index, k)) {
      if (!r.exclusiveGroup) continue
      const g = `${k}#${r.exclusiveGroup}`
      groupMembers.set(g, [...(groupMembers.get(g) ?? []), targetKey(r.target)])
    }
  }
  const alternativesOf = (key: string) =>
    [...groupMembers.values()].filter((ms) => ms.includes(key)).flat().filter((m) => m !== key && inProfile.has(m))

  // Packs the profile already loads: a mod whose own packs are all among them (a LoversLab page bundling two
  // Workshop items, say) adds nothing.
  const loaded = new Set([
    ...preset.entries.filter((e) => !removed.has(baseKeys({ ...preset, entries: [e] })[0])).map((e) => e.pack.toLowerCase()),
    ...profile.extras.flatMap((k) => (k.startsWith('mod:') ? index.mods.get(k.slice(4))?.packs ?? [] : []).map((p) => p.file.toLowerCase()))
  ])
  const alreadyLoaded = (mod?: Mod) => {
    const needed = (mod?.packs ?? []).filter((p) => !p.optional && !p.exclusiveGroup)
    return needed.length > 0 && needed.every((p) => loaded.has(p.file.toLowerCase()))
  }

  const add = (key: string, group: CandidateGroup, reason: string) => {
    if (inProfile.has(key) || isSuperseded(index, key)) return
    const t = parseTargetKey(key)
    if ('steamId' in t || 'pack' in t) return // unknown to the catalog, nothing to show
    const mod = 'mod' in t ? index.mods.get(t.mod) : undefined
    if (alreadyLoaded(mod)) return
    if (mod?.kind === 'translation') group = 'translation'
    const c = found.get(key)
    if (c) {
      if (GROUP_RANK[group] < GROUP_RANK[c.group]) c.group = group
      if (reason && !c.reasons.includes(reason)) c.reasons.push(reason)
      return
    }
    found.set(key, {
      key, mod, name: nameOf(catalog, index, key), group, reasons: reason ? [reason] : [],
      conflicts: [], alternativeTo: [], addsDependencies: [], superseded: false
    })
  }

  // 1. What the profile's mods recommend, and what extends them (submods, patches, translations).
  for (const k of current) {
    const from = nameOf(catalog, index, k)
    for (const r of relationsOf(index, k)) {
      if (OPTIONAL_KINDS.includes(r.kind) && loads(k, r.whenPack)) add(targetKey(r.target), 'recommended', `${r.kind === 'optional' ? 'Optional for' : 'Recommended by'} ${from}${r.note ? `: ${r.note}` : ''}`)
    }
  }
  // What the community behind a setup recommends with it, and what runs against its point (shown with the reason).
  for (const x of preset.recommends ?? []) add(targetKey(x.target), 'recommended', `Recommended for this setup${x.note ? `: ${x.note}` : ''}`)
  for (const x of preset.avoid ?? []) add(targetKey(x.target), 'other', `Not for this setup: ${x.note}`)
  for (const m of catalog.mods) {
    for (const r of m.relations) {
      if (r.kind === 'extends' && inProfile.has(targetKey(r.target)) && loads(targetKey(r.target), r.pack)) {
        add(`mod:${m.id}`, 'recommended', `Extends ${nameOf(catalog, index, targetKey(r.target))}`)
      }
      // An add-on that needs a profile mod is built on it too (Community Beastmen slaves for Marks of the Wild), unless
      // what it needs is only a framework or shared assets many unrelated mods use, or it is a campaign of its own.
      const base = r.kind === 'requires' && 'mod' in r.target ? index.mods.get(r.target.mod) : undefined
      if (base && inProfile.has(`mod:${base.id}`) && !['framework', 'utility', 'assets'].includes(base.kind) &&
          !['campaign', 'progression'].includes(m.kind) && !r.condition && loads(`mod:${base.id}`, r.pack)) {
        add(`mod:${m.id}`, 'recommended', `Extends ${base.name}`)
      }
    }
  }
  // 2. Mods for the preset's characters.
  const chars = preset.playAs.map((c) => c.toLowerCase())
  for (const m of catalog.mods) {
    const hit = m.playAs?.find((p) => chars.some((c) => p.character.toLowerCase().includes(c.split(' ')[0])))
    if (hit) add(`mod:${m.id}`, 'character', `For ${hit.character}`)
  }
  // 3. The rest of the catalog (no translations of things that are not in the profile, no collections);
  //    normal gameplay/UI mods (tag "general") in their own group.
  for (const m of catalog.mods) {
    if (m.kind === 'translation' || m.kind === 'collection') continue
    add(`mod:${m.id}`, m.tags.includes('general') ? 'general' : 'other', '')
  }
  const list = [...found.values()]
  for (const c of list) {
    c.alternativeTo = alternativesOf(c.key)
    c.addsDependencies = [...missingDependencies(index, [c.key], inProfile, packsOf).keys()]
    // What it brings along counts too: a submod that pulls in SFO conflicts with what SFO conflicts with.
    const brings = new Set([c.key, ...c.addsDependencies])
    c.conflicts = [...new Set(conflictsIn(index, [...current, ...brings], packsOf)
      .filter((p) => brings.has(p.a) !== brings.has(p.b))
      .map((p) => (brings.has(p.a) ? p.b : p.a)))]
  }
  return list.sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.name.localeCompare(b.name))
}

/**
 * The final mod list of a profile in load order (first = highest priority).
 * Base entries keep the preset's tested order. Extras are placed by their load-order rules, otherwise
 * right above the profile mod they extend or relate to, otherwise reskins on top and the rest at the bottom.
 */
export function resolveProfile(catalog: Catalog, index: CatalogIndex, preset: Preset, profile: Pick<Profile, 'extras' | 'removed' | 'imported' | 'variants'>): ResolvedProfile {
  const removed = new Set(profile.removed)
  const entries: ResolvedEntry[] = []
  preset.entries.forEach((e, i) => {
    const key = baseKeys(preset)[i]
    if (removed.has(key)) return
    const known = entries.find((x) => x.key === key)
    if (known) {
      // A second pack of the same mod in the template: it belongs to that entry and is loaded with it.
      if (!known.packs?.some((p) => p.toLowerCase() === e.pack.toLowerCase())) known.packs = [...(known.packs ?? []), e.pack]
      return
    }
    entries.push({ key, name: nameOf(catalog, index, key), origin: 'base', pack: e.pack, packs: [e.pack], steamId: e.steamId, from: e.from })
  })

  const have = new Set(entries.map((e) => e.key))
  // The player's own mods are placed later from their pack contents (placeOwnMods).
  const allExtras = profile.extras.filter((k) => !have.has(k) && !isOwnKey(k))
  // An imported list stays as it was played: its mods in its order with its packs, and nothing pulled in on their account
  // (the Check tab says what the catalog misses). Only what the player adds later is placed and completed as usual.
  const listed = new Map((profile.imported?.order ?? []).map((k, i) => [k, i]))
  for (const k of allExtras) if (listed.has(k)) entries.push({ key: k, name: nameOf(catalog, index, k), origin: 'extra' })
  if (listed.size) {
    entries.sort((a, b) => (listed.get(a.key) ?? Infinity) - (listed.get(b.key) ?? Infinity))
    for (const e of entries) {
      const packs = profile.imported?.packs[e.key]
      if (packs?.length) { e.pack = packs[0]; e.packs = packs }
    }
  }
  const extras = allExtras.filter((k) => !listed.has(k))
  const deps = missingDependencies(index, extras, new Set([...entries.map((e) => e.key), ...extras]), defaultPacksOf(index, preset.playAs, new Map(entries.map((e) => [e.key, e.packs ?? []]))))
  const toPlace: ResolvedEntry[] = [
    ...extras.map((k) => ({ key: k, name: nameOf(catalog, index, k), origin: 'extra' as const })),
    ...[...deps].map(([k, by]) => ({ key: k, name: nameOf(catalog, index, k), origin: 'dependency' as const, requiredBy: nameOf(catalog, index, by) }))
  ]

  for (const e of toPlace) {
    const t = parseTargetKey(e.key)
    const mod = 'mod' in t ? index.mods.get(t.mod) : undefined
    const keysNow = entries.map((x) => x.key)
    const above = (mod?.loadOrder?.above ?? []).map(targetKey).map((k) => keysNow.indexOf(k)).filter((i) => i >= 0)
    const below = (mod?.loadOrder?.below ?? []).map(targetKey).map((k) => keysNow.indexOf(k)).filter((i) => i >= 0)
    const related = (mod?.relations ?? [])
      .filter((r) => ['extends', 'requires'].includes(r.kind))
      .map((r) => keysNow.indexOf(targetKey(r.target)))
      .filter((i) => i >= 0)
    let pos: number
    if (above.length) pos = Math.min(...above) // directly above the highest-priority mod it must beat
    else if (below.length) pos = Math.max(...below) + 1
    else if (related.length && (mod?.kind === 'translation' || mod?.kind === 'patch' || mod?.kind === 'submod')) pos = Math.min(...related)
    else if (e.origin === 'dependency') pos = entries.length // dependencies go low so dependants win
    // A look the player picked has to beat the template's mods that change the same models (its own reskins, asset
    // packs): reskins go on top, as players place them.
    // An army's look goes below the character looks the player picked: a look of the lord (the Sisters of Twilight) must
    // beat the army reskin that changes the lord too.
    else if (mod?.kind === 'reskin' && !related.length && mod.factionLook?.length) {
      const look = (x: ResolvedEntry) => { const m = x.origin !== 'base' && x.key.startsWith('mod:') ? index.mods.get(x.key.slice(4)) : undefined; return m?.kind === 'reskin' && !m.factionLook?.length }
      pos = entries.findIndex((x) => !look(x))
      if (pos < 0) pos = entries.length
    }
    else if (mod?.kind === 'reskin' && !related.length) pos = 0
    else pos = related.length ? Math.min(...related) : entries.length
    entries.splice(pos, 0, e)
  }
  // A requirement can name the pack it needs of a mod with versions; an entry that does not fix its pack takes that one.
  for (const e of entries) {
    for (const r of relationsOf(index, e.key)) {
      if (r.kind !== 'requires' || !r.pack || r.condition) continue
      const dep = entries.find((x) => x.key === targetKey(r.target))
      if (!dep || listed.has(dep.key)) continue
      // A template entry keeps its packs and gets the needed one too; an added mod loads just that version.
      if (dep.origin === 'base') { if (!dep.packs?.some((x) => x.toLowerCase() === r.pack!.toLowerCase())) dep.packs = [...(dep.packs ?? []), r.pack] }
      else { dep.pack = r.pack; dep.packs = [r.pack] }
    }
  }
  // A version the player chose for an added mod (Community Beastmen's Light version) is the one it needs and loads, even
  // when another version is installed (its Steam full version): the install step fetches it, the launch takes exactly it.
  for (const e of entries) {
    const chosen = profile.variants?.[e.key]
    const mod = e.origin !== 'base' && !listed.has(e.key) && chosen && e.key.startsWith('mod:') ? index.mods.get(e.key.slice(4)) : undefined
    if (!mod || !chosen || e.pack) continue
    const groups = new Set<string>()
    const packs = mod.packs.filter((p) => !p.optional).flatMap((p) => {
      if (!p.exclusiveGroup) return [p.file]
      if (groups.has(p.exclusiveGroup)) return []
      groups.add(p.exclusiveGroup)
      const want = chosen[p.exclusiveGroup]
      return [mod.packs.some((x) => x.exclusiveGroup === p.exclusiveGroup && x.file === want) ? want : p.file]
    })
    if (packs.length) { e.pack = packs[0]; e.packs = packs }
  }
  const loaded = new Map(entries.map((e) => [e.key, e.packs ?? (e.pack ? [e.pack] : undefined)]))
  const all = conflictsIn(index, entries.map((e) => e.key), (k) => loaded.get(k) ?? defaultPacksOf(index, preset.playAs)(k))
  const testedTogether = preset.origin === 'tested' ? new Set(entries.filter((e) => e.origin === 'base').map((e) => e.key)) : new Set<string>()
  const together = (c: { a: string; b: string }) => testedTogether.has(c.a) && testedTogether.has(c.b)
  return { entries, conflicts: all.filter((c) => !together(c)), notes: all.filter(together) }
}
