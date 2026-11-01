import type { InstalledPack } from './api'
import { IGNORED, tableOf } from './conflicts'

/**
 * The player's own mods: installed packs the catalog does not know. They are keyed by their
 * Workshop item ("steamId:123") or, for packs in the data folder, by file name ("pack:x.pack"),
 * and placed into a profile's load order from what their packs contain.
 */

export function ownKeyOf(p: InstalledPack): string {
  return p.steamId ? `steamId:${p.steamId}` : `pack:${p.file}`
}

export function isOwnKey(key: string): boolean {
  return key.startsWith('steamId:') || key.startsWith('pack:')
}

/** What the pack index says about one installed pack. */
export interface PackFacts {
  /** Packs it names as needed (pack header + RPFM's note), lower-case. */
  dependencies: string[]
  /** Number of files, RPFM bookkeeping excluded. */
  files: number
  /** Database tables it writes to. */
  tables: string[]
}

export interface FactsReport {
  /** By pack path; null when the pack could not be read. */
  packs: Record<string, PackFacts | null>
  /** Packs (by path) that contain the same file paths, and how many. */
  overlaps: { a: string; b: string; count: number }[]
}

/** Builds the report from pack indexes (the main process reads them). */
export function collectFacts(packs: { path: string; files: { path: string }[]; dependencies: string[] }[]): FactsReport {
  const report: FactsReport = { packs: {}, overlaps: [] }
  const owners = new Map<string, number[]>()
  packs.forEach((p, i) => {
    const tables = new Set<string>()
    let files = 0
    for (const f of p.files) {
      if (IGNORED.test(f.path)) continue
      files++
      const t = tableOf(f.path)
      if (t) tables.add(t)
      const list = owners.get(f.path)
      if (list) list.push(i)
      else owners.set(f.path, [i])
    }
    report.packs[p.path] = { dependencies: p.dependencies.map((d) => d.toLowerCase()), files, tables: [...tables].sort() }
  })
  const counts = new Map<string, number>()
  for (const list of owners.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const k = `${list[x]}|${list[y]}`
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    }
  }
  for (const [k, count] of counts) {
    const [a, b] = k.split('|').map(Number)
    report.overlaps.push({ a: packs[a].path, b: packs[b].path, count })
  }
  return report
}

/** A profile entry in load order (highest priority first) with the paths of its installed packs. */
export interface OrderedEntry {
  key: string
  name: string
  paths: string[]
  /** Set on the player's own mods once they are placed. */
  own?: { reason: string; pinned: boolean }
}

export interface OwnMod {
  key: string
  name: string
  paths: string[]
}

export interface OwnCheck {
  /** Packs it names as needed that are not installed at all. */
  missing: string[]
  /** Needed packs that are installed but not in this profile, with the key to switch them on. */
  notInProfile: { pack: string; key: string }[]
  /** Profile mods sharing files with it; `wins` = its copies are the ones the game uses. */
  overlaps: { key: string; name: string; count: number; wins: boolean }[]
  /** Profile mods writing to the same (less common) database tables: a hint, not a proven conflict. */
  sharedTables: { key: string; name: string; tables: string[] }[]
}

const fileName = (p: string) => p.replace(/^.*[\\/]/, '').toLowerCase()

/**
 * Inserts the player's own mods into a load order.
 *
 * `pins` holds positions the player chose: own key → key of the entry it sits directly above
 * (null = bottom). Without a pin a mod is placed from its packs: above what it names as needed,
 * below what needs it, above mods whose files it changes when it is the smaller pack (a patch or
 * reskin), below them when it is the bigger one; otherwise at the bottom, where position does not
 * matter because it shares no files.
 */
export function placeOwnMods(
  entries: OrderedEntry[],
  own: OwnMod[],
  facts: FactsReport,
  pins: Record<string, string | null> = {}
): OrderedEntry[] {
  const overlap = new Map<string, number>()
  for (const o of facts.overlaps) {
    overlap.set(`${o.a}|${o.b}`, o.count)
    overlap.set(`${o.b}|${o.a}`, o.count)
  }
  const between = (a: string[], b: string[]) => a.reduce((n, x) => n + b.reduce((m, y) => m + (overlap.get(`${x}|${y}`) ?? 0), 0), 0)
  const filesOf = (paths: string[]) => paths.reduce((n, p) => n + (facts.packs[p]?.files ?? 0), 0)
  const depsOf = (paths: string[]) => paths.flatMap((p) => facts.packs[p]?.dependencies ?? [])
  const namesOf = (paths: string[]) => paths.map(fileName)

  const list = [...entries]
  const heuristic = (o: OwnMod) => {
    let lo = 0
    let hi = list.length
    let above: number | undefined
    let below: number | undefined
    const why: string[] = []
    const oDeps = depsOf(o.paths)
    const oNames = namesOf(o.paths)
    const oFiles = filesOf(o.paths)
    list.forEach((e, j) => {
      if (namesOf(e.paths).some((n) => oDeps.includes(n))) {
        hi = Math.min(hi, j)
        why.push(`above ${e.name}, which it needs`)
      }
      if (depsOf(e.paths).some((d) => oNames.includes(d))) {
        lo = Math.max(lo, j + 1)
        why.push(`below ${e.name}, which needs it`)
      }
      const c = between(o.paths, e.paths)
      if (!c) return
      if (oFiles <= filesOf(e.paths)) {
        above = Math.min(above ?? j, j)
        why.push(`above ${e.name}: changes ${c} of its files, so it is probably a patch or reskin for it`)
      } else {
        below = Math.max(below ?? j, j)
        why.push(`below ${e.name}: that smaller mod changes ${c} of its files`)
      }
    })
    const wanted = above ?? (below !== undefined ? below + 1 : list.length)
    const pos = Math.max(lo, Math.min(hi, wanted))
    const reason = why.length
      ? why.map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join('; ') + '.'
      : 'Shares no files with the other mods of this profile, so its position does not matter.'
    list.splice(pos, 0, { ...o, own: { reason: lo > hi ? `${reason} These rules contradict each other; check the order.` : reason, pinned: false } })
  }

  const pinned = own.filter((o) => o.key in pins)
  for (const o of own.filter((x) => !(x.key in pins))) heuristic(o)
  // Pins can point at other pinned mods; place those whose target is already in the list first.
  let rest = pinned
  for (let round = 0; rest.length && round <= pinned.length; round++) {
    const next: OwnMod[] = []
    for (const o of rest) {
      const target = pins[o.key]
      const at = target === null ? list.length : list.findIndex((e) => e.key === target)
      if (at < 0) next.push(o)
      else list.splice(at, 0, { ...o, own: { reason: 'Placed here by you.', pinned: true } })
    }
    rest = next
  }
  for (const o of rest) heuristic(o) // the entry it was pinned to is gone
  return list
}

/**
 * What a player should know about one own mod in a load order: missing requirements, which profile
 * mods it overrides or is overridden by, and shared database tables. `installedKeys` maps every
 * installed pack (lower-case file name) to its key (catalog mod or own key).
 */
export function checkOwnMod(
  order: OrderedEntry[],
  key: string,
  facts: FactsReport,
  installedKeys: Map<string, string>
): OwnCheck {
  const check: OwnCheck = { missing: [], notInProfile: [], overlaps: [], sharedTables: [] }
  const at = order.findIndex((e) => e.key === key)
  const self = order[at]
  if (!self) return check
  const inProfile = new Set(order.flatMap((e) => e.paths.map(fileName)))
  for (const dep of new Set(self.paths.flatMap((p) => facts.packs[p]?.dependencies ?? []))) {
    if (inProfile.has(dep)) continue
    const k = installedKeys.get(dep)
    if (k) check.notInProfile.push({ pack: dep, key: k })
    else check.missing.push(dep)
  }
  const overlap = new Map<string, number>()
  for (const o of facts.overlaps) {
    overlap.set(`${o.a}|${o.b}`, o.count)
    overlap.set(`${o.b}|${o.a}`, o.count)
  }
  // Tables that a quarter of the profile writes to say nothing about this pair.
  const usage = new Map<string, number>()
  for (const e of order) for (const t of new Set(e.paths.flatMap((p) => facts.packs[p]?.tables ?? []))) usage.set(t, (usage.get(t) ?? 0) + 1)
  const common = (t: string) => order.length >= 5 && (usage.get(t) ?? 0) > Math.max(3, order.length * 0.25)
  const myTables = new Set(self.paths.flatMap((p) => facts.packs[p]?.tables ?? []))
  order.forEach((e, j) => {
    if (j === at) return
    const count = self.paths.reduce((n, x) => n + e.paths.reduce((m, y) => m + (overlap.get(`${x}|${y}`) ?? 0), 0), 0)
    if (count) check.overlaps.push({ key: e.key, name: e.name, count, wins: at < j })
    const tables = [...new Set(e.paths.flatMap((p) => facts.packs[p]?.tables ?? []))].filter((t) => myTables.has(t) && !common(t))
    if (tables.length) check.sharedTables.push({ key: e.key, name: e.name, tables: tables.sort() })
  })
  check.overlaps.sort((a, b) => b.count - a.count)
  return check
}
