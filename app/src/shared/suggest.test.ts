import { describe, expect, it } from 'vitest'
import type { Catalog, Mod, Preset } from '@catalog/schema'
import { buildIndex } from './match'
import { candidates } from './profile'
import { ideaGroups, isHeldBack, isPickOne, suggestForProfile, type Suggestion, type SuggestionEntry } from './suggest'

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
    mod('clash', { tags: ['cathay'], relations: [{ kind: 'incompatible', target: { mod: 'miao' }, source: src }] }),
    mod('lazy-skin', { kind: 'reskin', tags: ['miao ying'], name: 'Lazy Miao Ying skins' }),
    // Tagged for Miao Ying's campaign, but a unit reskin: not her look.
    mod('unit-skin', { kind: 'reskin', tags: ['miao ying'], name: 'Corrupted lancers' })
  ],
  presets: [
    list('miao-template', ['Miao Ying'], ['miao']),
    list('other-miao-list', ['Miao Ying'], ['miao', 'popular-in-miao-lists', 'camera', 'alarielle-submod']),
    list('alarielle-list', ['Alarielle'], ['alarielle-campaign', 'alarielle-submod', 'camera', 'nothing-to-do-with-it']),
    list('miao-skinned', ['Miao Ying'], ['miao', 'lazy-skin'], 'derived')
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
    // What the template's own mod recommends comes first, then what another list for the same character uses.
    expect(keys(s.lewd).slice(0, 2)).toEqual(['mod:flags', 'mod:popular-in-miao-lists'])
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
    expect(skins?.pick.map((p) => p.key).sort()).toEqual(['mod:lazy-skin', 'mod:miao-skin', 'mod:miao-skin-2'])
    expect(skins?.note).toBe('They all change how Miao Ying looks')
    expect(s.lewd.some((x) => isPickOne(x) && x.pick.some((p) => p.key === 'mod:unit-skin'))).toBe(false)
    const clash = groups.find((g) => g.pick.some((p) => p.key === 'mod:cathay-a'))
    expect(clash?.pick.map((p) => p.key).sort()).toEqual(['mod:cathay-a', 'mod:cathay-b'])
    expect(clash?.note).toBe('These do not work together')
  })

  it('selects an option at first only where players of the list really use it', () => {
    const groups = s.lewd.filter(isPickOne)
    // Both Miao Ying reskins are "For Miao Ying" (the template's character): the first is selected.
    expect(groups.find((g) => g.pick.some((p) => p.key === 'mod:miao-skin'))?.preselect).toBe(groups.find((g) => g.pick.some((p) => p.key === 'mod:miao-skin'))?.pick[0].key)
    // Two Cathay unit mods only share the faction: nothing is selected.
    expect(groups.find((g) => g.pick.some((p) => p.key === 'mod:cathay-a'))?.preselect).toBeUndefined()
  })

  it('says which reskin in the profile another reskin would replace, and selects none of them', () => {
    const skinned = catalog.presets.find((p) => p.id === 'miao-skinned')!
    const r = suggestForProfile(catalog, index, skinned, profile, candidates(catalog, index, skinned, profile))
    const g = r.lewd.filter(isPickOne).find((x) => x.pick.some((p) => p.key === 'mod:miao-skin'))!
    expect(g.preselect).toBeUndefined()
    expect(g.pick.every((p) => p.replaces?.[0] === 'Lazy Miao Ying skins')).toBe(true)
    expect(g.pick[0].reasons[0]).toBe('Replaces Lazy Miao Ying skins in this list')
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

describe('isHeldBack', () => {
  const m = (x: Partial<Mod>) => ({ id: 'x', changesData: true, updated: '2025-01-01', ...x }) as Mod
  it('holds back an old mod that changes game data until a launch test after the update confirms it', () => {
    expect(isHeldBack(m({}), '2026-09-24')).toBe(true)
    expect(isHeldBack(m({ confirmed: '2026-11-03' }), '2026-09-24')).toBe(false)
    expect(isHeldBack(m({ confirmed: '2026-09-01' }), '2026-09-24')).toBe(true)
    expect(isHeldBack(m({ updated: '2026-10-01' }), '2026-09-24')).toBe(false)
    expect(isHeldBack(m({ changesData: false }), '2026-09-24')).toBe(false)
    expect(isHeldBack(m({ updated: undefined }), '2026-09-24')).toBe(false)
  })
})

describe('ideas for a list', () => {
  const s = (key: string, extra: Partial<Suggestion> = {}) => ({ key, mod: { id: key } as Mod, reasons: [], score: 1, strong: false, tied: false, fits: false, sameLists: 0, ...extra }) as Suggestion
  it('sorts suggestions into looks, add-ons, what lists use, what fits; nothing only popular elsewhere', () => {
    const g = ideaGroups([
      { pick: [s('look1'), s('look2')], note: 'They all change how Sigvald looks', score: 1 },
      { pick: [s('v1'), s('v2')], note: 'Versions of the same add-on for X', score: 1 },
      s('addon', { tied: true, strong: true }),
      s('list', { strong: true, sameLists: 3 }),
      s('char', { fits: true }),
      s('elsewhere'),
      s('turned-down', { tied: true, strong: true })
    ], new Set(['turned-down']))
    expect(Object.fromEntries(g.map((x) => [x.id, x.ideas.map((i) => i.s.key)]))).toEqual({
      looks: ['look1', 'look2'], addons: ['v1', 'v2', 'addon'], often: ['list'], more: ['char']
    })
    expect(g[0].ideas[1]).toMatchObject({ pickOf: 'look1', note: 'They all change how Sigvald looks' })
  })
})
