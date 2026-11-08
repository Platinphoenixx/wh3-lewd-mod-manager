import { describe, expect, it } from 'vitest'
import type { PickOne } from './suggest'
import type { Catalog, Mod, Preset } from '@catalog/schema'
import { buildIndex } from './match'
import {
  communityOf, guidedProfile, isFavourite, lateListOf, setupDiff, setupFromProfile, stepsFor, subjectsOf, suggestedFor, tiersFor, voteLine
} from './setups'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id, name: id, authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [{ file: `${id}.pack`, from: 'steam' }], relations: [],
    curation: { lastChecked: '2026-11-03', confidence: 'high' }, images: [{ url: `https://img/${id}.png`, kind: 'cover', source: 'steam' }], ...extra
  }
}
const list = (id: string, playAs: string[], mods: string[], extra: Partial<Preset> = {}): Preset => ({
  id, name: id, playAs, phase: 'early', origin: 'tested', source: { type: 'discord' },
  entries: mods.map((m) => ({ pack: `${m}.pack`, from: 'steam' as const, target: { mod: m } })), ...extra
})

const src = { type: 'loverslab' as const }
const catalog: Catalog = {
  schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], campaignGuides: [], external: [],
  mods: [
    mod('miao-progression', { kind: 'progression', playAs: [{ character: 'Miao Ying' }], tags: ['cathay'] }),
    mod('miao-story', { kind: 'campaign', playAs: [{ character: 'Miao Ying' }] }),
    mod('camera', { kind: 'utility', tags: ['general'] }),
    mod('miao-skin-a', { kind: 'reskin', playAs: [{ character: 'Miao Ying' }] }),
    mod('miao-skin-b', { kind: 'reskin', playAs: [{ character: 'Miao Ying' }] }),
    mod('cathay-units', { tags: ['cathay'] }),
    mod('nkari-campaign', { kind: 'campaign', playAs: [{ character: "N'Kari" }] }),
    mod('daemon-units', { tags: ['slaanesh'], relations: [{ kind: 'recommends', target: { mod: 'nkari-campaign' }, source: src }] })
  ],
  presets: [
    list('miao-early', ['Miao Ying'], ['miao-progression', 'miao-story', 'camera'], { launchTest: { result: 'main menu', game: '9.0.4', date: '2026-11-02' } }),
    list('miao-late', ['Miao Ying'], ['miao-progression', 'miao-story', 'camera', 'cathay-units'], { phase: 'late' }),
    list('miao-guide', ['Miao'], ['miao-progression'], { origin: 'guide', phase: 'any' }),
    list('daemons', ["N'kari", 'Dechala'], ['nkari-campaign'], { theme: 'Daemons of Slaanesh' })
  ]
}
const index = buildIndex(catalog)
const subjects = subjectsOf(catalog, index)
const miao = subjects.find((s) => s.name === 'Miao Ying')!

describe('guided setups', () => {
  it('groups lists by character (spellings joined) and by theme', () => {
    expect(subjects.map((s) => [s.kind, s.name])).toEqual([['character', 'Miao Ying'], ['theme', 'Daemons of Slaanesh']])
    expect(miao.presets.map((p) => p.id)).toEqual(['miao-early', 'miao-late', 'miao-guide'])
    expect(subjects[1].characters).toEqual(["N'Kari", 'Dechala'])
  })

  it('pictures a character with a mod about her, story mods first', () => {
    expect(miao.coverMods[0]).toBe('miao-progression')
  })

  it('offers the guide as Essentials and the tested early list as the recommended Full campaign', () => {
    const tiers = tiersFor(catalog, index, miao)
    expect(tiers.map((t) => [t.id, t.preset.id, t.recommended])).toEqual([
      ['essentials', 'miao-guide', false], ['full', 'miao-early', true], ['extended', 'miao-early', false]
    ])
    expect(tiers[1].proof).toBe('Played as it is by its author · launch-tested with game 9.0.4')
    expect(tiers[0].tested).toBe(false) // the guide has no launch test here
    expect(tiers[2].extras).toContain('mod:cathay-units')
    expect(lateListOf(miao)?.id).toBe('miao-late')
  })

  it('asks for the character’s look first and ends with quality of life and the review', () => {
    const picks = suggestedFor(catalog, index, miao.presets[0]).picks
    const stagePick = (character: string, extra: object) => ({ pick: [{ key: 'mod:x', mod: { name: 'x' }, reasons: [] }], note: `They all change how ${character} looks`, score: 1, ...extra }) as unknown as PickOne
    const staged = { character: 'Miao Ying', stages: 8, key: 'mod:s', by: 'S', campaign: true }
    const own = stepsFor(miao, [stagePick('Miao Ying', { stage: staged })], false)[0]
    expect(own).toMatchObject({ question: 'Miao Ying already changes as she falls', subtitle: 'Her campaign changes it by stage', kind: 'pick' })
    const single = stepsFor(miao, [{ ...stagePick('Miao Ying', {}), note: 'It changes how Miao Ying looks' }], false)[0]
    expect(single.question).toBe('How should Miao Ying look?')
    const steps = stepsFor(miao, picks, true)
    expect(steps.map((s) => s.title)).toEqual(["Miao Ying's look", 'Quality of life', 'Review and install'])
    expect(steps[0].groups[0].pick.map((p) => p.key).sort()).toEqual(['mod:miao-skin-a', 'mod:miao-skin-b'])
  })

  it('makes a profile from the size, the choices and what the player dropped', () => {
    const tier = tiersFor(catalog, index, miao).find((t) => t.id === 'full')!
    const picks = suggestedFor(catalog, index, tier.preset).picks
    const p = guidedProfile(tier, { [picks[0].pick[0].key]: 'mod:miao-skin-b' }, picks, new Set(['mod:camera']), 'Miao Ying – Full campaign')
    expect(p.presetId).toBe('miao-early')
    expect(p.extras).toEqual(['mod:miao-skin-b'])
    expect(p.removed).toEqual(['mod:camera'])
    expect(p.declined).toEqual(['mod:miao-skin-a'])
  })
})

describe('shared setups', () => {
  const shared = (id: string, votes?: { up: number; down: number }, mods = ['miao-progression', 'miao-story', 'miao-skin-a']): Preset =>
    list(id, ['Miao Ying'], mods, { origin: 'community', phase: 'any', source: { type: 'community', author: 'anonymous', date: '2026-11-03' },
      community: { base: 'miao-early' }, ...(votes ? { votes } : {}) })
  const cat: Catalog = { ...catalog, presets: [...catalog.presets, shared('few', { up: 2, down: 0 }), shared('many', { up: 40, down: 4 }), shared('bad', { up: 1, down: 6 })] }
  const subject = subjectsOf(cat, buildIndex(cat)).find((s) => s.name === 'Miao Ying')!

  it('lists them by how sure it is that they work: many good votes before a few', () => {
    expect(communityOf(subject).map((p) => p.id)).toEqual(['many', 'few', 'bad'])
    expect(isFavourite({ up: 40, down: 4 })).toBe(true)
    expect(isFavourite({ up: 2, down: 0 })).toBe(false) // too few players yet
    expect(voteLine({ up: 40, down: 4 })).toBe('▲ 91% of 44 players')
  })

  it('keeps shared setups out of the sizes', () => {
    expect(tiersFor(cat, buildIndex(cat), subject).some((t) => t.preset.origin === 'community')).toBe(false)
  })

  it('shows what a setup adds to and leaves out of its template', () => {
    expect(setupDiff(cat.presets.find((p) => p.id === 'many')!, catalog.presets[0])).toEqual({ added: ['mod:miao-skin-a'], dropped: ['mod:camera'] })
  })

  it('shares a profile as its mod list in load order, own packs by name only', () => {
    const s = setupFromProfile(catalog, index, catalog.presets[0], { extras: ['mod:miao-skin-b', 'pack:my_tweaks.pack'], removed: ['mod:camera'] },
      { name: 'Mine', game: '9.0.4' })
    expect(s.base).toBe('miao-early')
    expect(s.entries.map((e) => e.mod).sort()).toEqual(['miao-progression', 'miao-skin-b', 'miao-story'])
    expect(s.own).toEqual(['my_tweaks.pack'])
  })
})
