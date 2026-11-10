import { describe, expect, it } from 'vitest'
import type { Catalog, Mod } from '@catalog/schema'
import { buildIndex } from './match'
import { candidates, resolveProfile } from './profile'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id, name: id, authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [], relations: [],
    curation: { lastChecked: '2026-10-31', confidence: 'high' }, ...extra
  }
}
const src = { type: 'loverslab' as const }

const catalog: Catalog = {
  schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], campaignGuides: [], external: [],
  mods: [
    mod('framework', { kind: 'framework' }),
    mod('atb', { kind: 'campaign', playAs: [{ character: 'Alarielle' }],
      relations: [{ kind: 'recommends', target: { mod: 'lyra' }, note: 'legendary hero', source: src }] }),
    mod('lyra', { relations: [{ kind: 'requires', target: { mod: 'lyra-assets' }, source: src }] }),
    mod('lyra-assets', { kind: 'assets' }),
    mod('atb-es', { kind: 'translation', relations: [{ kind: 'extends', target: { mod: 'atb' }, source: src }] }),
    mod('other-es', { kind: 'translation', relations: [{ kind: 'extends', target: { mod: 'elsewhere' }, source: src }] }),
    mod('alarielle-skin', { kind: 'reskin', playAs: [{ character: 'Alarielle' }] }),
    mod('ascension', { kind: 'campaign', relations: [{ kind: 'incompatible', target: { mod: 'framework' }, source: src }] }),
    mod('unrelated', {}),
    mod('ui-mod', { kind: 'utility', tags: ['general', 'ui'] })
  ],
  presets: [{
    id: 'alarielle', name: 'Alarielle', playAs: ['Alarielle'], phase: 'early', origin: 'tested', source: { type: 'discord' },
    entries: [
      { pack: 'atb.pack', from: 'steam', steamId: '1', target: { mod: 'atb' } },
      { pack: 'fw.pack', from: 'steam', steamId: '2', target: { mod: 'framework' } }
    ]
  }]
}
const index = buildIndex(catalog)
const preset = catalog.presets[0]

describe('candidates', () => {
  const list = candidates(catalog, index, preset, { extras: [], removed: [] })
  const byKey = new Map(list.map((c) => [c.key, c]))

  it('groups recommendations, character mods and the rest', () => {
    expect(byKey.get('mod:lyra')?.group).toBe('recommended')
    expect(byKey.get('mod:atb-es')?.group).toBe('translation')
    expect(byKey.get('mod:alarielle-skin')?.group).toBe('character')
    expect(byKey.get('mod:unrelated')?.group).toBe('other')
    expect(byKey.get('mod:ui-mod')?.group).toBe('general')
  })

  it('offers only translations of mods in the profile and never the profile mods themselves', () => {
    expect(byKey.has('mod:other-es')).toBe(false)
    expect(byKey.has('mod:atb')).toBe(false)
  })

  it('reports dependencies and conflicts of each option', () => {
    expect(byKey.get('mod:lyra')?.addsDependencies).toEqual(['mod:lyra-assets'])
    expect(byKey.get('mod:ascension')?.conflicts).toEqual(['mod:framework'])
  })

  it('does not offer a mod whose packs the profile already loads (a page bundling two Workshop items)', () => {
    const bundle = mod('bundle', { kind: 'progression', packs: [
      { file: 'ATB.pack', from: 'steam' }, { file: 'fw.pack', from: 'steam' }, { file: 'extra.pack', from: 'download', optional: true }
    ] })
    const half = mod('half', { packs: [{ file: 'atb.pack', from: 'steam' }, { file: 'new.pack', from: 'download' }] })
    const cat = { ...catalog, mods: [...catalog.mods, bundle, half] }
    const keys = candidates(cat, buildIndex(cat), preset, { extras: [], removed: [] }).map((c) => c.key)
    expect(keys).not.toContain('mod:bundle')
    expect(keys).toContain('mod:half')
  })
})

describe('alternatives', () => {
  it('marks other members of an exclusive group as alternatives once one is in the profile', () => {
    const cat: Catalog = {
      ...catalog,
      mods: [
        ...catalog.mods,
        mod('uuu-alarielle'), mod('uuu-morathi'),
        mod('readman', { relations: [
          { kind: 'optional', target: { mod: 'uuu-alarielle' }, exclusiveGroup: 'uuu', source: src },
          { kind: 'optional', target: { mod: 'uuu-morathi' }, exclusiveGroup: 'uuu', source: src }
        ] })
      ]
    }
    const p = { ...preset, entries: [...preset.entries, { pack: 'r.pack', from: 'steam' as const, target: { mod: 'readman' } }] }
    const list = candidates(cat, buildIndex(cat), p, { extras: ['mod:uuu-alarielle'], removed: [] })
    expect(list.find((c) => c.key === 'mod:uuu-morathi')?.alternativeTo).toEqual(['mod:uuu-alarielle'])
  })
})

describe('resolveProfile', () => {
  it('adds dependencies, keeps the base order and places extras above what they extend', () => {
    const r = resolveProfile(catalog, index, preset, { extras: ['mod:lyra', 'mod:atb-es'], removed: [] })
    expect(r.entries.map((e) => e.key)).toEqual(['mod:atb-es', 'mod:atb', 'mod:framework', 'mod:lyra', 'mod:lyra-assets'])
    expect(r.entries.find((e) => e.key === 'mod:lyra-assets')?.origin).toBe('dependency')
  })

  it('takes a requirement as met by a mod that replaces it', () => {
    const c = { ...catalog, mods: [...catalog.mods, mod('merged', { relations: [{ kind: 'supersedes', target: { mod: 'lyra-assets' }, source: src }] })] }
    const ix = buildIndex(c)
    const r = resolveProfile(c, ix, preset, { extras: ['mod:merged', 'mod:lyra'], removed: [] })
    expect(r.entries.map((e) => e.key)).not.toContain('mod:lyra-assets')
  })

  it('loads the pack a requirement names of a mod with versions', () => {
    const c = { ...catalog, mods: [...catalog.mods,
      mod('beasts', { packs: [{ file: 'light.pack', from: 'download', exclusiveGroup: 'v' }, { file: 'full.pack', from: 'steam', exclusiveGroup: 'v' }] }),
      mod('sla', { relations: [{ kind: 'requires', target: { mod: 'beasts' }, pack: 'full.pack', source: src }] })] }
    const r = resolveProfile(c, buildIndex(c), preset, { extras: ['mod:sla'], removed: [] })
    expect(r.entries.find((e) => e.key === 'mod:beasts')?.packs).toEqual(['full.pack'])
  })

  it('applies a requirement tied to one of its own packs when that pack is loaded', () => {
    const c = { ...catalog, mods: [...catalog.mods,
      mod('seduce', { packs: [{ file: 'cth.pack', from: 'download', optional: true, note: 'Alarielle version' }, { file: 'kat.pack', from: 'download', optional: true, note: 'Katarin version' }],
        relations: [
          { kind: 'requires', target: { mod: 'lyra-assets' }, condition: 'Alarielle version (cth)', whenPack: 'cth.pack', source: src },
          { kind: 'requires', target: { mod: 'unrelated' }, condition: 'Katarin version (kat)', whenPack: 'kat.pack', source: src }] })] }
    const r = resolveProfile(c, buildIndex(c), preset, { extras: ['mod:seduce'], removed: [] })
    expect(r.entries.map((e) => e.key)).toContain('mod:lyra-assets')
    expect(r.entries.map((e) => e.key)).not.toContain('mod:unrelated')
  })

  it('puts a reskin the player picked on top, so it beats the template mods that change the same models', () => {
    const r = resolveProfile(catalog, index, preset, { extras: ['mod:unrelated', 'mod:alarielle-skin'], removed: [] })
    expect(r.entries.map((e) => e.key)).toEqual(['mod:alarielle-skin', 'mod:atb', 'mod:framework', 'mod:unrelated'])
  })

  it("puts an army's look below the character looks the player picked, in either order of adding", () => {
    const c: Catalog = { ...catalog, mods: [...catalog.mods, mod('army', { kind: 'reskin', factionLook: ['high elves'] })] }
    for (const extras of [['mod:army', 'mod:alarielle-skin'], ['mod:alarielle-skin', 'mod:army']]) {
      const r = resolveProfile(c, buildIndex(c), preset, { extras, removed: [] })
      expect(r.entries.map((e) => e.key).slice(0, 3)).toEqual(['mod:alarielle-skin', 'mod:army', 'mod:atb'])
    }
  })

  it('treats incompatibilities inside a tested template as notes and ignores conditional ones', () => {
    const cat: Catalog = {
      ...catalog,
      mods: [
        mod('x', { relations: [
          { kind: 'incompatible', target: { mod: 'y' }, note: 'only the old version', source: src },
          { kind: 'incompatible', target: { mod: 'z' }, condition: 'when playing as Miao', source: src }
        ] }),
        mod('y'), mod('z')
      ]
    }
    const tested = { ...preset, entries: [{ pack: 'x.pack', from: 'steam' as const, target: { mod: 'x' } }, { pack: 'y.pack', from: 'steam' as const, target: { mod: 'y' } }] }
    const r = resolveProfile(cat, buildIndex(cat), tested, { extras: ['mod:z'], removed: [] })
    expect(r.conflicts).toEqual([])
    expect(r.notes.map((n) => n.note)).toEqual(['only the old version'])
  })

  it('drops removed base entries and reports conflicts', () => {
    const r = resolveProfile(catalog, index, preset, { extras: ['mod:ascension'], removed: ['mod:atb'] })
    expect(r.entries.map((e) => e.key)).not.toContain('mod:atb')
    expect(r.conflicts).toHaveLength(1)
  })
})
