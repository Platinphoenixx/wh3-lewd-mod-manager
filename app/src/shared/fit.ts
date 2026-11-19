import type { Catalog, Mod, Preset } from '@catalog/schema'
import { targetKey, type CatalogIndex } from './match'
import { activeProfile, candidates, everythingOn, nameOf, resolveProfile, type Profile } from './profile'

/**
 * How a catalog mod would fit one of the player's profiles ("Add to profile ▾" in the catalog): already in it, fits (and
 * what comes along), or why not – the same rules the editor's suggestions and its conflict check use.
 */
export type FitState = 'in' | 'off' | 'fits' | 'avoided' | 'conflict' | 'alternative' | 'other-story' | 'stops' | 'outdated'

export interface Fit {
  state: FitState
  text: string
  /** Whether "Add" is offered (for 'avoided' as "Add anyway", for 'off' as "Switch on"). */
  canAdd: boolean
  /** Mods that come along (what it needs that the profile does not have). */
  adds: string[]
}

const STORY_KINDS: Mod['kind'][] = ['campaign', 'progression']
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

export function fitInProfile(catalog: Catalog, index: CatalogIndex, preset: Preset, profile: Profile, key: string): Fit {
  const mod = key.startsWith('mod:') ? index.mods.get(key.slice(4)) : undefined
  const names = (keys: string[]) => keys.map((k) => nameOf(catalog, index, k))
  const all = resolveProfile(catalog, index, preset, everythingOn(profile))
  if (all.entries.some((e) => e.key === key)) {
    const on = resolveProfile(catalog, index, preset, activeProfile(profile)).entries.some((e) => e.key === key)
    return on ? { state: 'in', text: 'already in this profile', canAdd: false, adds: [] }
      : { state: 'off', text: 'in this profile, switched off', canAdd: true, adds: [] }
  }
  if (mod?.stopsGame) return { state: 'stops', text: 'the game does not start with it', canAdd: false, adds: [] }
  const avoid = (preset.avoid ?? []).find((a) => targetKey(a.target) === key)
  const c = candidates(catalog, index, preset, profile).find((x) => x.key === key)
  const characters = new Set([...preset.playAs, ...(profile.playAs ?? [])].map(norm))
  const otherStory = !!mod && STORY_KINDS.includes(mod.kind) && !!mod.playAs?.length && !mod.playAs.some((p) => characters.has(norm(p.character)))
  if (c?.conflicts.length) {
    return { state: otherStory ? 'other-story' : 'conflict', canAdd: false, adds: [],
      text: `${otherStory ? 'another character’s campaign – ' : ''}conflicts with ${names(c.conflicts).join(', ')}` }
  }
  if (otherStory) return { state: 'other-story', text: 'another character’s campaign', canAdd: false, adds: [] }
  if (c?.alternativeTo.length) {
    return { state: 'alternative', canAdd: false, adds: [], text: `an alternative to ${names(c.alternativeTo).join(', ')} – use only one` }
  }
  if (c?.superseded || ['superseded', 'abandoned'].includes(mod?.status ?? '')) {
    const by = catalog.mods.find((m) => m.relations.some((r) => r.kind === 'supersedes' && 'mod' in r.target && r.target.mod === mod?.id))
    return { state: 'outdated', canAdd: false, adds: [], text: by ? `outdated – ${by.name} replaces it` : 'outdated' }
  }
  const adds = names(c?.addsDependencies ?? [])
  const along = adds.length ? ` · + ${adds.length} it needs come${adds.length === 1 ? 's' : ''} along` : ''
  if (avoid) return { state: 'avoided', canAdd: true, adds, text: `the setup avoids it: ${avoid.note}${along}` }
  return { state: 'fits', canAdd: true, adds, text: `fits${along}` }
}

/** The profile with the mod added (switched back on when it was there, switched off). */
export function withMod(profile: Profile, key: string): Profile {
  return {
    ...profile,
    extras: profile.extras.includes(key) ? profile.extras : [...profile.extras, key],
    removed: profile.removed.filter((k) => k !== key),
    off: profile.off?.filter((k) => k !== key),
    updatedAt: new Date().toISOString()
  }
}

/** What a mod still needs that is not installed, by strict requirement, for the catalog's "+ N it needs". */
export function missingNeeds(index: CatalogIndex, mod: Mod, installed: (key: string) => boolean): Mod[] {
  const out = new Map<string, Mod>()
  const walk = (m: Mod) => {
    for (const r of m.relations) {
      if (r.kind !== 'requires' || r.condition || r.whenPack || !('mod' in r.target)) continue
      const dep = index.mods.get(r.target.mod)
      if (!dep || out.has(dep.id) || dep.id === mod.id) continue
      // A requirement another catalog mod supersedes is met by that one (the profile builder does the same).
      const successor = index.mods.get([...index.mods.values()].find((x) => x.relations.some((s) => s.kind === 'supersedes' && 'mod' in s.target && s.target.mod === dep.id))?.id ?? '')
      const need = successor ?? dep
      if (installed(`mod:${need.id}`) || out.has(need.id)) continue
      out.set(need.id, need)
      walk(need)
    }
  }
  walk(mod)
  return [...out.values()]
}
