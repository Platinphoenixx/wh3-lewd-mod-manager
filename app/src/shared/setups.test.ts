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

describe('lords in the game\'s own campaign', () => {
  const look = (id: string, extra: Partial<Mod> = {}) => mod(id, { kind: 'reskin', tags: ['wood elves', 'sisters of twilight'], summary: 'Sisters of Twilight reskin', ...extra })
  const vcat: Catalog = {
    ...catalog,
    mods: [
      look('sis-a'), look('sis-b'),
      mod('endo-we', { kind: 'reskin', tags: ['wood elves'], factionLook: ['wood elves'] }),
      mod('zeta-we', { kind: 'reskin', tags: ['wood elves'], factionLook: ['wood elves'] }),
      mod('events', { kind: 'utility' }),
      mod('alarielle-campaign', { kind: 'campaign', playAs: [{ character: 'Alarielle' }] })
    ],
    presets: [{
      id: 'vanilla-sisters', name: 'Sisters of Twilight', playAs: ['Sisters of Twilight'], phase: 'any', origin: 'vanilla', factions: ['wood elves'],
      dlc: 'The Twisted & The Twilight', source: { type: 'wiki' }, entries: [],
      recommends: [{ target: { mod: 'events' }, note: 'works in any campaign' }, { target: { mod: 'endo-we' }, note: 'its army look' }],
      avoid: [{ target: { mod: 'alarielle-campaign' }, note: 'breaks Wood Elf campaigns' }]
    }]
  }
  const vindex = buildIndex(vcat)
  const sisters = subjectsOf(vcat, vindex)[0]

  it('is a subject of its own with the faction it leads', () => {
    expect([sisters.name, sisters.vanilla, sisters.factions]).toEqual(['Sisters of Twilight', true, ['Wood Elves']])
  })

  it('offers Looks, the recommended Lewd add-ons (what the setup names) and nothing it avoids', () => {
    const tiers = tiersFor(vcat, vindex, sisters)
    expect(tiers.map((t) => [t.id, t.name, t.recommended, t.extras])).toEqual([
      ['essentials', 'Looks', false, []], ['extended', 'Lewd add-ons', true, ['mod:events']]
    ])
    expect(tiers[0].size).toBe(2) // one look for the twins, one for the army
    const all = suggestedFor(vcat, vindex, vcat.presets[0])
    expect([...all.lewd, ...all.general].map((s) => s.key)).not.toContain('mod:alarielle-campaign')
  })

  it("asks for the lord's look and the army's look; the Looks size asks nothing else", () => {
    const s = suggestedFor(vcat, vindex, vcat.presets[0])
    const army = s.picks.find((g) => /army looks$/.test(g.note))!
    expect([army.note, army.preselect, army.pick.map((x) => x.key)]).toEqual(['They all change how the Wood Elves army looks', 'mod:endo-we', ['mod:endo-we', 'mod:zeta-we']])
    const steps = stepsFor(sisters, s.picks, true, true)
    expect(steps.map((x) => x.title)).toEqual(["Sisters of Twilight's look", "Your army's look", 'Review and install'])
    expect(stepsFor(sisters, s.picks, true).map((x) => x.title)).toContain('Quality of life')
  })

  it('offers what works with every faction in Everything only, an army pack without a faction tag as an army look, and English texts with a mod in another language', () => {
    const c: Catalog = { ...vcat, mods: [...vcat.mods,
      mod('angel', { tags: ['all factions'] }),
      mod('summon', { tags: ['chinese', 'all factions'] }),
      mod('summon-en', { kind: 'translation', tags: ['english'], relations: [{ kind: 'extends', target: { mod: 'summon' }, source: src }] }),
      mod('summon-ko', { kind: 'translation', tags: ['korean'], relations: [{ kind: 'extends', target: { mod: 'summon' }, source: src }] }),
      // Its tags name no faction; it holds the single pack too, so the two are marked incompatible.
      mod('combined', { kind: 'reskin', tags: ['general'], factionLook: ['empire', 'wood elves'], relations: [{ kind: 'incompatible', target: { mod: 'endo-we' }, source: src }] })
    ] }
    const ix = buildIndex(c)
    const sub = subjectsOf(c, ix)[0]
    const tiers = tiersFor(c, ix, sub)
    expect(tiers.map((t) => [t.id, t.extras])).toEqual([
      ['essentials', []], ['extended', ['mod:events']], ['everything', ['mod:events', 'mod:angel', 'mod:summon', 'mod:summon-en']]
    ])
    const s = suggestedFor(c, ix, c.presets[0])
    expect(s.lewd.find((x) => x.key === 'mod:angel')).toMatchObject({ fits: true, anyFaction: true, reasons: ['Works with every faction'] })
    const army = s.picks.find((g) => /army looks$/.test(g.note))!
    expect([army.note, army.pick.map((x) => x.key)]).toEqual(['They all change how the Wood Elves army looks', ['mod:endo-we', 'mod:combined', 'mod:zeta-we']])
    expect(stepsFor(sub, s.picks, true, true).map((x) => x.title)).toEqual(["Sisters of Twilight's look", "Your army's look", 'Review and install'])
  })

  it('writes down the usual version of an added mod with versions', () => {
    const cb = mod('cb', { packs: [{ file: 'light.pack', from: 'download', exclusiveGroup: 'v' }, { file: 'full.pack', from: 'steam', exclusiveGroup: 'v' }] })
    const c: Catalog = { ...vcat, mods: [...vcat.mods, cb] }
    const tier = { ...tiersFor(vcat, vindex, sisters)[1], extras: ['mod:events', 'mod:cb'] }
    expect(guidedProfile(tier, {}, [], new Set(), 'x', buildIndex(c)).variants).toEqual({ 'mod:cb': { v: 'light.pack' } })
  })
})
