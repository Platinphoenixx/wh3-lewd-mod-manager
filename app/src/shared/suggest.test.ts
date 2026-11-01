import { describe, expect, it } from 'vitest'
import type { Catalog, Mod, Preset } from '@catalog/schema'
import { buildIndex } from './match'
import { candidates } from './profile'
import { isPickOne, suggestForProfile, type SuggestionEntry } from './suggest'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id, name: id, authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [], relations: [],
    curation: { lastChecked: '2026-11-01', confidence: 'high' }, ...extra
  }
}
const src = { type: 'loverslab' as const }
const list = (id: string, playAs: string[], mods: string[], origin: Preset['origin'] = 'tested'): Preset => ({
  id, name: id, playAs, phase: 'early', origin, source: { type: 'discord' },
  entries: mods.map((m) => ({ pack: `${m}.pack`, from: 'steam' as const, target: { mod: m } }))
})

const catalog: Catalog = {
  schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], campaignGuides: [], external: [],
  mods: [
    mod('miao', { kind: 'progression', tags: ['cathay'], playAs: [{ character: 'Miao Ying' }],
      relations: [{ kind: 'recommends', target: { mod: 'flags' }, source: src }] }),
    mod('flags', { kind: 'assets' }),
    mod('miao-skin', { kind: 'reskin', playAs: [{ character: 'Miao Ying' }] }),
    mod('miao-skin-2', { kind: 'reskin', playAs: [{ character: 'Miao Ying' }] }),
    mod('cathay-a', { kind: 'units', tags: ['cathay'], relations: [{ kind: 'incompatible', target: { mod: 'cathay-b' }, source: src }] }),
    mod('cathay-b', { kind: 'units', tags: ['cathay'] }),
    mod('cathay-units', { tags: ['cathay'], sources: { loverslab: { fileId: '1', url: '', category: 'mods', downloads: 25000 } } }),
    mod('popular-in-miao-lists', {}),
    mod('alarielle-campaign', { kind: 'campaign', playAs: [{ character: 'Alarielle' }] }),
    mod('alarielle-submod', { kind: 'submod', relations: [{ kind: 'extends', target: { mod: 'alarielle-campaign' }, source: src }] }),
    mod('nothing-to-do-with-it', {}),
    mod('camera', { kind: 'utility', tags: ['general'], sources: { steam: [{ id: '9', subscribers: 600000 }] } }),
    mod('modern-warfare', { kind: 'units', tags: ['general'], sources: { steam: [{ id: '8', subscribers: 900000 }] } }),
    mod('clash', { tags: ['cathay'], relations: [{ kind: 'incompatible', target: { mod: 'miao' }, source: src }] })
  ],
  presets: [
    list('miao-template', ['Miao Ying'], ['miao']),
    list('other-miao-list', ['Miao Ying'], ['miao', 'popular-in-miao-lists', 'camera', 'alarielle-submod']),
    list('alarielle-list', ['Alarielle'], ['alarielle-campaign', 'alarielle-submod', 'camera', 'nothing-to-do-with-it'])
  ]
}
const index = buildIndex(catalog)
const preset = catalog.presets[0]
const profile = { extras: [], removed: [] }
const s = suggestForProfile(catalog, index, preset, profile, candidates(catalog, index, preset, profile))
const keys = (l: SuggestionEntry[]) => l.flatMap((x) => (isPickOne(x) ? x.pick.map((p) => p.key) : [x.key]))

describe('profile suggestions', () => {
  it('suggests what fits the character and what other lists for her use', () => {
    expect(keys(s.lewd)).toEqual(expect.arrayContaining(['mod:flags', 'mod:miao-skin', 'mod:cathay-units', 'mod:popular-in-miao-lists']))
    expect(keys(s.lewd)[0]).toBe('mod:popular-in-miao-lists') // in a list for the same character + nothing else needed
  })

  it('leaves out what the player removed from the template', () => {
    const p = { extras: [], removed: ['mod:miao'] }
    const r = suggestForProfile(catalog, index, preset, p, candidates(catalog, index, preset, p))
    expect(keys(r.lewd)).not.toContain('mod:miao')
  })

  it('leaves out other stories, things built on them, unrelated and conflicting mods', () => {
    for (const k of ['mod:alarielle-campaign', 'mod:alarielle-submod', 'mod:nothing-to-do-with-it', 'mod:clash']) expect(keys(s.lewd)).not.toContain(k)
  })

  it('offers general mods only when lewd lists use them, however popular they are', () => {
    expect(keys(s.general)).toEqual(['mod:camera'])
  })

  it('offers mods that exclude each other as one "pick one" choice', () => {
    const groups = s.lewd.filter(isPickOne)
    const skins = groups.find((g) => g.pick.some((p) => p.key === 'mod:miao-skin'))
    expect(skins?.pick.map((p) => p.key).sort()).toEqual(['mod:miao-skin', 'mod:miao-skin-2'])
    expect(skins?.note).toBe('They all change how Miao Ying looks')
    const clash = groups.find((g) => g.pick.some((p) => p.key === 'mod:cathay-a'))
    expect(clash?.pick.map((p) => p.key).sort()).toEqual(['mod:cathay-a', 'mod:cathay-b'])
    expect(clash?.note).toBe('These do not work together')
  })

  it('explains each suggestion in at most two reasons', () => {
    const flat = [...s.lewd, ...s.general].flatMap((x) => (isPickOne(x) ? x.pick : [x]))
    const byKey = new Map(flat.map((x) => [x.key, x.reasons]))
    expect(byKey.get('mod:popular-in-miao-lists')).toEqual(['In 1 of 1 community lists for Miao Ying'])
    expect(byKey.get('mod:flags')).toEqual(['Recommended by miao'])
    expect(byKey.get('mod:cathay-units')).toEqual(['For Cathay', '25k LoversLab downloads'])
    expect(byKey.get('mod:camera')).toEqual(['In 1 of 1 community lists for Miao Ying', '600k Workshop subscribers'])
  })
})
