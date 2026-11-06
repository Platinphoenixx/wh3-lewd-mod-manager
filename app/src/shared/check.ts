import type { Catalog, Mod, Preset, Relation, RuleFlag } from '@catalog/schema'
import { parseTargetKey, targetKey, type CatalogIndex } from './match'
import { nameOf, type PacksOf, type Profile, type ResolvedProfile } from './profile'
import { isHeldBack } from './suggest'
import { updateName } from './health'

/**
 * What the catalog would warn about in a player's list, each point with its reason and where the reason comes from.
 * For an imported list these are hints, not a verdict: the list runs for the player. Every point has a stable rule id, so
 * a player can flag the rule as wrong (relay /flag) and a maintainer's decision comes back through the catalog
 * (Catalog.ruleFlags).
 */
export type CheckKind = 'conflict' | 'stops' | 'outdated' | 'requires' | 'order' | 'avoid' | 'old'

export const CHECK_LABEL: Record<CheckKind, string> = {
  conflict: 'Conflict',
  stops: 'Does not start for others',
  outdated: 'Outdated',
  requires: 'Missing requirement',
  order: 'Load order',
  avoid: 'Against this setup',
  old: 'Older than the last big update'
}

const KIND_ORDER: CheckKind[] = ['conflict', 'stops', 'outdated', 'requires', 'order', 'avoid', 'old']

export interface CheckAction {
  type: 'remove' | 'add' | 'move' | 'fix'
  label: string
  key: string
  /** For 'move': the entry it goes directly above. */
  above?: string
  primary?: boolean
}

export interface CheckPoint {
  rule: string
  kind: CheckKind
  title: string
  /** What the app thinks and why. */
  why: string
  source: string
  sourceUrl?: string
  /** The profile entries it is about. */
  keys: string[]
  actions: CheckAction[]
  /** Only a hint (older than the last update; a pair the template itself plays together). */
  info?: boolean
  /** What players or a maintainer said about the rule. */
  status?: string
}

const SOURCE: Record<Relation['source']['type'], string> = {
  loverslab: 'LoversLab page',
  discord: 'Discord post',
  wiki: 'Wiki',
  steam: 'Workshop page',
  nexus: 'Nexus Mods page',
  inferred: 'Worked out by the catalog from the packs and pages',
  community: 'Accepted from a player',
  user: 'Your own rule'
}

/** A curated note as a sentence (notes are often written as a clause to follow a mod's name). */
const sentence = (s: string) => `${s[0].toUpperCase()}${s.slice(1).replace(/\.?\s*$/, '.')}`

const pairOf = (a: string, b: string) => [a, b].sort().join('|')
export const conflictRule = (a: string, b: string) => `conflict|${pairOf(a, b)}`
export const oldRule = (key: string, lastMajor: string) => `old|${key}|${lastMajor}`

const modOf = (index: CatalogIndex, key: string): Mod | undefined => {
  const t = parseTargetKey(key)
  return 'mod' in t ? index.mods.get(t.mod) : undefined
}

const relationBetween = (index: CatalogIndex, kind: Relation['kind'], a: string, b: string) =>
  modOf(index, a)?.relations.find((r) => r.kind === kind && targetKey(r.target) === b) ??
  modOf(index, b)?.relations.find((r) => r.kind === kind && targetKey(r.target) === a)

const sourceOf = (r?: Relation) => ({ source: r ? SOURCE[r.source.type] : 'Catalog rule', ...(r?.source.url ? { sourceUrl: r.source.url } : {}) })

/** What players and maintainers said about a rule; null when it is retired. */
export function withFlag(point: CheckPoint, flags?: Record<string, RuleFlag>): CheckPoint | null {
  const f = flags?.[point.rule]
  if (!f) return point
  if (f.decision === 'retired') return null
  if (f.decision === 'changed') return { ...point, ...(f.answer ? { why: f.answer } : {}) }
  if (f.decision === 'kept') return { ...point, status: `Flagged before and checked${f.date ? ` ${f.date}` : ''}: the rule stays.${f.answer ? ` ${f.answer}` : ''}` }
  return f.flags ? { ...point, status: `${f.flags} players flagged this as wrong · a maintainer has not looked at it yet` } : point
}

export function conflictPoint(catalog: Catalog, index: CatalogIndex, c: { a: string; b: string; note?: string }, together = false): CheckPoint {
  const name = (k: string) => nameOf(catalog, index, k)
  // A mod that replaces the other: take out the old one.
  const newer = [c.a, c.b].find((k) => modOf(index, k)?.relations.some((r) => r.kind === 'supersedes' && targetKey(r.target) === (k === c.a ? c.b : c.a)))
  const remove = (k: string, primary = false): CheckAction => ({ type: 'remove', key: k, label: `Remove ${name(k)}`, ...(primary ? { primary } : {}) })
  return {
    rule: conflictRule(c.a, c.b),
    kind: 'conflict',
    title: `${name(c.a)} and ${name(c.b)} are both in the list`,
    why: (c.note ? sentence(c.note) : 'The catalog marks these two as not working together.') + (together ? ' The template plays them together.' : ''),
    ...sourceOf(relationBetween(index, 'incompatible', c.a, c.b)),
    keys: [c.a, c.b],
    actions: newer ? [remove(newer === c.a ? c.b : c.a, true)] : [remove(c.a), remove(c.b)],
    ...(together ? { info: true } : {})
  }
}

export function oldPoint(catalog: Catalog, index: CatalogIndex, key: string, updated: string | undefined, major: { date: string; title?: string }): CheckPoint {
  return {
    rule: oldRule(key, major.date),
    kind: 'old',
    title: `${nameOf(catalog, index, key)} (${updated ? `updated ${updated}, ` : ''}last big game update ${major.date})`,
    why: `It changes game data and was not updated since ${major.title ? `“${major.title}”` : 'that update'}. Such mods can stop the game after a patch; many still work.`,
    source: 'Update date · last major game update',
    keys: [key],
    actions: [],
    info: true
  }
}

/** Every point for a list in its load order (`order`: highest priority first). */
export function checkProfile(
  catalog: Catalog, index: CatalogIndex, preset: Preset, profile: Pick<Profile, 'fixes'>, resolved: ResolvedProfile, order: string[], packsOf?: PacksOf
): CheckPoint[] {
  const name = (k: string) => nameOf(catalog, index, k)
  const have = new Set(order)
  const points: CheckPoint[] = [
    ...resolved.conflicts.map((c) => conflictPoint(catalog, index, c)),
    ...resolved.notes.map((c) => conflictPoint(catalog, index, c, true))
  ]
  const clashing = new Set([...resolved.conflicts, ...resolved.notes].map((c) => pairOf(c.a, c.b)))
  const major = [...(catalog.gameUpdates ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0]
  const lastMajor = major?.date.slice(0, 10) ?? ''
  const pos = new Map(order.map((k, i) => [k, i]))
  const avoid = new Map((preset.avoid ?? []).map((x) => [targetKey(x.target), x.note]))
  const orderSeen = new Set<string>()

  for (const key of order) {
    const m = modOf(index, key)
    if (!m) continue
    if (m.stopsGame && !profile.fixes?.[m.id]) {
      points.push({
        rule: `stops|${key}`, kind: 'stops', title: m.name,
        why: `${sentence(m.stopsGame)} If yours runs, you may have a fix; sharing it helps everyone.`,
        source: 'The catalog’s launch test', keys: [key],
        actions: [{ type: 'fix', key, label: 'Share the fix you use…' }]
      })
    }
    if (['superseded', 'abandoned'].includes(m.status ?? '')) {
      points.push({
        rule: `outdated|${key}`, kind: 'outdated', title: m.name,
        why: m.status === 'abandoned' ? 'Its author stopped working on it.' : 'A newer mod replaces it.',
        source: 'Catalog status', keys: [key], actions: [{ type: 'remove', key, label: 'Remove it', primary: true }]
      })
    }
    for (const r of m.relations) {
      const other = targetKey(r.target)
      if (r.kind === 'supersedes' && have.has(other) && !clashing.has(pairOf(key, other))) {
        points.push({
          rule: `outdated|${other}|${key}`, kind: 'outdated', title: `${m.name} replaces ${name(other)}`,
          why: r.note ? sentence(r.note) : `${m.name} replaces it, and both are in the list.`, ...sourceOf(r), keys: [other, key],
          actions: [{ type: 'remove', key: other, label: `Remove ${name(other)}`, primary: true }]
        })
      }
      if (r.kind === 'requires' && !have.has(other)) {
        if (r.condition && !(r.whenPack && packsOf?.(key)?.some((p) => p.toLowerCase() === r.whenPack!.toLowerCase()))) continue
        // A mod in the list that replaces the required one does its job.
        if (order.some((k) => modOf(index, k)?.relations.some((x) => x.kind === 'supersedes' && targetKey(x.target) === other))) continue
        points.push({
          rule: `requires|${key}|${other}`, kind: 'requires', title: `${m.name} needs ${name(other)}`,
          why: r.note ? sentence(r.note) : `The catalog has ${name(other)} as a requirement of this mod, and it is not in the list.`, ...sourceOf(r), keys: [key],
          actions: [{ type: 'add', key: other, label: `Add ${name(other)}`, primary: true }]
        })
      }
    }
    const rules = [
      ...(m.loadOrder?.above ?? []).map((t) => [key, targetKey(t)]),
      ...(m.loadOrder?.below ?? []).map((t) => [targetKey(t), key])
    ]
    for (const [hi, lo] of rules) {
      const rule = `load|${hi}|${lo}`
      if (!have.has(hi) || !have.has(lo) || pos.get(hi)! < pos.get(lo)! || orderSeen.has(rule)) continue
      orderSeen.add(rule)
      points.push({
        rule, kind: 'order', title: `${name(hi)} loads below ${name(lo)}`,
        why: `${m.loadOrder?.note ? `${m.loadOrder.note} ` : ''}The catalog has ${name(hi)} above ${name(lo)}, so its files win where the two overlap. Your order is the other way round; if it works in game, keep it.`,
        source: 'Catalog load-order rule', keys: [hi, lo],
        actions: [{ type: 'move', key: hi, above: lo, label: `Move it above ${name(lo)}` }]
      })
    }
    if (avoid.has(key)) {
      points.push({
        rule: `avoid|${preset.id}|${key}`, kind: 'avoid', title: `${m.name} runs against “${preset.name}”`,
        why: sentence(avoid.get(key)!), source: 'The setup’s community channel', keys: [key],
        actions: [{ type: 'remove', key, label: 'Remove it' }]
      })
    }
    if (isHeldBack(m, lastMajor)) points.push(oldPoint(catalog, index, key, m.updated, { date: lastMajor, title: major?.title && updateName(major.title) }))
  }

  const seen = new Set<string>()
  return points
    .filter((p) => !seen.has(p.rule) && !!seen.add(p.rule))
    .flatMap((p) => withFlag(p, catalog.ruleFlags) ?? [])
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || Number(!!a.info) - Number(!!b.info))
}

/** The list's order with a mod placed directly above another (for an imported list). */
export function moveAbove(order: string[], key: string, above: string): string[] {
  const rest = order.filter((k) => k !== key)
  const at = rest.indexOf(above)
  return at < 0 ? order : [...rest.slice(0, at), key, ...rest.slice(at)]
}
