import { describe, expect, it } from 'vitest'
import { checkOwnMod, collectFacts, isOwnKey, ownKeyOf, placeOwnMods, type OrderedEntry } from './own'

const files = (...paths: string[]) => paths.map((path) => ({ path }))

// A base mod with models and a table, a framework it needs, and an unrelated UI mod.
const facts = collectFacts([
  { path: 'w/1/base.pack', dependencies: ['framework.pack'], files: files('variantmeshes/a.wsmodel', 'variantmeshes/b.wsmodel', 'tex/a.dds', 'db/units_tables/base') },
  { path: 'w/2/framework.pack', dependencies: [], files: files('script/fw.lua', 'settings.rpfm_reserved') },
  { path: 'data/ui.pack', dependencies: [], files: files('ui/x.png') },
  // own: a small reskin of base, a library that base-like mods need, a big overhaul that a small mod patches
  { path: 'data/reskin.pack', dependencies: ['Base.pack'], files: files('tex/a.dds') },
  { path: 'data/lib.pack', dependencies: [], files: files('script/lib.lua') },
  { path: 'w/9/overhaul.pack', dependencies: [], files: files('ui/x.png', 'ui/y.png', 'ui/z.png', 'db/units_tables/overhaul') }
])

const entries: OrderedEntry[] = [
  { key: 'mod:base', name: 'Base', paths: ['w/1/base.pack'] },
  { key: 'mod:ui', name: 'UI', paths: ['data/ui.pack'] },
  { key: 'mod:fw', name: 'Framework', paths: ['w/2/framework.pack'] }
]

describe('own mods', () => {
  it('keys packs by Workshop item or file name', () => {
    expect(ownKeyOf({ file: 'a.pack', source: 'workshop', steamId: '42', path: '', size: 0, mtime: 0 })).toBe('steamId:42')
    expect(ownKeyOf({ file: 'a.pack', source: 'data', path: '', size: 0, mtime: 0 })).toBe('pack:a.pack')
    expect(isOwnKey('pack:a.pack') && isOwnKey('steamId:1') && !isOwnKey('mod:x')).toBe(true)
  })

  it('collects dependencies, file counts without bookkeeping, tables and overlaps', () => {
    expect(facts.packs['w/2/framework.pack']).toEqual({ dependencies: [], files: 1, tables: [] })
    expect(facts.packs['data/reskin.pack']?.dependencies).toEqual(['base.pack'])
    expect(facts.overlaps).toContainEqual({ a: 'w/1/base.pack', b: 'data/reskin.pack', count: 1 })
  })

  it('places a small mod above the mod it needs and changes, with a reason', () => {
    const order = placeOwnMods(entries, [{ key: 'pack:reskin.pack', name: 'Reskin', paths: ['data/reskin.pack'] }], facts)
    expect(order.map((e) => e.key)).toEqual(['pack:reskin.pack', 'mod:base', 'mod:ui', 'mod:fw'])
    expect(order[0].own?.reason).toMatch(/^Above Base, which it needs; above Base: changes 1 of its files/)
  })

  it('places a bigger mod below the smaller one that changes it, and unrelated mods at the bottom', () => {
    const order = placeOwnMods(entries, [
      { key: 'steamId:9', name: 'Overhaul', paths: ['w/9/overhaul.pack'] },
      { key: 'pack:lib.pack', name: 'Lib', paths: ['data/lib.pack'] }
    ], facts)
    expect(order.map((e) => e.key)).toEqual(['mod:base', 'mod:ui', 'steamId:9', 'mod:fw', 'pack:lib.pack'])
    expect(order[4].own?.reason).toMatch(/position does not matter/)
  })

  it('keeps positions the player chose, also when pinned to another own mod', () => {
    const order = placeOwnMods(entries, [
      { key: 'pack:lib.pack', name: 'Lib', paths: ['data/lib.pack'] },
      { key: 'pack:reskin.pack', name: 'Reskin', paths: ['data/reskin.pack'] }
    ], facts, { 'pack:lib.pack': 'mod:ui', 'pack:reskin.pack': 'pack:lib.pack' })
    expect(order.map((e) => e.key)).toEqual(['mod:base', 'pack:reskin.pack', 'pack:lib.pack', 'mod:ui', 'mod:fw'])
    expect(order[1].own).toEqual({ reason: 'Placed here by you.', pinned: true })
  })

  it('reports missing requirements, overrides in both directions and shared tables', () => {
    const order = placeOwnMods(entries, [{ key: 'steamId:9', name: 'Overhaul', paths: ['w/9/overhaul.pack'] }], facts)
    const reskin = collectFacts([{ path: 'data/r.pack', dependencies: ['gone.pack', 'lib.pack'], files: [] }])
    const all = { packs: { ...facts.packs, ...reskin.packs }, overlaps: facts.overlaps }
    const withReskin = [...order, { key: 'pack:r.pack', name: 'R', paths: ['data/r.pack'] }]
    const c = checkOwnMod(withReskin, 'pack:r.pack', all, new Map([['lib.pack', 'pack:lib.pack']]))
    expect(c.missing).toEqual(['gone.pack'])
    expect(c.notInProfile).toEqual([{ pack: 'lib.pack', key: 'pack:lib.pack' }])

    const o = checkOwnMod(order, 'steamId:9', facts, new Map())
    expect(o.overlaps).toEqual([{ key: 'mod:ui', name: 'UI', count: 1, wins: false }])
    expect(o.sharedTables).toEqual([{ key: 'mod:base', name: 'Base', tables: ['units_tables'] }])
  })
})
