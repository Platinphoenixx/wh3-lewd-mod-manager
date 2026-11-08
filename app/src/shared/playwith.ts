import type { Catalog, Mod } from '@catalog/schema'
import type { CatalogIndex } from './match'
import { missingDependencies, resolveProfile } from './profile'
import { suggestedFor, tiersFor, type Subject, type Tier, type TierId } from './setups'

/**
 * "Play with a mod…": the setups a mod is in or fits, so a player can start from the mod they want instead of a
 * character. Worked out once per catalog for every subject (what each size loads, what it would offer), then looked
 * up per mod.
 */
export interface SubjectFacts {
  subject: Subject
  tiers: Tier[]
  /** Mods each size loads (dependencies included): key → the smallest size that has it. */
  has: Map<string, TierId>
  /** What the subject's main list offers: key → the choice it is part of ("They all change how Sigvald looks"), or "add". */
  offers: Map<string, string>
}

export function subjectFacts(catalog: Catalog, index: CatalogIndex, subjects: Subject[]): SubjectFacts[] {
  return subjects.map((subject) => {
    const tiers = tiersFor(catalog, index, subject)
    const has = new Map<string, TierId>()
    for (const t of tiers) {
      for (const e of resolveProfile(catalog, index, t.preset, { extras: t.extras, removed: [] }).entries) if (!has.has(e.key)) has.set(e.key, t.id)
    }
    const offers = new Map<string, string>()
    const base = mainTier(tiers)
    if (base) {
      const s = suggestedFor(catalog, index, base.preset, { extras: [], removed: [] })
      for (const g of s.picks) for (const x of g.pick) offers.set(x.key, g.note)
      for (const x of [...s.lewd, ...s.general]) offers.set(x.key, 'add')
    }
    return { subject, tiers, has, offers }
  })
}

/** The list a mod is added to when no size has it: the full campaign, else the first size. */
export const mainTier = (tiers: Tier[]) => tiers.find((t) => t.id === 'full') ?? tiers.find((t) => t.recommended) ?? tiers[0]

export interface PlayWithOption {
  subject: Subject
  /** in = a size of the subject has it already; fits = its list offers it; add = it can go in, nobody suggests it. */
  how: 'in' | 'fits' | 'add'
  /** For "in": the smallest size that has it. */
  from?: TierId
  /** What it is in that setup ("Sigvald's look"). */
  role?: string
  /** It is about this subject's character (her campaign, her look): the setup to take. */
  own: boolean
  /** Mods of the setup it does not work with; such a setup cannot take it. */
  conflicts: string[]
}

export interface PlayWith {
  mod: Mod
  /** Why it is not offered: the game does not start with it, or it is outdated. */
  blocked?: 'stops-game' | 'outdated'
  /** The mod that replaces an outdated one. */
  successor?: Mod
  /** For "stops-game": the mod it needs that stops the game (itself when that is the mod). */
  blockedBy?: Mod
  /** The characters the mod is about (its campaign, its look). */
  characters: string[]
  options: PlayWithOption[]
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
const sameCharacter = (a: string, b: string) => {
  const [x, y] = [letters(a.replace(/\s*\(.*\)$/, '')), letters(b.replace(/\s*\(.*\)$/, ''))]
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))
}
const LOOKS = /^(?:They all change|It changes) how (.+) looks$/

export function playWith(catalog: Catalog, index: CatalogIndex, facts: SubjectFacts[], mod: Mod): PlayWith {
  const key = `mod:${mod.id}`
  const successor = catalog.mods.find((m) => m.relations.some((r) => r.kind === 'supersedes' && 'mod' in r.target && r.target.mod === mod.id) && !['superseded', 'abandoned'].includes(m.status ?? ''))
  const characters = [...new Set([
    ...(mod.playAs ?? []).flatMap((p) => p.character.split(/\s*[/,]\s*/)),
    ...facts.flatMap((f) => (LOOKS.exec(f.offers.get(key) ?? '')?.[1] ? [LOOKS.exec(f.offers.get(key)!)![1]] : []))
  ])].filter(Boolean)
  const about = (s: Subject) => s.characters.some((c) => characters.some((x) => sameCharacter(c, x)))
  // It does not start when it or something it needs stops the game.
  const blockedBy = mod.stopsGame ? mod : [...missingDependencies(index, [key], new Set()).keys()]
    .map((k) => (k.startsWith('mod:') ? index.mods.get(k.slice(4)) : undefined)).find((m) => m?.stopsGame)
  const blocked = blockedBy ? 'stops-game' as const : ['superseded', 'abandoned'].includes(mod.status ?? '') ? 'outdated' as const : undefined

  const options: PlayWithOption[] = []
  for (const f of facts) {
    const own = about(f.subject)
    if (blocked) {
      // Without it: the setups of its characters.
      if (own) options.push({ subject: f.subject, how: 'add', own, conflicts: [] })
      continue
    }
    const from = f.has.get(key)
    const offer = f.offers.get(key)
    const look = LOOKS.exec(offer ?? '')?.[1]
    const role = look ? `${look}'s look` : undefined
    if (from) { options.push({ subject: f.subject, how: 'in', from, role, own, conflicts: [] }); continue }
    if (offer) { options.push({ subject: f.subject, how: 'fits', role, own, conflicts: [] }); continue }
    const base = mainTier(f.tiers)
    if (!base) continue
    const r = resolveProfile(catalog, index, base.preset, { extras: [...base.extras, key], removed: [] })
    const mine = new Set([key, ...r.entries.filter((e) => e.origin === 'dependency').map((e) => e.key)])
    const conflicts = r.conflicts.filter((c) => mine.has(c.a) !== mine.has(c.b)).map((c) => r.entries.find((e) => e.key === (mine.has(c.a) ? c.b : c.a))?.name ?? '')
    options.push({ subject: f.subject, how: 'add', own, conflicts: [...new Set(conflicts)].filter(Boolean) })
  }
  // Her own setup is the character's, not a theme that also has her.
  if (options.some((o) => o.own && o.subject.kind === 'character')) for (const o of options) if (o.subject.kind === 'theme') o.own = false
  const SIZE: TierId[] = ['essentials', 'full', 'extended', 'everything']
  const rank = (o: PlayWithOption) => [Number(!!o.conflicts.length), Number(!o.own), ['in', 'fits', 'add'].indexOf(o.how), o.from ? SIZE.indexOf(o.from) : 9]
  options.sort((a, b) => rank(a).map((x, i) => x - rank(b)[i]).find((x) => x !== 0) ?? 0)
  return { mod, ...(blocked ? { blocked } : {}), ...(blockedBy ? { blockedBy } : {}), ...(successor ? { successor } : {}), characters, options }
}

/** One line for a search result: what the player gets with the mod. */
export function playWithLine(p: PlayWith): { text: string; tone: 'ok' | 'warn' | '' } {
  if (p.blocked === 'stops-game') {
    if (p.blockedBy && p.blockedBy !== p.mod) return { text: `Needs ${p.blockedBy.name}, which the game does not start with`, tone: 'warn' }
    return { text: p.mod.fixes?.length ? 'Does not start as published – players shared a fix' : 'The game does not start with it since the last big update', tone: 'warn' }
  }
  if (p.blocked === 'outdated') return { text: p.successor ? `Outdated – replaced by ${p.successor.name}` : 'Outdated', tone: 'warn' }
  const usable = p.options.filter((o) => !o.conflicts.length)
  const n = (how: PlayWithOption['how']) => new Set(usable.filter((o) => o.how === how).map((o) => o.subject.key)).size
  const what = (k: number) => `${k} setup${k === 1 ? '' : 's'}`
  if (n('in')) return { text: `In ${what(n('in'))}${n('fits') ? `, fits ${n('fits')} more` : ''}`, tone: 'ok' }
  if (n('fits')) return { text: `Fits ${what(n('fits'))}${usable.find((o) => o.role)?.role ? ` as ${usable.find((o) => o.role)!.role}` : ''}`, tone: 'ok' }
  if (usable.length) return { text: 'Not in a setup yet – you pick the one it goes into', tone: '' }
  return { text: 'Does not work with any setup', tone: 'warn' }
}

/**
 * Catalog mods for a search: a Steam, LoversLab or Nexus link finds its mod; words match the name (all of them),
 * lewd mods before general ones, names that start with the words first, then the more used. Collections and translations are left out.
 */
export function searchMods(catalog: Catalog, query: string, limit = 8): Mod[] {
  const q = query.trim()
  if (!q) return []
  const mods = catalog.mods.filter((m) => m.kind !== 'collection' && m.kind !== 'translation')
  const steam = /steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/?\?(?:.*&)?id=(\d+)/i.exec(q)?.[1] ?? (/^\d{8,12}$/.test(q) ? q : undefined)
  const ll = /loverslab\.com\/files\/file\/(\d+)/i.exec(q)?.[1]
  const nexus = /nexusmods\.com\/[^/]+\/mods\/(\d+)/i.exec(q)?.[1]
  if (steam || ll || nexus) {
    return mods.filter((m) => (steam && (m.sources.steam?.some((s) => s.id === steam) || m.packs.some((p) => p.steamId === steam)))
      || (ll && m.sources.loverslab?.fileId === ll) || (nexus && m.sources.nexus?.modId === nexus)).slice(0, limit)
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const used = (m: Mod) => Math.max(0, ...(m.sources.steam ?? []).map((s) => s.subscribers ?? 0)) + (m.sources.loverslab?.downloads ?? 0) + (m.sources.nexus?.downloads ?? 0)
  const outdated = (m: Mod) => Number(['superseded', 'abandoned'].includes(m.status ?? ''))
  const general = (m: Mod) => Number(m.tags.includes('general')) // the lewd mods this app is about come first
  return mods
    .filter((m) => words.every((w) => m.name.toLowerCase().includes(w)))
    .sort((a, b) => outdated(a) - outdated(b) || general(a) - general(b) || Number(!b.name.toLowerCase().startsWith(words[0])) - Number(!a.name.toLowerCase().startsWith(words[0])) || used(b) - used(a))
    .slice(0, limit)
}
