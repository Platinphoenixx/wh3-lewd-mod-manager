import type { Catalog, Mod, Preset } from '@catalog/schema'
import type { CatalogIndex } from './match'
import { baseKeys, candidates, resolveProfile, type Profile } from './profile'
import { isPickOne, suggestForProfile, type PickOne, type Suggestion } from './suggest'

/**
 * The guided way in ("Play"): templates grouped by who you play – a character – or by a theme for lists about a group
 * (Daemons of Slaanesh). Per subject a few sizes to choose from, then the choices of the chosen size as steps.
 */
export interface Subject {
  kind: 'character' | 'theme'
  key: string
  name: string
  /** The characters the subject's lists are for. */
  characters: string[]
  presets: Preset[]
  /** Mods whose pictures stand for the subject, best first. */
  coverMods: string[]
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
const STORY: Mod['kind'][] = ['progression', 'campaign', 'reskin', 'units', 'submod']

/** Canonical character names: the catalog's spellings, most common first ("Miao" → "Miao Ying", "N'kari" → "N'Kari"). */
function characterNames(catalog: Catalog): (raw: string) => string {
  const counts = new Map<string, Map<string, number>>()
  const all = [...catalog.mods.flatMap((m) => (m.playAs ?? []).map((p) => p.character)), ...catalog.presets.flatMap((p) => p.playAs)]
  for (const raw of all) for (const c of raw.split(/\s*[/,]\s*/).map((x) => x.replace(/\s*\(.*\)$/, '').trim())) {
    if (!c || /^(any|all)\b/i.test(c)) continue
    const m = counts.get(letters(c)) ?? new Map<string, number>()
    counts.set(letters(c), m.set(c, (m.get(c) ?? 0) + 1))
  }
  const total = (k: string) => [...(counts.get(k)?.values() ?? [])].reduce((a, b) => a + b, 0)
  const spelling = (k: string) => [...counts.get(k)!].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]
  return (raw) => {
    const k = letters(raw.replace(/\s*\(.*\)$/, ''))
    // Names where one starts with the other are the same character ("Miao" / "Miao Ying", "Valkia" / "Valkia the
    // Bloody"); the one the catalog uses most wins.
    const related = [...counts.keys()].filter((o) => o === k || (Math.min(o.length, k.length) >= 4 && (o.startsWith(k) || k.startsWith(o))))
    const key = related.sort((a, b) => total(b) - total(a))[0]
    return key ? spelling(key) : raw
  }
}

export function subjectsOf(catalog: Catalog, index: CatalogIndex): Subject[] {
  const canon = characterNames(catalog)
  const subjects = new Map<string, Subject>()
  for (const p of catalog.presets) {
    const chars = [...new Set(p.playAs.map(canon))]
    const kind = p.theme ? 'theme' : 'character'
    const name = p.theme ?? chars[0] ?? p.name
    const key = `${kind}:${letters(name)}`
    const s = subjects.get(key) ?? { kind, key, name, characters: [], presets: [], coverMods: [] }
    s.presets.push(p)
    s.characters = [...new Set([...s.characters, ...(kind === 'character' ? [name] : chars)])]
    subjects.set(key, s)
  }
  // A picture per subject: a mod about the character (progression and campaign first), else the lists' covers;
  // a picture another subject already shows is used only when nothing else is left.
  const used = new Set<string>()
  const cover = (m?: Mod) => m?.images?.find((i) => i.kind === 'cover')?.url ?? m?.images?.[0]?.url
  const list = [...subjects.values()].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
  // Characters pick their picture first: a theme can do with another of its characters' mods.
  for (const s of [...list].sort((a, b) => Number(a.kind === 'theme') - Number(b.kind === 'theme'))) {
    // For a theme: mods about its characters, those its lists use first.
    const inLists = new Set(s.presets.flatMap((p) => p.entries.flatMap((e) => (e.target && 'mod' in e.target ? [e.target.mod] : []))))
    // A mod about fewer other characters says more (Khalida's campaign lists five lords it can be played with).
    const charsOf = (m: Mod) => new Set([...(m.playAs ?? []).flatMap((p) => p.character.split(/\s*[/,]\s*/)).map(canon), ...m.tags.map(canon)]
      .filter((c) => c !== '' && c[0] === c[0].toUpperCase()))
    const outside = (m: Mod) => [...charsOf(m)].filter((c) => !s.characters.includes(c)).length
    const about = catalog.mods
      .filter((m) => !['superseded', 'abandoned'].includes(m.status ?? '') && !m.tags.includes('general') && cover(m) &&
        [...charsOf(m)].some((c) => s.characters.includes(c)))
      .sort((a, b) => {
        const listed = Number(inLists.has(b.id)) - Number(inLists.has(a.id))
        // The character is the mod's lead (first playable character) – not one of five lords it can also be played with.
        const lead = (m: Mod) => Number(!!m.playAs?.[0] && canon(m.playAs[0].character.split(/\s*[/,]\s*/)[0]) === s.name)
        // A character: the mods she leads, then her lists' story mods. A theme: the mods about its characters alone first.
        const leadStory = (m: Mod) => lead(m) * Number(rank(m) <= 2) // her own campaign, progression or reskin
        const order = s.kind === 'character'
          ? [leadStory(b) - leadStory(a), rank(a) - rank(b), listed, outside(a) - outside(b)]
          : [outside(a) - outside(b), listed, rank(a) - rank(b)]
        return order.find((x) => x !== 0) ?? (b.images?.length ?? 0) - (a.images?.length ?? 0)
      })
    const fromLists = s.presets.flatMap((p) => p.coverMods ?? []).map((id) => index.mods.get(id)).filter((m): m is Mod => !!m && !!cover(m))
    const ordered = [...new Set([...about, ...fromLists])]
    const fresh = ordered.filter((m) => !used.has(cover(m)!))
    s.coverMods = [...fresh, ...ordered.filter((m) => used.has(cover(m)!))].map((m) => m.id)
    if (fresh[0]) used.add(cover(fresh[0])!)
  }
  return list
}

const rank = (m: Mod) => { const i = STORY.indexOf(m.kind); return i < 0 ? STORY.length : i }
/** Subjects with tested lists first, then guides, then lists built from a mod page. */
const score = (s: Subject) => s.presets.reduce((n, p) => n + (p.origin === 'tested' ? 100 : p.origin === 'guide' ? 10 : 1), 0)

export type TierId = 'essentials' | 'full' | 'extended' | 'everything'

export interface Tier {
  id: TierId
  name: string
  preset: Preset
  /** Switched-on mods on top of the template. */
  extras: string[]
  /** Mods in the profile, dependencies included. */
  size: number
  lines: string[]
  /** What vouches for it, in a few words. */
  proof: string
  /** The list was played or launch-tested as it is. */
  tested: boolean
  recommended: boolean
}

const fresh: Pick<Profile, 'extras' | 'removed'> = { extras: [], removed: [] }
const SUGGESTED = 10 // per column, as the editor's "Add the suggested"

function firstSentence(text?: string): string | undefined {
  const t = text?.replace(/[*_]/g, '').split(/\n\n/)[0]
  return t?.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? t
}

function proofOf(p: Preset): string {
  const launch = p.launchTest?.result === 'main menu' ? `launch-tested with game ${p.launchTest.game}` : ''
  const origin = p.origin === 'tested' ? 'Played as it is by its author' : p.origin === 'guide' ? 'From a community guide' : 'Built from the mod page'
  return [origin, launch].filter(Boolean).join(' · ')
}

/** Singles (not pick-one) suggested for a template: lewd and general, best first. */
export function suggestedFor(catalog: Catalog, index: CatalogIndex, preset: Preset, profile = fresh) {
  const s = suggestForProfile(catalog, index, preset, profile, candidates(catalog, index, preset, profile))
  const singles = (l: typeof s.lewd) => l.filter((e): e is Suggestion => !isPickOne(e))
  return { lewd: singles(s.lewd), general: singles(s.general), picks: [...s.lewd, ...s.general].filter(isPickOne) }
}

export function tiersFor(catalog: Catalog, index: CatalogIndex, subject: Subject): Tier[] {
  const by = (o: Preset['origin']) => subject.presets.filter((p) => p.origin === o)
  const size = (p: Preset, extras: string[]) => resolveProfile(catalog, index, p, { extras, removed: [] }).entries.length
  const largest = (ps: Preset[]) => [...ps].sort((a, b) => b.entries.length - a.entries.length)[0]
  const smallest = (ps: Preset[]) => [...ps].sort((a, b) => a.entries.length - b.entries.length)[0]
  const full = largest(by('tested').filter((p) => p.phase !== 'late'))
  const essentials = smallest([...by('guide'), ...by('derived')].filter((p) => !full || p.entries.length < full.entries.length))
  const base = full ?? essentials ?? subject.presets[0]
  const tiers: Tier[] = []
  const lines = (p: Preset) => (p.highlights?.length ? p.highlights.slice(0, 3) : [firstSentence(p.description) ?? p.name])
  if (essentials) {
    tiers.push({ id: 'essentials', name: 'Essentials', preset: essentials, extras: [], size: size(essentials, []), lines: lines(essentials),
      proof: proofOf(essentials), tested: !!essentials.launchTest, recommended: !full })
  }
  if (full) {
    tiers.push({ id: 'full', name: 'Full campaign', preset: full, extras: [], size: size(full, []),
      lines: essentials ? [`More than ${essentials.entries.length < full.entries.length ? 'Essentials' : 'the guide'}: the list as its author plays it`, ...lines(full).slice(0, 2)] : lines(full),
      proof: proofOf(full), tested: true, recommended: true })
  }
  const s = suggestedFor(catalog, index, base)
  // Each suggestion fits the list; together some may not (two that exclude each other): the better one stays.
  const together = (xs: Suggestion[]) => xs.reduce<Suggestion[]>((kept, x) => {
    const keys = [...kept.map((k) => k.key), x.key]
    return resolveProfile(catalog, index, base, { extras: keys, removed: [] }).conflicts.length ? kept : [...kept, x]
  }, [])
  s.lewd = together(s.lewd)
  s.general = together(s.general)
  const more = together([...s.lewd.slice(0, SUGGESTED), ...s.general.slice(0, SUGGESTED)])
  const label = tiers[tiers.length - 1]?.name ?? base.name
  if (more.length) {
    const extras = more.map((x) => x.key)
    tiers.push({ id: 'extended', name: 'Extended', preset: base, extras, size: size(base, extras),
      lines: [`Everything in ${label}`, `${more.length} more mods that fit ${subject.name}, most used first`, s.lewd.slice(0, 3).map((x) => x.mod.name).join(', ')].filter(Boolean),
      proof: 'Each add-on checked against the list · not played together yet', tested: false, recommended: false })
  }
  if (s.lewd.length > SUGGESTED) {
    const extras = together([...s.lewd, ...s.general.slice(0, SUGGESTED)]).map((x) => x.key)
    tiers.push({ id: 'everything', name: 'Everything', preset: base, extras, size: size(base, extras),
      lines: [`Everything in ${label}`, `Every lewd mod that works with it (${s.lewd.length})`, 'You pick one look per character on the way'],
      proof: 'No known conflicts · nobody has played all of it together', tested: false, recommended: false })
  }
  return tiers
}

/** The late-game list of a subject's full campaign, if there is one (switched to mid-campaign). */
export function lateListOf(subject: Subject): Preset | undefined {
  return subject.presets.find((p) => p.origin === 'tested' && p.phase === 'late')
}

export interface Step {
  id: string
  title: string
  subtitle?: string
  question: string
  kind: 'pick' | 'others' | 'qol' | 'review'
  groups: PickOne[]
}

const LOOKS = /^They all change how (.+) looks$/

/**
 * The choices of a profile as steps, in a player's words: the main character's look first, then the add-ons and
 * heroes to choose between, the looks of characters the list already changes, the other characters' looks in one
 * step, then quality-of-life mods to keep or drop, then the review.
 */
export function stepsFor(subject: Subject, picks: PickOne[], hasQol: boolean): Step[] {
  const looks = (g: PickOne) => LOOKS.exec(g.note)?.[1]
  const own = picks.filter((g) => looks(g) && subject.characters.includes(looks(g)!))
  const replacing = picks.filter((g) => looks(g) && !own.includes(g) && g.pick.some((x) => x.replaces))
  const others = picks.filter((g) => looks(g) && !own.includes(g) && !replacing.includes(g))
  const rest = picks.filter((g) => !looks(g))
  const steps: Step[] = []
  for (const g of own) steps.push({ id: g.pick[0].key, title: `${looks(g)}'s look`, subtitle: 'Optional', question: `How should ${looks(g)} look?`, kind: 'pick', groups: [g] })
  for (const g of rest) {
    const addOn = /^Versions of the same add-on for (.+)$/.exec(g.note)?.[1]
    const short = (n: string) => n.replace(/\s*\(.*$/, '').slice(0, 40)
    const title = g.pick.slice(0, 2).map((x) => short(x.mod.name)).join(' or ') + (g.pick.length > 2 ? ' …' : '')
    steps.push(addOn
      ? { id: g.pick[0].key, title, subtitle: `Versions of an add-on for ${addOn}`, question: 'Which version do you want, if any?', kind: 'pick', groups: [g] }
      : { id: g.pick[0].key, title, subtitle: 'They do not work together', question: 'These do not work together – which one do you want, if any?', kind: 'pick', groups: [g] })
  }
  for (const g of replacing) {
    steps.push({ id: g.pick[0].key, title: `${looks(g)}'s look`, subtitle: 'Already in your list', question: `${looks(g)} is in your campaign – keep the list's look or change it?`, kind: 'pick', groups: [g] })
  }
  if (others.length) {
    steps.push({ id: 'others', title: 'Other characters', subtitle: `${others.length} more`, question: 'Looks for characters you may meet', kind: 'others', groups: others })
  }
  if (hasQol) steps.push({ id: 'qol', title: 'Quality of life', subtitle: 'Camera, UI, sound …', question: 'Which of these do you want?', kind: 'qol', groups: [] })
  steps.push({ id: 'review', title: 'Review and install', question: 'What you get', kind: 'review', groups: [] })
  return steps
}

/** The profile a guided setup makes: the tier's template and extras, the chosen options, the dropped extras and template mods. */
export function guidedProfile(tier: Tier, chosen: Record<string, string>, picks: PickOne[], dropped: Set<string>, name: string): Profile {
  const now = new Date().toISOString()
  const picked = picks.map((g) => chosen[g.pick[0].key] ?? g.preselect ?? 'none').filter((k) => k !== 'none')
  const declined = picks.flatMap((g) => g.pick.map((x) => x.key)).filter((k) => !picked.includes(k))
  const base = new Set(baseKeys(tier.preset))
  return {
    id: crypto.randomUUID(), name, presetId: tier.preset.id,
    extras: [...new Set([...tier.extras, ...picked])].filter((k) => !dropped.has(k)),
    removed: [...dropped].filter((k) => base.has(k)),
    declined, createdAt: now, updatedAt: now
  }
}
