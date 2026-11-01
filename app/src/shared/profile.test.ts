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
