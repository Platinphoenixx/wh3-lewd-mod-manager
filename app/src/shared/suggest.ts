import type { Catalog, Mod, Preset } from '@catalog/schema'
import type { CatalogIndex } from './match'
import { baseKeys, type Candidate, type Profile } from './profile'

/**
 * "Fill this profile": mods that fit the template's theme and that other players actually combine with
 * it, split into lewd and general mods. Only options that work with the profile are considered (no
 * conflicts, no "pick one" alternatives, nothing outdated); anything they need is added with them.
 *
 * Signals, strongest first: how many community lists for the same character use the mod; whether a
 * mod in the profile recommends or extends it; whether it is for the same character or faction; how
 * many community lists use it at all; Workshop subscribers / LoversLab downloads.
 */
export interface Suggestion {
  key: string
  mod: Mod
  /** At most two short reasons, most telling first. */
  reasons: string[]
  score: number
}

/** Factions and races as they appear in catalog tags, with the name to show. */
const FACTIONS: Record<string, string> = {
  cathay: 'Cathay', kislev: 'Kislev', slaanesh: 'Slaanesh', khorne: 'Khorne', nurgle: 'Nurgle', tzeentch: 'Tzeentch',
  'high elves': 'High Elves', 'dark elves': 'Dark Elves', 'wood elves': 'Wood Elves', empire: 'Empire', bretonnia: 'Bretonnia',
  'vampire counts': 'Vampire Counts', 'vampire coast': 'Vampire Coast', lizardmen: 'Lizardmen', skaven: 'Skaven',
  greenskins: 'Greenskins', beastmen: 'Beastmen', norsca: 'Norsca', 'warriors of chaos': 'Warriors of Chaos',
  'daemons of chaos': 'Daemons of Chaos', 'tomb kings': 'Tomb Kings', dwarfs: 'Dwarfs', 'ogre kingdoms': 'Ogre Kingdoms',
  'chaos dwarfs': 'Chaos Dwarfs'
}
const STORY_KINDS: Mod['kind'][] = ['campaign', 'progression']

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ').trim()
const short = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function suggestForProfile(
  catalog: Catalog, index: CatalogIndex, preset: Preset, profile: Pick<Profile, 'extras' | 'removed'>, options: Candidate[]
): { lewd: Suggestion[]; general: Suggestion[]; character: string } {
  const removed = new Set(profile.removed)
  const inProfile = new Set([...baseKeys(preset).filter((k) => !removed.has(k)), ...profile.extras])
  const profileMods = [...inProfile].flatMap((k) => (k.startsWith('mod:') && index.mods.get(k.slice(4)) ? [index.mods.get(k.slice(4))!] : []))

  // Community lists (tested lists and guides); those for one of the template's characters count most.
  const chars = preset.playAs.map(norm)
  const isChar = (c: string) => chars.some((x) => norm(c).includes(x.split(' ')[0]))
  const lists = catalog.presets.filter((p) => (p.origin === 'tested' || p.origin === 'guide') && p.id !== preset.id)
  const same = lists.filter((p) => p.playAs.some(isChar))
  const count = (ps: Preset[]) => {
    const c = new Map<string, number>()
    for (const p of ps) for (const id of new Set(p.entries.flatMap((e) => (e.target && 'mod' in e.target ? [e.target.mod] : [])))) c.set(id, (c.get(id) ?? 0) + 1)
    return c
  }
  const inLists = count(lists)
  const inSame = count(same)

  // The profile's theme: its characters and the factions its mods are about.
  const characters = new Map<string, string>()
  for (const m of catalog.mods) for (const p of m.playAs ?? []) characters.set(norm(p.character), p.character)
  const themeOf = (m: Mod) => [
    ...m.tags.map(norm).filter((t) => FACTIONS[t] || characters.has(t)).map((t) => FACTIONS[t] ?? characters.get(t)!),
    ...(m.playAs ?? []).map((p) => p.character)
  ]
  const theme = new Set([...profileMods.flatMap(themeOf), ...preset.playAs])
  // Templates may say "Miao"; the catalog's characters say "Miao Ying".
  const lead = preset.playAs[0] ?? preset.name
  const leadName = [...characters.values()].find((c) => norm(c).startsWith(norm(lead))) ?? lead

  const story = (m?: Mod) => !!m && STORY_KINDS.includes(m.kind)
  const out = { lewd: [] as Suggestion[], general: [] as Suggestion[], character: leadName }
  for (const c of options) {
    const m = c.mod
    if (!m || c.superseded || c.conflicts.length || c.alternativeTo.length || m.kind === 'translation' || m.kind === 'collection') continue
    if (['abandoned', 'superseded'].includes(m.status ?? '')) continue
    if (removed.has(c.key)) continue // the player took it out of the template on purpose
    // Nothing that would bring back what the player removed, or pull in a whole other campaign.
    if (c.addsDependencies.some((d) => removed.has(d))) continue
    const tie = c.reasons.find((r) => /^(Recommended by|Optional for|Extends) /.test(r))?.split(':')[0].replace(/^Extends /, 'Adds to ')
    const forChar = m.playAs?.find((p) => isChar(p.character))?.character
    const fits = [...new Set(themeOf(m).filter((t) => theme.has(t)))]
    // Another character's story, or something built on one, does not belong in this template.
    if (!tie && !forChar) {
      if (story(m)) continue
      if (c.addsDependencies.some((d) => d.startsWith('mod:') && story(index.mods.get(d.slice(4))))) continue
      const builtOn = m.relations.filter((r) => (r.kind === 'requires' || r.kind === 'extends') && 'mod' in r.target)
      if (builtOn.some((r) => 'mod' in r.target && story(index.mods.get(r.target.mod)) && !inProfile.has(`mod:${r.target.mod}`))) continue
    }
    const general = m.tags.includes('general')
    const k = inLists.get(m.id) ?? 0
    const ks = inSame.get(m.id) ?? 0
    if (general ? !(k || fits.length || tie) : !(ks || tie || forChar || fits.length)) continue

    const subs = Math.max(0, ...(m.sources.steam ?? []).map((s) => s.subscribers ?? 0))
    const downloads = m.sources.loverslab?.downloads ?? 0
    let score = 0
    const reasons: string[] = []
    if (ks) { score += 6 * ks + k; reasons.push(`In ${ks} of ${same.length} community lists for ${leadName}`) }
    else if (k) { score += k; reasons.push(`In ${k} of ${lists.length} community lists`) }
    if (tie) { score += 6; reasons.push(tie) }
    if (forChar) { score += 5; reasons.push(`For ${forChar}`) }
    else if (fits.length) { score += Math.min(4, fits.length * 1.5); reasons.push(`For ${fits.slice(0, 2).join(', ')}`) }
    if (subs) { score += Math.log10(subs); reasons.push(`${short(subs)} Workshop subscribers`) }
    else if (downloads) { score += Math.log10(downloads) + 0.5; reasons.push(`${short(downloads)} LoversLab downloads`) }
    out[general ? 'general' : 'lewd'].push({ key: c.key, mod: m, reasons: reasons.slice(0, 2), score })
  }
  for (const list of [out.lewd, out.general]) list.sort((a, b) => b.score - a.score || a.mod.name.localeCompare(b.mod.name))
  return out
}
