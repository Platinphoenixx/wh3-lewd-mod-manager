import { describe, expect, it } from 'vitest'
import type { Catalog, Mod } from '@catalog/schema'
import { buildIndex } from './match'
import { parseCaModdata, parseTwmods, parseWh3mm, profileFromImport } from './importlist'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return { id, name: id, authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [], relations: [], curation: { lastChecked: '', confidence: 'high' }, ...extra }
}

const catalog = {
  schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], campaignGuides: [], external: [],
  mods: [mod('atb', { sources: { steam: [{ id: '111' }] } }), mod('fw', { packs: [{ file: 'fw.pack', from: 'download' }] }), mod('other')],
  presets: [
    { id: 'a', name: 'A', playAs: [], phase: 'early', origin: 'tested', source: { type: 'discord' }, entries: [
      { pack: 'atb.pack', from: 'steam', steamId: '111', target: { mod: 'atb' } }, { pack: 'fw.pack', from: 'download', target: { mod: 'fw' } }] },
    { id: 'b', name: 'B', playAs: [], phase: 'early', origin: 'tested', source: { type: 'discord' }, entries: [
      { pack: 'other.pack', from: 'download', target: { mod: 'other' } }] }
  ]
} as unknown as Catalog
const index = buildIndex(catalog)

describe('mod list import', () => {
  it('reads CA launcher profiles and the current launcher list', () => {
    expect(parseTwmods('# TW Mod Profile\nmod_lookup_key://ab12@steam_workshop:1142710/111@1700000000/atb.pack\nmod_lookup_key://cd34@game_dir:data/mine.pack\n'))
      .toEqual([{ pack: 'atb.pack', steamId: '111' }, { pack: 'mine.pack' }])
    expect(parseCaModdata(JSON.stringify([
      { packfile: 'E:/S/steamapps/workshop/content/1142710/111/atb.pack', active: true, order: 2, game: 'warhammer3' },
      { packfile: 'D:/game/data/fw.pack', active: true, order: 1, game: 'warhammer3' },
      { packfile: 'D:/game/data/off.pack', active: false, order: 3, game: 'warhammer3' }
    ]))).toEqual([{ pack: 'fw.pack', steamId: undefined }, { pack: 'atb.pack', steamId: '111' }])
  })

  it('reads the WH3 Mod Manager current list and presets, enabled mods only', () => {
    const cfg = { gameToCurrentPreset: { wh3: { mods: [{ name: 'a.pack', workshopId: '5', isEnabled: true }, { name: 'b.pack', isEnabled: false }] } },
      gameToPresets: { wh3: [{ name: 'Mine', mods: [{ name: 'c.pack', path: 'X:\\w\\1142710\\777\\c.pack', isEnabled: true }] }] } }
    const s = parseWh3mm(JSON.stringify(cfg))
    expect(s.map((x) => x.label)).toEqual(['WH3 Mod Manager – current mod list', 'WH3 Mod Manager – preset “Mine”'])
    expect(s[0].mods).toEqual([{ pack: 'a.pack', steamId: '5' }])
    expect(s[1].mods).toEqual([{ pack: 'c.pack', steamId: '777' }])
  })

  it('bases the profile on the closest template and keeps unknown packs as own mods', () => {
    const r = profileFromImport(catalog, index, [{ pack: 'x.pack', steamId: '111' }, { pack: 'fw.pack' }, { pack: 'mine.pack' }])
    expect(r).toEqual({ presetId: 'a', removed: [], extras: ['pack:mine.pack'] })
    // Template mods that are not in the list are switched off.
    expect(profileFromImport(catalog, index, [{ pack: 'atb.pack', steamId: '111' }])).toEqual({ presetId: 'a', removed: ['mod:fw'], extras: [] })
  })
})
