import type { Catalog, Mod, Preset } from '@catalog/schema'
import { targetKey, type CatalogIndex } from './match'
import { baseKeys, conflictsIn, type Candidate, type Profile } from './profile'

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
  /** Players of this kind of list really use it: in a list for the same character, tied to a profile mod, or for the character. */
  strong: boolean
  /** Built on, recommended by or an option of a mod in the template (what its players get from it). */
  tied: boolean
  /** For the template's character or faction. */
  fits: boolean
  /** Reskins in the profile it would replace (same character, last loaded wins). */
  replaces?: string[]
  /** In how many community lists for the same character that fit this one. */
  sameLists: number
  /** A mod in the list changes this character's model by stage, so this look only holds until then. */
  until?: LookUntil
}

/** The mod in the list that changes a character's look by stage. */
export interface LookUntil {
  character: string
  stages?: number
  /** Key and name of that mod; `campaign` when it is the character's story, not a reskin pack. */
  key: string
  by: string
  campaign: boolean
  image?: string
  /** This look also changes some textures the stages use. */
  partly?: boolean
}

/** Suggestions that do not go together (two reskins of the same character, incompatible mods): pick one. */
export interface PickOne {
  pick: Suggestion[]
  /** Why only one can be used, e.g. "They all change how Miao Ying looks". */
  note: string
  score: number
  /** The option selected at first, or none: only an option players of this list really use and that replaces nothing. */
  preselect?: string
  /** A mod in the list already changes this character's look by stage: keeping that is the first choice. */
  stage?: LookUntil
}

export type SuggestionEntry = Suggestion | PickOne
export const isPickOne = (e: SuggestionEntry): e is PickOne => 'pick' in e

/** Factions and races as they appear in catalog tags, with the name to show. */
export const FACTIONS: Record<string, string> = {
  cathay: 'Cathay', kislev: 'Kislev', slaanesh: 'Slaanesh', khorne: 'Khorne', nurgle: 'Nurgle', tzeentch: 'Tzeentch',
  'high elves': 'High Elves', 'dark elves': 'Dark Elves', 'wood elves': 'Wood Elves', empire: 'Empire', bretonnia: 'Bretonnia',
  'vampire counts': 'Vampire Counts', 'vampire coast': 'Vampire Coast', lizardmen: 'Lizardmen', skaven: 'Skaven',
  greenskins: 'Greenskins', beastmen: 'Beastmen', norsca: 'Norsca', 'warriors of chaos': 'Warriors of Chaos',
  'daemons of chaos': 'Daemons of Chaos', 'tomb kings': 'Tomb Kings', dwarfs: 'Dwarfs', 'ogre kingdoms': 'Ogre Kingdoms',
  'chaos dwarfs': 'Chaos Dwarfs', 'undead legions': 'Undead Legions'
}
const STORY_KINDS: Mod['kind'][] = ['campaign', 'progression']

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ').trim()
const short = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function suggestForProfile(
  catalog: Catalog, index: CatalogIndex, preset: Preset, profile: Pick<Profile, 'extras' | 'removed' | 'imported'>, options: Candidate[]
): { lewd: SuggestionEntry[]; general: SuggestionEntry[]; character: string } {
  const removed = new Set(profile.removed)
  const inProfile = new Set([...baseKeys(preset).filter((k) => !removed.has(k)), ...profile.extras])
  const profileMods = [...inProfile].flatMap((k) => (k.startsWith('mod:') && index.mods.get(k.slice(4)) ? [index.mods.get(k.slice(4))!] : []))
  // An imported list is only as close to its template as it happens to be: its own mods are the template here.
  const listedKeys = profile.imported ? profile.extras.filter((k) => profile.imported!.order.includes(k)) : []
  const listedChars = listedKeys.flatMap((k) => {
    const m = k.startsWith('mod:') ? index.mods.get(k.slice(4)) : undefined
    return m && STORY_KINDS.includes(m.kind) ? (m.playAs ?? []).map((p) => p.character) : []
  })

  // Community lists (tested lists and guides); those for one of the template's characters count most.
  const chars = [...preset.playAs, ...listedChars].map(norm)
  const isChar = (c: string) => chars.some((x) => norm(c).includes(x.split(' ')[0]))
  // A list built on something the template cannot be combined with is another setup, even for the same character
  // (Readman's Miao lists run on Lazy's progression, which Lin's Corrupted Ascension is incompatible with).
  const templateKeys = [...baseKeys(preset).filter((k) => !removed.has(k)), ...listedKeys]
  const own = new Set(templateKeys)
  const clashes = (p: Preset) => {
    const keys = p.entries.flatMap((e) => (e.target ? [targetKey(e.target)] : [])).filter((k) => !own.has(k))
    return conflictsIn(index, [...templateKeys, ...new Set(keys)]).some((c) => own.has(c.a) !== own.has(c.b))
  }
  const lists = catalog.presets.filter((p) => (p.origin === 'tested' || p.origin === 'guide') && p.id !== preset.id && !clashes(p))
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
  // Lords played in the game's own campaign have no mod that names them as playable; their template does.
  for (const p of catalog.presets) if (p.origin === 'vanilla') for (const c of p.playAs) characters.set(norm(c), p.playAs[0])
  const themeOf = (m: Mod) => [
    ...m.tags.map(norm).filter((t) => FACTIONS[t] || characters.has(t)).map((t) => FACTIONS[t] ?? characters.get(t)!),
    ...(m.playAs ?? []).map((p) => p.character)
  ]
  // Only the template's own mods set it: an add-on the player switched on (the Community Beastmen Slaanesh version,
  // tagged for the Slaanesh lords that use it) must not turn a Beastmen list into a Slaanesh one.
  const templateMods = templateKeys.filter((k) => k.startsWith('mod:')).flatMap((k) => index.mods.get(k.slice(4)) ?? [])
  const theme = new Set([...templateMods.flatMap(themeOf), ...preset.playAs, ...listedChars, ...(preset.factions ?? []).map((f) => FACTIONS[norm(f)] ?? f)])
  // Templates may say "Miao"; the catalog's characters say "Miao Ying".
  const lead = preset.playAs[0] ?? preset.name
  const leadName = [...characters.values()].find((c) => norm(c).startsWith(norm(lead))) ?? lead

  // Reskins already in the profile, by the character they change.
  const profileSkins = new Map<string, string[]>()
  for (const m of profileMods.filter((x) => x.kind === 'reskin')) for (const c of reskinSubjects(m, characters)) profileSkins.set(c, [...(profileSkins.get(c) ?? []), m.name])
  // And the armies they change wholesale.
  const profileArmies = new Map<string, string[]>()
  for (const m of profileMods) for (const f of m.factionLook ?? []) profileArmies.set(norm(f), [...(profileArmies.get(norm(f)) ?? []), m.name])

  // What the list's own mods do to a character's look as the campaign goes on.
  const stageMods = profileMods.flatMap((m) => (m.stageLooks ?? []).map((x) => ({ ...x, mod: m })))
  const stageOf = (m: Mod) => (m.kind === 'reskin' ? stageMods.find((x) => reskinSubjects(m, characters).includes(x.character)) : undefined)
  const story = (m?: Mod) => !!m && STORY_KINDS.includes(m.kind)
  const lastMajor = [...(catalog.gameUpdates ?? [])].map((u) => u.date.slice(0, 10)).sort().pop() ?? ''
  const heldBack = (m: Mod) => isHeldBack(m, lastMajor)
  const avoid = new Set((preset.avoid ?? []).map((x) => targetKey(x.target)))
  const out = { lewd: [] as Suggestion[], general: [] as Suggestion[], character: leadName }
  for (const c of options) {
    const m = c.mod
    if (!m || c.superseded || c.conflicts.length || c.alternativeTo.length || m.kind === 'translation' || m.kind === 'collection') continue
    // A reskin of a character whose mod replaces her model from the first turn would never show.
    const stage = stageOf(m)
    const exempt = !!stage?.exempt?.includes(m.id)
    if (stage?.fromStart && !exempt) continue
    if (['abandoned', 'superseded'].includes(m.status ?? '')) continue
    if (m.tags.includes('modder-resource')) continue // source files for modders (Blender models), nothing the game loads
    // A mod that changes game data and was not updated since the last big game update often stops the game; it is only
    // offered once a launch test after that update confirmed it (the catalog's Mod.confirmed).
    if (heldBack(m)) continue
    if (removed.has(c.key)) continue // the player took it out of the template on purpose
    if (avoid.has(c.key)) continue // runs against the setup's point (its community says so)
    // Nothing that would bring back what the player removed, or pull in a whole other campaign.
    if (c.addsDependencies.some((d) => removed.has(d))) continue
    // Nothing the game does not start with (the catalog's launch test), and nothing that pulls such a mod in.
    if (m.stopsGame || c.addsDependencies.some((d) => d.startsWith('mod:') && index.mods.get(d.slice(4))?.stopsGame)) continue
    const tie = c.reasons.find((r) => /^(Recommended by |Recommended for this setup|Optional for |Extends )/.test(r))?.split(':')[0].replace(/^Extends /, 'Adds to ')
    const forChar = m.playAs?.find((p) => isChar(p.character))?.character
    // A patch is for lists that have what it patches; one that would pull that in (SFO for an SFO patch) is not offered.
    if (m.kind === 'patch' && c.addsDependencies.length) continue
    // Nor an add-on that brings another character's campaign along (a Katarin option that needs Lazy's Katarin).
    const otherStory = (d: string) => {
      const dm = d.startsWith('mod:') ? index.mods.get(d.slice(4)) : undefined
      return story(dm) && !!dm!.playAs?.length && !dm!.playAs.some((p) => isChar(p.character))
    }
    if (c.addsDependencies.some(otherStory)) continue
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
    const nexus = m.sources.nexus?.downloads ?? 0
    let score = 0
    const reasons: string[] = []
    // What ties a mod to this list (a template mod recommends it, it is for the template's character or faction)
    // weighs more than being popular in lists for other characters.
    if (ks) { score += 10 * ks + k; reasons.push(`In ${ks} of ${same.length} community lists for ${leadName}`) }
    else if (k) { score += same.length ? k : k / 3; reasons.push(`In ${k} of ${lists.length} community lists`) }
    if (tie) { score += 15; reasons.unshift(tie) }
    if (forChar) { score += 10; reasons.push(`For ${forChar}`) }
    else if (fits.length) { score += 6; reasons.push(`For ${fits.slice(0, 2).join(', ')}`) }
    if (subs) { score += Math.log10(subs); reasons.push(`${short(subs)} Workshop subscribers`) }
    else if (downloads) { score += Math.log10(downloads) + 0.5; reasons.push(`${short(downloads)} LoversLab downloads`) }
    else if (nexus) { score += Math.log10(nexus) + 0.5; reasons.push(`${short(nexus)} Nexus downloads`) }
    // A reskin of a character the profile already reskins replaces that look (an add-on to it does not).
    const until: LookUntil | undefined = stage && !exempt ? {
      character: stage.character, ...(stage.stages ? { stages: stage.stages } : {}), key: `mod:${stage.mod.id}`, by: stage.mod.name,
      campaign: STORY_KINDS.includes(stage.mod.kind), ...(stage.image ? { image: stage.image } : {}), ...(stage.partly?.includes(m.id) ? { partly: true } : {})
    } : undefined
    // A look that only holds until the first stage does not replace the stage models.
    const replaces = m.kind === 'reskin' && !tie ? [...new Set([
      ...reskinSubjects(m, characters).flatMap((c) => profileSkins.get(c) ?? []).filter((n) => !until || n !== stage!.mod.name),
      ...(m.factionLook ?? []).flatMap((f) => profileArmies.get(norm(f)) ?? [])
    ])].filter((n) => n !== m.name) : []
    if (replaces.length) reasons.unshift(`Replaces ${replaces.join(', ')} in this list`)
    // An army's look is chosen with the other looks, whatever its tags say (Endo's Combined pack is tagged general).
    out[general && !m.factionLook?.length ? 'general' : 'lewd'].push({
      key: c.key, mod: m, reasons: reasons.slice(0, 2), score, strong: !!(ks || tie || forChar), tied: !!tie, fits: !!(forChar || fits.length), sameLists: ks, ...(replaces.length ? { replaces } : {}), ...(until ? { until } : {})
    })
  }
  for (const list of [out.lewd, out.general]) list.sort((a, b) => b.score - a.score || a.mod.name.localeCompare(b.mod.name))
  // A lord in the game's own campaign: a single look for the lord is a choice too (the look or the game's own).
  const leads = new Set(preset.origin === 'vanilla' ? [preset.playAs[0]] : [])
  return { lewd: pickOneGroups(catalog, out.lewd, characters, leads), general: pickOneGroups(catalog, out.general, characters, leads), character: leadName }
}

/** One idea for a list; options of one `pickOf` exclude each other. */
export interface Idea {
  s: Suggestion
  pickOf?: string
  note?: string
}

/**
 * Suggestions as ideas for a list the player already has: other looks, add-ons of its mods, what lists for the same
 * character use, what is for its characters. A mod only popular in other characters' lists is no idea.
 */
export function ideaGroups(entries: SuggestionEntry[], declined: Set<string> = new Set()): { id: string; title: string; hint: string; ideas: Idea[] }[] {
  const picks = entries.filter(isPickOne).filter((p) => !p.pick.some((s) => declined.has(s.key)))
  const singles = entries.filter((e): e is Suggestion => !isPickOne(e) && !declined.has(e.key) && (e.strong || e.fits))
  const asIdeas = (p: PickOne): Idea[] => p.pick.map((s) => ({ s, pickOf: p.pick[0].key, note: p.note }))
  const looks = (p: PickOne) => /\blooks$/.test(p.note)
  return [
    { id: 'looks', title: 'Other looks for characters in your list', hint: 'A look replaces the one your list has for that character; it loads above it.', ideas: picks.filter(looks).flatMap(asIdeas) },
    { id: 'addons', title: 'Add-ons for mods you have', hint: 'Recommended by, or made for, a mod in your list.', ideas: [...picks.filter((p) => !looks(p)).flatMap(asIdeas), ...singles.filter((s) => s.tied).map((s) => ({ s }))] },
    { id: 'often', title: 'Often played together with your mods', hint: 'In community lists for the same character that do not clash with yours. Mods a setup for it warns against are never offered.', ideas: singles.filter((s) => !s.tied && s.sameLists).map((s) => ({ s })) },
    { id: 'more', title: 'For your characters and factions', hint: 'Made for what your list is about.', ideas: singles.filter((s) => !s.tied && !s.sameLists).map((s) => ({ s })) }
  ].filter((g) => g.ideas.length)
}

/** The characters a reskin changes: its playAs and the character names among its tags. */
function reskinSubjects(m: Mod, characters: Map<string, string>): string[] {
  // A character tag alone may only say which campaign the reskin is for (a unit reskin for Alarielle's campaign);
  // it changes the character only when its name or summary names her too.
  const text = norm(`${m.name} ${m.summary}`)
  const tagged = m.tags.map(norm).filter((t) => characters.has(t) && text.includes(t.split(' ')[0])).map((t) => characters.get(t)!)
  return [...new Set([...(m.playAs ?? []).map((p) => p.character), ...tagged])]
}

/**
 * Joins suggestions that exclude each other into "pick one" groups: mods marked incompatible, versions of
 * the same add-on (a shared exclusiveGroup), and reskins of the same subject (they replace the same models).
 */
function pickOneGroups(catalog: Catalog, list: Suggestion[], characters: Map<string, string>, leads: Set<string> = new Set()): SuggestionEntry[] {
  const at = new Map(list.map((s, i) => [s.mod.id, i]))
  const parent = list.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const notes = new Map<number, string>()
  const join = (a: number, b: number, note: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    parent[rb] = ra
    notes.set(ra, notes.get(ra) ?? notes.get(rb) ?? note)
  }
  for (const [i, sug] of list.entries()) {
    for (const r of sug.mod.relations) {
      // As in conflictsIn: an incompatibility that holds only in a case ("playing as Miao Ying") does not group them.
      if (r.kind === 'incompatible' && !r.condition && 'mod' in r.target && at.has(r.target.mod)) join(i, at.get(r.target.mod)!, 'These do not work together')
    }
  }
  for (const m of catalog.mods) {
    const groups = new Map<string, number[]>()
    for (const r of m.relations) {
      if (r.exclusiveGroup && 'mod' in r.target && at.has(r.target.mod)) groups.set(r.exclusiveGroup, [...(groups.get(r.exclusiveGroup) ?? []), at.get(r.target.mod)!])
    }
    for (const members of groups.values()) for (const j of members.slice(1)) join(members[0], j, `Versions of the same add-on for ${m.name}`)
  }
  // Reskins replace models: two reskins of the same character collide. (Faction-wide reskins often touch
  // different units, so they are not grouped without a known incompatibility.)
  const subjects = new Map<string, number>()
  for (const [i, sug] of list.entries()) {
    if (sug.mod.kind !== 'reskin') continue
    for (const subject of reskinSubjects(sug.mod, characters)) {
      if (subjects.has(subject)) join(subjects.get(subject)!, i, `They all change how ${subject} looks`)
      else subjects.set(subject, i)
    }
  }
  // Reskins that replace a faction's units wholesale overwrite the same files (the catalog's factionLook): one army look.
  const armies = new Map<string, number>()
  for (const [i, sug] of list.entries()) {
    for (const f of sug.mod.factionLook ?? []) {
      const name = FACTIONS[norm(f)] ?? f
      if (armies.has(name)) join(armies.get(name)!, i, `They all change how the ${name} army looks`)
      else armies.set(name, i)
    }
  }
  const byRoot = new Map<number, Suggestion[]>()
  for (const [i, sug] of list.entries()) byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), sug])
  // Preselected: the first option, if players of this list really use it and it replaces nothing; otherwise none.
  // Where a mod in the list already changes the look by stage, keeping that is the first choice.
  const preselect = (members: Suggestion[]) => {
    const stage = members.find((x) => x.until)?.until
    return stage ? { stage } : members[0].strong && !members[0].replaces ? { preselect: members[0].key } : {}
  }
  const entries: SuggestionEntry[] = [...byRoot.entries()].map(([root, members]) => {
    if (members.length > 1) return { pick: members, note: notes.get(root) ?? 'Pick one', score: members[0].score, ...preselect(members) }
    // A single reskin that would replace one in the profile is a choice too ("None" keeps the profile's look).
    const [one] = members
    const army = one.mod.factionLook?.length && !reskinSubjects(one.mod, characters).length
      ? `the ${one.mod.factionLook.map((f) => FACTIONS[norm(f)] ?? f).join(', ')} army` : undefined
    const subjects = reskinSubjects(one.mod, characters)
    const lead = one.mod.kind === 'reskin' && subjects.some((c) => leads.has(c))
    if (one.replaces || one.until || lead) return { pick: members, note: `It changes how ${army ?? (lead ? subjects.filter((c) => leads.has(c)) : subjects).join(', ')} looks`, score: one.score, ...preselect(members) }
    return one
  })
  return entries.sort((a, b) => b.score - a.score)
}

/** Changes game data, last updated before the given big game update (YYYY-MM-DD) and not confirmed by a launch test since. */
export function isHeldBack(m: Mod, lastMajor: string): boolean {
  return !!lastMajor && m.changesData === true && !!m.updated && m.updated < lastMajor && !(m.confirmed && m.confirmed >= lastMajor)
}
