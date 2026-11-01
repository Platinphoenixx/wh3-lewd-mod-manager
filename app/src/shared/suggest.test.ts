import { describe, expect, it } from 'vitest'
import type { Catalog, Mod, Preset } from '@catalog/schema'
import { buildIndex } from './match'
import { candidates } from './profile'
import { suggestForProfile } from './suggest'

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
const keys = (l: { key: string }[]) => l.map((x) => x.key)

describe('profile suggestions', () => {
  it('suggests what fits the character and what other lists for her use', () => {
    expect(keys(s.lewd)).toEqual(expect.arrayContaining(['mod:flags', 'mod:miao-skin', 'mod:cathay-units', 'mod:popular-in-miao-lists']))
    expect(s.lewd[0].key).toBe('mod:popular-in-miao-lists') // in a list for the same character + nothing else needed
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

  it('explains each suggestion in at most two reasons', () => {
    const byKey = new Map([...s.lewd, ...s.general].map((x) => [x.key, x.reasons]))
    expect(byKey.get('mod:popular-in-miao-lists')).toEqual(['In 1 of 1 community lists for Miao Ying'])
    expect(byKey.get('mod:flags')).toEqual(['Recommended by miao'])
    expect(byKey.get('mod:cathay-units')).toEqual(['For Cathay', '25k LoversLab downloads'])
    expect(byKey.get('mod:camera')).toEqual(['In 1 of 1 community lists for Miao Ying', '600k Workshop subscribers'])
  })
})
