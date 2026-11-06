import { describe, expect, it } from 'vitest'
import type { Catalog, Mod, Preset } from '@catalog/schema'
import { buildIndex } from './match'
import { resolveProfile, type Profile } from './profile'
import { checkProfile, conflictRule, moveAbove, oldRule } from './check'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return { id, name: id.toUpperCase(), authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [{ file: `${id}.pack`, from: 'download' }], relations: [], curation: { lastChecked: '', confidence: 'high' }, ...extra }
}
const entry = (id: string) => ({ pack: `${id}.pack`, from: 'download' as const, target: { mod: id } })
const preset: Preset = {
  id: 'p', name: 'Setup', playAs: [], phase: 'any', origin: 'guide', source: { type: 'derived' }, entries: ['a', 'b', 'c', 'old', 'stop', 'no', 'dead', 'gone', 'gone2'].map(entry),
  avoid: [{ target: { mod: 'no' }, note: 'It makes the wrong thing female.' }]
}
const mods = [
  mod('a', { relations: [{ kind: 'incompatible', target: { mod: 'b' }, note: 'Same scripts.', source: { type: 'discord', url: 'https://discord.com/x' } }], loadOrder: { above: [{ mod: 'c' }] } }),
  mod('b'),
  mod('c', { relations: [{ kind: 'requires', target: { mod: 'missing' }, note: 'Needs it.', source: { type: 'loverslab' } }] }),
  mod('missing'),
  mod('old', { changesData: true, updated: '2026-01-01' }),
  mod('stop', { stopsGame: 'stops the game at launch (test).' }),
  mod('no'),
  mod('dead', { status: 'abandoned' }),
  mod('gone'),
  mod('gone2', { relations: [{ kind: 'supersedes', target: { mod: 'gone' }, source: { type: 'steam' } }] })
]
const catalog = { schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], campaignGuides: [], external: [], mods, presets: [preset], gameUpdates: [{ date: '2026-09-24', title: 'Big one' }] } as unknown as Catalog

const profile: Pick<Profile, 'extras' | 'removed'> = { extras: [], removed: [] }
const order = ['mod:c', 'mod:b', 'mod:a', 'mod:old', 'mod:stop', 'mod:no', 'mod:dead', 'mod:gone', 'mod:gone2']
const run = (cat = catalog, p: Partial<Profile> = {}) => {
  const index = buildIndex(cat)
  return checkProfile(cat, index, preset, p, resolveProfile(cat, index, preset, profile), order)
}

describe('profile check', () => {
  it('finds each kind of point with its reason and source', () => {
    const points = run()
    const by = (rule: string) => points.find((x) => x.rule === rule)!
    expect(points.map((x) => x.kind)).toEqual(['conflict', 'stops', 'outdated', 'outdated', 'requires', 'order', 'avoid', 'old'])
    expect(by(conflictRule('mod:a', 'mod:b'))).toMatchObject({ why: 'Same scripts.', source: 'Discord post', sourceUrl: 'https://discord.com/x' })
    expect(by('requires|mod:c|mod:missing').actions[0]).toMatchObject({ type: 'add', key: 'mod:missing' })
    expect(by('load|mod:a|mod:c').actions[0]).toMatchObject({ type: 'move', key: 'mod:a', above: 'mod:c' })
    expect(by('outdated|mod:gone|mod:gone2').actions[0]).toMatchObject({ type: 'remove', key: 'mod:gone' })
    expect(by('avoid|p|mod:no').why).toBe('It makes the wrong thing female.')
    expect(by(oldRule('mod:old', '2026-09-24'))).toMatchObject({ info: true })
    expect(by('stops|mod:stop').why).toMatch(/^Stops the game/)
  })

  it('needs no fix warning for a mod the profile plays with a fix', () => {
    expect(run(catalog, { fixes: { stop: 'fix-1' } }).some((x) => x.kind === 'stops')).toBe(false)
  })

  it('takes the order rule from either side once and not when the order is right', () => {
    const cat = { ...catalog, mods: mods.map((m) => (m.id === 'c' ? { ...m, loadOrder: { below: [{ mod: 'a' }] } } : m)) } as Catalog
    expect(run(cat).filter((x) => x.kind === 'order')).toHaveLength(1)
    const index = buildIndex(cat)
    const right = ['mod:a', ...order.filter((k) => k !== 'mod:a')]
    expect(checkProfile(cat, index, preset, {}, resolveProfile(cat, index, preset, profile), right).filter((x) => x.kind === 'order')).toHaveLength(0)
  })

  it('shows what players and maintainers said: disputed, kept with the answer, changed reason, retired gone', () => {
    const conflict = conflictRule('mod:a', 'mod:b')
    const flagged = (f: NonNullable<Catalog['ruleFlags']>[string]) => run({ ...catalog, ruleFlags: { [conflict]: f } }).find((x) => x.rule === conflict)
    expect(flagged({ flags: 3 })?.status).toBe('3 players flagged this as wrong · a maintainer has not looked at it yet')
    expect(flagged({ flags: 5, decision: 'kept', answer: 'They do clash.', date: '2026-11-05' })?.status).toBe('Flagged before and checked 2026-11-05: the rule stays. They do clash.')
    expect(flagged({ decision: 'changed', answer: 'Only the merged pack clashes.' })?.why).toBe('Only the merged pack clashes.')
    expect(flagged({ flags: 9, decision: 'retired' })).toBeUndefined()
  })

  it('moves a mod directly above another', () => {
    expect(moveAbove(['a', 'b', 'c'], 'c', 'b')).toEqual(['a', 'c', 'b'])
    expect(moveAbove(['a', 'b'], 'x', 'a')).toEqual(['x', 'a', 'b'])
    expect(moveAbove(['a', 'b'], 'a', 'nope')).toEqual(['a', 'b'])
  })
})
