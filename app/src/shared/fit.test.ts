import { describe, expect, it } from 'vitest'
import type { Catalog, Mod } from '@catalog/schema'
import { buildIndex } from './match'
import { fitInProfile, missingNeeds, withMod } from './fit'
import type { Profile } from './profile'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id, name: id, authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [], relations: [],
    curation: { lastChecked: '2026-11-19', confidence: 'high' }, ...extra
  }
}
const src = { type: 'loverslab' as const }

const catalog: Catalog = {
  schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], campaignGuides: [], external: [],
  mods: [
    mod('atb', { kind: 'campaign', playAs: [{ character: 'Alarielle' }] }),
    mod('katarin-campaign', { kind: 'progression', playAs: [{ character: 'Katarin' }] }),
    mod('lyra', { relations: [{ kind: 'requires', target: { mod: 'lyra-assets' }, source: src }] }),
    mod('lyra-assets', { kind: 'assets' }),
    mod('clash', { relations: [{ kind: 'incompatible', target: { mod: 'atb' }, source: src }] }),
    mod('broken', { stopsGame: 'stops the game at launch' }),
    mod('old', { status: 'superseded' }),
    mod('new', { relations: [{ kind: 'supersedes', target: { mod: 'old' }, source: src }] }),
    mod('wood-elf-thing', {}),
    mod('skin', { kind: 'reskin' })
  ],
  presets: [{
    id: 'alarielle', name: 'Alarielle', playAs: ['Alarielle'], phase: 'early', origin: 'tested', source: { type: 'discord' },
    avoid: [{ target: { mod: 'wood-elf-thing' }, note: 'runs against the setup' }],
    entries: [{ pack: 'atb.pack', from: 'steam', steamId: '1', target: { mod: 'atb' } }]
  }]
}
const index = buildIndex(catalog)
const preset = catalog.presets[0]
const profile = (extra: Partial<Profile> = {}): Profile =>
  ({ id: 'p', name: 'P', presetId: 'alarielle', extras: [], removed: [], createdAt: '', updatedAt: '', ...extra })

describe('fit of a catalog mod in a profile', () => {
  it('says what is already in it, and what is in it but switched off', () => {
    expect(fitInProfile(catalog, index, preset, profile(), 'mod:atb')).toMatchObject({ state: 'in', canAdd: false })
    expect(fitInProfile(catalog, index, preset, profile({ removed: ['mod:atb'] }), 'mod:atb')).toMatchObject({ state: 'off', canAdd: true })
  })

  it('names what comes along', () => {
    const f = fitInProfile(catalog, index, preset, profile(), 'mod:lyra')
    expect(f).toMatchObject({ state: 'fits', canAdd: true, adds: ['lyra-assets'] })
    expect(f.text).toBe('fits · + 1 it needs comes along')
    expect(fitInProfile(catalog, index, preset, profile(), 'mod:skin').text).toBe('fits')
  })

  it('says why not: conflict, another character’s campaign, does not start, outdated', () => {
    expect(fitInProfile(catalog, index, preset, profile(), 'mod:clash')).toMatchObject({ state: 'conflict', canAdd: false, text: 'conflicts with atb' })
    expect(fitInProfile(catalog, index, preset, profile(), 'mod:katarin-campaign')).toMatchObject({ state: 'other-story', canAdd: false })
    expect(fitInProfile(catalog, index, preset, profile(), 'mod:broken')).toMatchObject({ state: 'stops', canAdd: false })
    expect(fitInProfile(catalog, index, preset, profile(), 'mod:old')).toMatchObject({ state: 'outdated', text: 'outdated – new replaces it' })
  })

  it('lets the player add what the setup avoids, saying so', () => {
    expect(fitInProfile(catalog, index, preset, profile(), 'mod:wood-elf-thing'))
      .toMatchObject({ state: 'avoided', canAdd: true, text: 'the setup avoids it: runs against the setup' })
  })

  it('adds a mod, or switches it back on', () => {
    expect(withMod(profile(), 'mod:lyra').extras).toEqual(['mod:lyra'])
    const p = withMod(profile({ removed: ['mod:atb'], extras: ['mod:skin'], off: ['mod:skin'] }), 'mod:skin')
    expect(p.extras).toEqual(['mod:skin'])
    expect(p.off).toEqual([])
  })
})

describe('what a mod still needs', () => {
  it('follows strict requirements that are not installed', () => {
    expect(missingNeeds(index, index.mods.get('lyra')!, () => false).map((m) => m.id)).toEqual(['lyra-assets'])
    expect(missingNeeds(index, index.mods.get('lyra')!, (k) => k === 'mod:lyra-assets')).toEqual([])
  })
})
