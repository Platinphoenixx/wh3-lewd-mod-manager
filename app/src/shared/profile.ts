import type { Catalog, Mod, ModTarget, Preset, Relation } from '@catalog/schema'
import { parseTargetKey, targetKey, type CatalogIndex } from './match'
import { isOwnKey } from './own'

/** A user's profile: a community preset as base, plus switched-on extras and switched-off base entries. */
export interface Profile {
  id: string
  name: string
  presetId: string
  /** targetKeys of optional mods the user switched on. */
  extras: string[]
  /** targetKeys of base entries the user switched off. */
  removed: string[]
  /** Positions the user chose for own mods: own key → key of the entry it sits above (null = bottom). */
  pins?: Record<string, string | null>
  /** Pick-one pack variants the player chose: entry key → exclusiveGroup → pack file (default: first installed). */
  variants?: Record<string, Record<string, string>>
  /** Suggestions the player turned down ("None of these"); they are not offered again. */
  declined?: string[]
  /** Community fixes the profile uses: mod id → fix id (Mod.fixes). */
  fixes?: Record<string, string>
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

/** All dependencies (transitively) of the given keys that are not in `have`. */
export function missingDependencies(index: CatalogIndex, keys: string[], have: Set<string>): Map<string, string> {
  const added = new Map<string, string>() // dependency key -> required by key
  const queue = [...keys]
  // A mod that replaces the required one does its job (Soil's merged pack for Soil's Corrupted Units).
  const replaced = (dk: string) => [...have, ...keys, ...added.keys()]
    .some((k) => relationsOf(index, k).some((r) => r.kind === 'supersedes' && targetKey(r.target) === dk))
  while (queue.length) {
    const k = queue.shift()!
    for (const r of relationsOf(index, k)) {
      if (r.kind !== 'requires' || r.condition) continue
      const dk = targetKey(r.target)
      if (have.has(dk) || added.has(dk) || replaced(dk)) continue
      added.set(dk, k)
      queue.push(dk)
    }
  }
  return added
}

/** Incompatibility pairs inside a set of keys (declared on either side). */
export function conflictsIn(index: CatalogIndex, keys: string[]): ResolvedProfile['conflicts'] {
  const set = new Set(keys)
  const out: ResolvedProfile['conflicts'] = []
  const seen = new Set<string>()
  for (const k of keys) {
    for (const r of relationsOf(index, k)) {
      // Rules with a condition ('only when playing as Miao') are not a general conflict.
      if (r.kind !== 'incompatible' || r.condition) continue
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
export function candidates(catalog: Catalog, index: CatalogIndex, preset: Preset, profile: Pick<Profile, 'extras' | 'removed'>): Candidate[] {
  const removed = new Set(profile.removed)
  const chosen = [...baseKeys(preset).filter((k) => !removed.has(k)), ...profile.extras]
  // What the extras pull in is part of the profile too (a conflict with SFO counts when a switched-on patch needs SFO).
  const current = [...chosen, ...missingDependencies(index, chosen, new Set(chosen)).keys()]
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
      if (OPTIONAL_KINDS.includes(r.kind)) add(targetKey(r.target), 'recommended', `${r.kind === 'optional' ? 'Optional for' : 'Recommended by'} ${from}${r.note ? `: ${r.note}` : ''}`)
    }
  }
  for (const m of catalog.mods) {
    for (const r of m.relations) {
      if (r.kind === 'extends' && inProfile.has(targetKey(r.target))) {
        add(`mod:${m.id}`, 'recommended', `Extends ${nameOf(catalog, index, targetKey(r.target))}`)
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
    c.addsDependencies = [...missingDependencies(index, [c.key], inProfile).keys()]
    // What it brings along counts too: a submod that pulls in SFO conflicts with what SFO conflicts with.
    const brings = new Set([c.key, ...c.addsDependencies])
    c.conflicts = [...new Set(conflictsIn(index, [...current, ...brings])
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
export function resolveProfile(catalog: Catalog, index: CatalogIndex, preset: Preset, profile: Pick<Profile, 'extras' | 'removed'>): ResolvedProfile {
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
  const extras = profile.extras.filter((k) => !have.has(k) && !isOwnKey(k))
  const deps = missingDependencies(index, extras, new Set([...have, ...extras]))
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
    else if (mod?.kind === 'reskin' && !related.length) pos = 0
    else pos = related.length ? Math.min(...related) : entries.length
    entries.splice(pos, 0, e)
  }
  const all = conflictsIn(index, entries.map((e) => e.key))
  const testedTogether = preset.origin === 'tested' ? new Set(entries.filter((e) => e.origin === 'base').map((e) => e.key)) : new Set<string>()
  const together = (c: { a: string; b: string }) => testedTogether.has(c.a) && testedTogether.has(c.b)
  return { entries, conflicts: all.filter((c) => !together(c)), notes: all.filter(together) }
}
