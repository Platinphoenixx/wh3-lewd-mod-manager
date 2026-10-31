import { describe, expect, it } from 'vitest'
import type { Catalog } from '@catalog/schema'
import { issueBody, issueUrl, withUserRules, type Contribution } from './community'

const catalog = {
  schemaVersion: 1, generatedAt: '2026-10-31', sources: [], tiers: [], notes: [], presets: [], campaignGuides: [], external: [],
  mods: [
    { id: 'a', name: 'A', authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [], relations: [], curation: { lastChecked: '', confidence: 'high' } },
    { id: 'b', name: 'B', authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [], relations: [], curation: { lastChecked: '', confidence: 'high' } }
  ]
} as Catalog

describe('withUserRules', () => {
  it('adds relations and load-order rules to a copy of the catalog', () => {
    const out = withUserRules(catalog, [
      { id: '1', modId: 'a', kind: 'incompatible', other: 'mod:b', note: 'crash', createdAt: '' },
      { id: '2', modId: 'a', kind: 'loadAbove', other: 'mod:b', createdAt: '' }
    ])
    const a = out.mods.find((m) => m.id === 'a')!
    expect(a.relations).toEqual([{ kind: 'incompatible', target: { mod: 'b' }, note: 'Your rule: crash', source: { type: 'user' } }])
    expect(a.loadOrder?.above).toEqual([{ mod: 'b' }])
    expect(catalog.mods[0].relations).toEqual([])
  })
})

describe('issues', () => {
  const c: Contribution = { id: 'x', type: 'rule', modId: 'a', title: 'Rule: A requires B', payload: { kind: 'requires', other: 'mod:b' }, createdAt: '' }

  it('puts a machine-readable JSON block into the body', () => {
    const body = issueBody(c, '2026-10-31')
    const json = JSON.parse(body.split('```json\n')[1].split('\n```')[0])
    expect(json).toEqual({ type: 'rule', modId: 'a', kind: 'requires', other: 'mod:b' })
  })

  it('builds a prefilled GitHub new-issue link', () => {
    const url = new URL(issueUrl('owner/repo', c, '2026-10-31'))
    expect(url.pathname).toBe('/owner/repo/issues/new')
    expect(url.searchParams.get('labels')).toBe('rule')
    expect(url.searchParams.get('title')).toBe('Rule: A requires B')
  })
})
