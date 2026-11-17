import type { Catalog, RelationKind } from '@catalog/schema'
import { parseTargetKey } from './match'

/** A rule the user added themselves; applied locally right away and optionally sent to the curators. */
export interface UserRule {
  id: string
  /** Catalog mod id the rule is about. */
  modId: string
  kind: RelationKind | 'loadAbove' | 'loadBelow'
  /** targetKey of the other mod ("mod:ll-42028", "external:ext-sfo", "steamId:123"). */
  other: string
  note?: string
  createdAt: string
}

export type ContributionType = 'new-mod' | 'feedback' | 'rule' | 'correction' | 'fix'

export interface Contribution {
  id: string
  type: ContributionType
  /** Catalog mod id the contribution refers to (not for new-mod). */
  modId?: string
  title: string
  /** Structured content; becomes a JSON block in the issue so curators can apply it mechanically. */
  payload: Record<string, unknown>
  createdAt: string
  sentAs?: 'issue' | 'clipboard' | 'relay'
  /** The GitHub issue the relay filed for it (its status is looked up there). */
  url?: string
}

/** A setup this install shared (relay /setup): what the app needs to show it under "Your shared setups" and edit it. */
export interface SharedRecord {
  /** The relay's id; the catalog shows it as template `community-<id>`. */
  id: string
  name: string
  shownAs?: string
  far?: string
  notes?: string
  at: string
}

/** What became of a contribution the relay filed as a GitHub issue, from the issue itself (looked up at most daily). */
export interface ContributionStatus {
  state: 'waiting' | 'added' | 'not-added'
  /** A maintainer's reason when it was not added. */
  reason?: string
  checkedAt: string
}

/** What the player was last told about: per own setup the counts, per contribution or flagged rule its state. */
export interface NewsSeen {
  setups: Record<string, { up: number; down: number; uses: number }>
  contributions: Record<string, ContributionStatus['state']>
  flags: Record<string, string>
}

export interface News {
  text: string
  /** Where the card's button leads. */
  to: 'setups' | 'contributions'
}

/**
 * What changed for the player's own setups, contributions and flags since they were last told (one card each), and the
 * new state to remember. A setup that is not in the catalog yet says nothing; the first time it is, it says so.
 */
export function newsFor(
  catalog: Catalog, shared: SharedRecord[], contributions: Contribution[], statuses: Record<string, ContributionStatus>,
  flagged: Record<string, string>, seen: NewsSeen
): { news: News[]; seen: NewsSeen } {
  const news: News[] = []
  const next: NewsSeen = { setups: { ...seen.setups }, contributions: { ...seen.contributions }, flags: { ...seen.flags } }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  for (const s of shared) {
    const p = catalog.presets.find((x) => x.id === `community-${s.id}`)
    if (!p) continue
    const now = { up: p.votes?.up ?? 0, down: p.votes?.down ?? 0, uses: p.uses ?? 0 }
    const was = seen.setups[s.id]
    next.setups[s.id] = now
    if (!was) news.push({ text: `Your setup “${p.name}” is in Play now – other players can find it there.`, to: 'setups' })
    else if (now.up > was.up || now.uses > was.uses) {
      const parts = [
        now.up > was.up ? `${plural(now.up - was.up, 'more player', 'more players')} said your setup “${p.name}” worked` : `More players use your setup “${p.name}”`,
        now.uses ? `${plural(now.uses, 'player uses', 'players use')} it now` : ''
      ].filter(Boolean)
      news.push({ text: `${parts.join(' – ')}.`, to: 'setups' })
    }
  }
  for (const c of contributions) {
    const st = c.url ? statuses[c.url] : undefined
    if (!c.url || !st || st.state === 'waiting' || seen.contributions[c.url] === st.state) continue
    next.contributions[c.url] = st.state
    news.push({
      text: st.state === 'added' ? `Your contribution “${c.title}” is in the catalog now. Thank you!` : `Your contribution “${c.title}” was not added${st.reason ? `: ${st.reason}` : '.'}`,
      to: 'contributions'
    })
  }
  for (const rule of Object.keys(flagged)) {
    const f = catalog.ruleFlags?.[rule]
    if (!f?.decision || seen.flags[rule] === f.decision) continue
    next.flags[rule] = f.decision
    news.push({
      text: f.decision === 'retired' ? 'A rule you flagged as wrong is out of the catalog now. Thank you!'
        : f.decision === 'changed' ? `A rule you flagged has a new reason: ${f.answer ?? ''}`.trim()
        : `A rule you flagged was checked and stays${f.answer ? `: ${f.answer}` : '.'}`,
      to: 'contributions'
    })
  }
  return { news, seen: next }
}

export const CONTRIBUTION_LABEL: Record<ContributionType, string> = {
  'new-mod': 'New mod',
  feedback: 'Feedback',
  rule: 'Rule',
  correction: 'Correction',
  fix: 'Fix'
}

/** Catalog with the user's own rules merged in (copy; the original stays untouched). */
export function withUserRules(catalog: Catalog, rules: UserRule[]): Catalog {
  if (!rules.length) return catalog
  const mods = catalog.mods.map((m) => {
    const mine = rules.filter((r) => r.modId === m.id)
    if (!mine.length) return m
    const copy = { ...m, relations: [...m.relations], loadOrder: m.loadOrder ? { ...m.loadOrder } : undefined }
    for (const r of mine) {
      const target = parseTargetKey(r.other)
      if (r.kind === 'loadAbove' || r.kind === 'loadBelow') {
        const lo = (copy.loadOrder ??= {})
        const side = r.kind === 'loadAbove' ? 'above' : 'below'
        lo[side] = [...(lo[side] ?? []), target]
      } else {
        copy.relations.push({ kind: r.kind, target, note: r.note ? `Your rule: ${r.note}` : 'Your rule', source: { type: 'user' } })
      }
    }
    return copy
  })
  return { ...catalog, mods }
}

/** Markdown issue body: readable text plus a machine-readable block for the curator. */
export function issueBody(c: Contribution, catalogDate: string): string {
  const lines = [`**Type:** ${CONTRIBUTION_LABEL[c.type]}`]
  if (c.modId) lines.push(`**Mod:** ${c.modId}`)
  for (const [k, v] of Object.entries(c.payload)) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue
    lines.push(`**${k}:** ${Array.isArray(v) ? v.join(', ') : String(v)}`)
  }
  lines.push('', `_Sent from WH3 Lewd Mod Manager, catalog ${catalogDate}_`, '', '```json', JSON.stringify({ type: c.type, modId: c.modId, ...c.payload }, null, 2), '```')
  return lines.join('\n')
}

/** github.com "new issue" link with title, body and label filled in. Repo is "owner/name". */
export function issueUrl(repo: string, c: Contribution, catalogDate: string): string {
  const params = new URLSearchParams({ title: c.title, body: issueBody(c, catalogDate), labels: c.type })
  return `https://github.com/${repo}/issues/new?${params}`
}
