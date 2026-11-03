import { describe, expect, it } from 'vitest'
import type { Catalog, Mod, Preset } from '@catalog/schema'
import { buildIndex } from './match'
import { playWith, playWithLine, searchMods, subjectFacts } from './playwith'
import { subjectsOf } from './setups'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id, name: id, authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [{ file: `${id}.pack`, from: 'steam' }], relations: [],
    curation: { lastChecked: '2026-11-03', confidence: 'high' }, ...extra
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
    mod('landmarks', { name: 'Corrupted Landmarks', kind: 'submod', sources: { steam: [{ id: '3474483873', subscribers: 9000 }] } }),
    mod('miao-progression', { name: 'Miao progression', kind: 'progression', playAs: [{ character: 'Miao Ying' }] }),
    mod('sig-story', { name: 'Sigvald story', kind: 'campaign', playAs: [{ character: 'Sigvald' }] }),
    mod('sig-skin', { name: 'Female Sigvald', kind: 'reskin', playAs: [{ character: 'Sigvald' }], sources: { loverslab: { fileId: '26542', url: 'x', category: 'mods' } } }),
    mod('alchemy', { name: 'Miao Alchemy', kind: 'campaign', playAs: [{ character: 'Miao Ying' }], stopsGame: 'database error' }),
    mod('old-ui', { name: 'Old UI', kind: 'utility', status: 'superseded' }),
    mod('alchemy-fix', { name: 'Alchemy patch', kind: 'submod', relations: [{ kind: 'requires', target: { mod: 'alchemy' }, source: src }] }),
    mod('new-ui', { name: 'New UI', kind: 'utility', relations: [{ kind: 'supersedes', target: { mod: 'old-ui' }, source: src }] }),
    mod('sfo', { name: 'SFO', kind: 'utility', tags: ['general'] }),
    mod('anti-sfo', { name: 'Anti SFO', relations: [{ kind: 'incompatible', target: { mod: 'sfo' }, source: src }] })
  ],
  presets: [
    list('miao-early', ['Miao Ying'], ['miao-progression', 'landmarks']),
    list('sig-early', ['Sigvald'], ['sig-story', 'landmarks', 'sfo'])
  ]
}
const index = buildIndex(catalog)
const facts = subjectFacts(catalog, index, subjectsOf(catalog, index))
const get = (id: string) => playWith(catalog, index, facts, index.mods.get(id)!)

describe('playWith', () => {
  it('lists every setup that has the mod, smallest size first', () => {
    const p = get('landmarks')
    expect(p.options.map((o) => [o.subject.name, o.how, o.from])).toEqual([['Miao Ying', 'in', 'full'], ['Sigvald', 'in', 'full']])
    expect(playWithLine(p)).toEqual({ text: 'In 2 setups', tone: 'ok' })
  })

  it('puts the setup of the mod\'s own character first', () => {
    const p = get('sig-skin')
    expect(p.characters).toEqual(['Sigvald'])
    // Her look is among the add-ons of the larger sizes.
    expect(p.options[0]).toMatchObject({ how: 'in', from: 'extended', own: true })
    expect(p.options[0].subject.name).toBe('Sigvald')
  })

  it('names what keeps a setup from taking it', () => {
    const p = get('anti-sfo')
    expect(p.options.at(-1)).toMatchObject({ how: 'add', conflicts: ['SFO'] })
    expect(p.options.at(-1)!.subject.name).toBe('Sigvald')
  })

  it('offers a mod the game does not start with only as its character\'s setups without it', () => {
    const p = get('alchemy')
    expect(p.blocked).toBe('stops-game')
    expect(p.options.map((o) => o.subject.name)).toEqual(['Miao Ying'])
    expect(playWithLine(p).tone).toBe('warn')
  })

  it('blocks a mod that needs one the game does not start with', () => {
    const p = get('alchemy-fix')
    expect(p.blocked).toBe('stops-game')
    expect(p.blockedBy?.id).toBe('alchemy')
    expect(playWithLine(p).text).toBe('Needs Miao Alchemy, which the game does not start with')
  })

  it('points from an outdated mod to the one that replaces it', () => {
    const p = get('old-ui')
    expect(p.blocked).toBe('outdated')
    expect(p.successor?.id).toBe('new-ui')
  })
})

describe('searchMods', () => {
  it('finds mods by words and by their Steam or LoversLab link', () => {
    expect(searchMods(catalog, 'landm').map((m) => m.id)).toEqual(['landmarks'])
    expect(searchMods(catalog, 'sig fem').map((m) => m.id)).toEqual(['sig-skin'])
    expect(searchMods(catalog, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3474483873').map((m) => m.id)).toEqual(['landmarks'])
    expect(searchMods(catalog, 'https://www.loverslab.com/files/file/26542-female-sigvald/').map((m) => m.id)).toEqual(['sig-skin'])
  })

  it('lists outdated mods after current ones', () => {
    expect(searchMods(catalog, 'ui').map((m) => m.id)).toEqual(['new-ui', 'old-ui'])
  })
})
