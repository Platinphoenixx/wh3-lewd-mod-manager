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

export type ContributionType = 'new-mod' | 'feedback' | 'rule' | 'correction'

export interface Contribution {
  id: string
  type: ContributionType
  /** Catalog mod id the contribution refers to (not for new-mod). */
  modId?: string
  title: string
  /** Structured content; becomes a JSON block in the issue so curators can apply it mechanically. */
  payload: Record<string, unknown>
  createdAt: string
  sentAs?: 'issue' | 'clipboard'
}

export const CONTRIBUTION_LABEL: Record<ContributionType, string> = {
  'new-mod': 'New mod',
  feedback: 'Feedback',
  rule: 'Rule',
  correction: 'Correction'
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
