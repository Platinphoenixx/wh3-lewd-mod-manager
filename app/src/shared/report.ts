/**
 * Problem reports for modders: what was started (game version, template, load order and how it
 * differs from the template) plus the script error, as Markdown. The app writes a snapshot of the
 * load order whenever it starts the game, so the report describes exactly what ran.
 */

export interface LaunchEntry {
  key: string
  name: string
  /** base = from the template, extra = switched on, own = a mod the catalog does not know. */
  origin: 'base' | 'extra' | 'own'
  /** Where it comes from, for the modder ("Workshop 123", "LoversLab 52245", "data folder"). */
  source?: string
  /** Last update of the mod (ms), when known. */
  updated?: number
  changesData?: boolean
  /** Older than the last major game update and changes game data. */
  stale?: boolean
  /** Position in the template's list (base entries only). */
  templateIndex?: number
  /** Installed pack paths that were started for this entry. */
  paths: string[]
}

/** What the app started, saved at every launch (userData/last-launch.json). */
export interface LaunchSnapshot {
  at: number
  profile: { id: string; name: string }
  template: { id: string; name: string; author?: string }
  game: { version?: string; build?: string; lastMajor?: { date: number; title: string } }
  /** Load order, highest priority first. */
  entries: LaunchEntry[]
  /** Template mods the player switched off. */
  removed: string[]
}

/** Base entries whose order differs from the template: everything outside the longest run that kept it. */
export function movedEntries(entries: LaunchEntry[]): Set<string> {
  const base = entries.filter((e) => e.templateIndex !== undefined)
  // Longest increasing subsequence of template positions (patience sorting with back links).
  const tails: number[] = []
  const prev: number[] = []
  base.forEach((e, i) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (base[tails[mid]].templateIndex! < e.templateIndex!) lo = mid + 1
      else hi = mid
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1
    tails[lo] = i
  })
  const kept = new Set<number>()
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) kept.add(i)
  return new Set(base.filter((_, i) => !kept.has(i)).map((e) => e.key))
}

/** Replaces the Windows user name and local folders, so a report says nothing about the player. */
export function anonymize(text: string, ctx: { home?: string; gamePath?: string | null; workshopPaths?: string[] }): string {
  let out = text
  const swap = (from: string | null | undefined, to: string) => {
    if (!from) return
    for (const v of new Set([from, from.replace(/\\/g, '/')])) out = out.split(v).join(to)
  }
  for (const w of ctx.workshopPaths ?? []) swap(w, '<workshop>')
  swap(ctx.gamePath, '<game>')
  swap(ctx.home, '<user folder>')
  return out.replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\s]+/gi, '$1<user>')
}

export interface ReportOptions {
  versions: boolean
  differences: boolean
  stale: boolean
  overlaps: boolean
  fullOrder: boolean
}

export interface ReportInput {
  /** The mod the error belongs to (name as shown in the app). */
  modName: string
  /** Failure lines of the session with how often each appeared. */
  errors: { line: string; count: number }[]
  /** Pack files that contain the failing script. */
  packs: string[]
  snapshot: LaunchSnapshot | null
  /** Versions to show when there is no snapshot (the game was started elsewhere). */
  game?: LaunchSnapshot['game']
  appVersion: string
  catalogDate: string
  /** Where it happened, in the player's words. */
  where?: string
  /** File overlaps involving the failing packs: winner overrides loser. */
  overlaps: { winner: string; loser: string; count: number; sample?: string }[]
  options: ReportOptions
}

const day = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?')

/** The report as Markdown; `short` keeps it within one Discord message. */
export function buildReport(r: ReportInput, short = false): string {
  const s = r.snapshot
  const limit = short ? 8 : Infinity
  const cut = <T>(list: T[], n: number, fmt: (x: T) => string): string[] =>
    list.length > n ? [...list.slice(0, n).map(fmt), `… and ${list.length - n} more (full report as a file)`] : list.map(fmt)
  const out: string[] = [`## Problem report – ${r.modName}`]
  if (r.options.versions) {
    const g = s?.game ?? r.game
    out.push(`Game: Total War: WARHAMMER III ${g?.version ?? '(version unknown)'}${g?.build ? ` (Steam build ${g.build})` : ''}`)
    out.push(`App: WH3 Lewd Mod Manager ${r.appVersion} · catalog ${r.catalogDate}`)
  }
  if (s) out.push(`Template: ${s.template.name}${s.template.author ? ` (by ${s.template.author})` : ''} · ${s.entries.length} mod${s.entries.length === 1 ? '' : 's'} started ${day(s.at)}`)
  else out.push('Load order: unknown (the game was not started from the app).')
  if (r.where?.trim()) out.push(`Where: ${r.where.trim()}`)

  out.push('', '### Script error')
  out.push('```', ...cut(r.errors, short ? 3 : Infinity, (e) => (e.count > 1 ? `${e.line}   (${e.count}×)` : e.line)), '```')
  if (r.packs.length) out.push(`In: ${r.packs.join(', ')}`)

  if (s && r.options.differences) {
    const moved = movedEntries(s.entries)
    const lines = [
      ...s.entries.filter((e) => e.origin === 'extra').map((e) => `+ added    ${e.name}${e.source ? ` (${e.source})` : ''}`),
      ...s.removed.map((n) => `- removed  ${n}`),
      ...s.entries.filter((e) => moved.has(e.key)).map((e) => `~ moved    ${e.name}`),
      ...s.entries.filter((e) => e.origin === 'own').map((e) => `+ own mod  ${e.name}${e.source ? ` (${e.source})` : ''} – not in the catalog`)
    ]
    out.push('', '### Differences from the template')
    out.push(...(lines.length ? ['```', ...cut(lines, limit, (l) => l), '```'] : ['None – the template as it is.']))
  }
  if (s && r.options.stale) {
    const stale = s.entries.filter((e) => e.stale)
    if (stale.length) {
      const m = s.game.lastMajor
      out.push('', `### Older than the last major game update${m ? ` (${m.title}, ${day(m.date)})` : ''}`)
      out.push(...cut(stale, limit, (e) => `- ${e.name} – updated ${day(e.updated)}, changes game data`))
    }
  }
  if (r.options.overlaps && r.overlaps.length) {
    out.push('', '### Same files changed by other packs')
    out.push(...cut(r.overlaps, short ? 3 : Infinity, (o) => `- ${o.winner} overrides ${o.loser} in ${o.count} file${o.count === 1 ? '' : 's'}${o.sample ? ` (e.g. ${o.sample})` : ''}`))
  }
  if (s && r.options.fullOrder && !short) {
    out.push('', '### Full load order (top = highest priority)')
    out.push(...s.entries.map((e, i) => `${i + 1}. ${e.name}${e.source ? ` (${e.source})` : ''}`))
  }
  return out.join('\n')
}

/**
 * Failures of one session per mod: lines from the same packs belong together (one report, one entry);
 * failures without a known pack stay one per line. `index` points at the first failure of the group.
 */
export function groupFailures(failed: { line: string; script?: string; packs: string[] }[]): { index: number; packs: string[]; lines: { line: string; count: number }[] }[] {
  const groups = new Map<string, { index: number; packs: string[]; all: string[] }>()
  failed.forEach((f, i) => {
    const key = f.packs.length ? 'p:' + [...f.packs].sort().join('|') : 'l:' + f.line
    const g = groups.get(key)
    if (g) g.all.push(f.line)
    else groups.set(key, { index: i, packs: f.packs, all: [f.line] })
  })
  return [...groups.values()].map((g) => ({ index: g.index, packs: g.packs, lines: countErrors(g.all) }))
}

/**
 * The same error on two PCs gives the same signature: folders, numbers in file names and spacing do
 * not count, the script and the message do.
 */
export function errorSignature(modKey: string, line: string): string {
  const msg = line
    .replace(/[A-Za-z]:[\\/][^\s"'\]]*/g, '<path>')
    .replace(/<[^>]+>/g, '<path>')
    .replace(/0x[0-9a-f]+/gi, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return `${modKey.toLowerCase()} | ${msg}`.slice(0, 500)
}

/** Identical failure lines of one session, counted. */
export function countErrors(lines: string[]): { line: string; count: number }[] {
  const m = new Map<string, number>()
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1)
  return [...m].map(([line, count]) => ({ line, count }))
}
