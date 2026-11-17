import { describe, expect, it } from 'vitest'
import type { Catalog } from '@catalog/schema'
import { issueBody, issueUrl, newsFor, withUserRules, type Contribution } from './community'

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

describe('news for the player', () => {
  const setup = (votes?: { up: number; down: number }, uses?: number) => ({
    id: 'community-abc123abc123', name: 'Alarielle – Extended', playAs: ['Alarielle'], phase: 'any', origin: 'community',
    source: { type: 'community' }, entries: [], ...(votes ? { votes } : {}), ...(uses ? { uses } : {})
  })
  const cat = (presets: unknown[], ruleFlags = {}) => ({ ...catalog, presets, ruleFlags }) as unknown as Catalog
  const mine = [{ id: 'abc123abc123', name: 'Alarielle – Extended', at: '2026-11-17T10:00:00Z' }]
  const empty = { setups: {}, contributions: {}, flags: {} }

  it('says once when a shared setup is in Play, then only when more players say it worked or use it', () => {
    expect(newsFor(cat([]), mine, [], {}, {}, empty).news).toEqual([]) // not in the catalog yet
    const first = newsFor(cat([setup()]), mine, [], {}, {}, empty)
    expect(first.news.map((n) => n.text)).toEqual(['Your setup “Alarielle – Extended” is in Play now – other players can find it there.'])
    expect(newsFor(cat([setup()]), mine, [], {}, {}, first.seen).news).toEqual([])
    const more = newsFor(cat([setup({ up: 3, down: 1 }, 5)]), mine, [], {}, {}, first.seen)
    expect(more.news[0].text).toBe('3 more players said your setup “Alarielle – Extended” worked – 5 players use it now.')
    // A vote that it did not work is no news for the card.
    expect(newsFor(cat([setup({ up: 3, down: 2 }, 5)]), mine, [], {}, {}, more.seen).news).toEqual([])
  })

  it('tells what became of a contribution and of a flagged rule, once', () => {
    const c = { id: 'c1', type: 'new-mod', title: 'Living Diplomacy', payload: {}, createdAt: '', sentAs: 'relay', url: 'https://github.com/o/r/issues/5' } as Contribution
    const statuses = { [c.url!]: { state: 'added' as const, checkedAt: '' } }
    const flags = { 'conflict|mod:a|mod:b': { flags: 5, decision: 'retired' as const, by: 'players' as const } }
    const r = newsFor(cat([], flags), [], [c], statuses, { 'conflict|mod:a|mod:b': '2026-11-17' }, empty)
    expect(r.news.map((n) => n.text)).toEqual([
      'Your contribution “Living Diplomacy” is in the catalog now. Thank you!',
      'A rule you flagged as wrong is out of the catalog now. Thank you!'
    ])
    expect(newsFor(cat([], flags), [], [c], statuses, { 'conflict|mod:a|mod:b': '2026-11-17' }, r.seen).news).toEqual([])
    // Still waiting: nothing to say.
    expect(newsFor(cat([]), [], [c], { [c.url!]: { state: 'waiting', checkedAt: '' } }, {}, empty).news).toEqual([])
  })
})
