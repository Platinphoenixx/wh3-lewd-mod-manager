import { describe, expect, it } from 'vitest'
import type { Catalog, Mod } from '@catalog/schema'
import type { InstalledPack } from './api'
import { buildIndex, matchInstalled, presetStatus, staleDataPacks } from './match'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id, name: id, authors: [], kind: 'campaign', summary: '', tags: [], sources: {}, packs: [], relations: [],
    curation: { lastChecked: '2026-10-31', confidence: 'high' }, ...extra
  }
}

const catalog: Catalog = {
  schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], campaignGuides: [],
  external: [{ id: 'ext-mct', name: 'MCT', steamId: '2927955021' }],
  mods: [
    mod('ll-42028', {
      sources: { steam: [{ id: '3644437727' }] },
      packs: [{ file: 'Alarielle_Temptation_Bloom.pack', from: 'steam', steamId: '3644437727' }],
      cleanup: { staleDataPacks: ['Alarielle_Temptation_Bloom*.pack'], note: 'moved to Steam' }
    }),
    mod('ll-23876', { packs: [{ file: 'MiaoYingCorrupted_Compendium.pack', from: 'download' }], sources: { steam: [{ id: '3705392682' }] } }),
    mod('steam-3472332568', { kind: 'collection', sources: { steam: [{ id: '3644437727' }] } })
  ],
  presets: [{
    id: 'p', name: 'P', playAs: ['Alarielle'], phase: 'early', origin: 'tested', source: { type: 'discord' },
    entries: [
      { pack: 'groovy_mct.pack', steamId: '2927955021', from: 'steam', target: { external: 'ext-mct' } },
      { pack: 'Alarielle_Temptation_Bloom.pack', steamId: '3644437727', from: 'steam', target: { mod: 'll-42028' } },
      { pack: 'MiaoYingCorrupted_Compendium.pack', from: 'download', target: { mod: 'll-23876' } }
    ]
  }]
}

const pack = (file: string, source: InstalledPack['source'], steamId?: string): InstalledPack =>
  ({ file, source, steamId, path: `${source}/${file}`, size: 1, mtime: 0 })

describe('match', () => {
  const index = buildIndex(catalog)

  it('maps Workshop items to mods and externals, but not to collections', () => {
    expect(index.bySteamId.get('3644437727')).toEqual({ mod: 'll-42028' })
    expect(index.bySteamId.get('2927955021')).toEqual({ external: 'ext-mct' })
  })

  it('groups installed packs by mod and reports unknown ones', () => {
    const { known, unknown } = matchInstalled(index, [
      pack('Alarielle_Temptation_Bloom.pack', 'workshop', '3644437727'),
      pack('something_else.pack', 'workshop', '123')
    ])
    expect([...known.keys()]).toEqual(['mod:ll-42028'])
    expect(unknown.map((p) => p.file)).toEqual(['something_else.pack'])
  })

  it('recognises packs the app installed for a mod even when the catalog has no pack name', () => {
    const { known } = matchInstalled(index, [{ ...pack('(X)_Unnamed.pack', 'data'), modId: 'll-23876' }])
    expect([...known.keys()]).toEqual(['mod:ll-23876'])
  })

  it('counts a Workshop file for every mod that lists it, a download only for the mod it was installed for', () => {
    const shared: Catalog = {
      ...catalog,
      mods: [
        mod('ll-23966', { packs: [{ file: 'zli_katarin_reskins.pack', from: 'steam' }] }),
        mod('steam-3471883808', { sources: { steam: [{ id: '3471883808' }] }, packs: [{ file: 'zli_katarin_reskins.pack', from: 'steam', steamId: '3471883808' }] }),
        mod('steam-3820276885', { packs: [{ file: 'alivia_dryad.pack', from: 'steam', steamId: '3820276885' }] }),
        mod('steam-3404717872', { sources: { steam: [{ id: '3404717872' }] }, packs: [{ file: 'alivia_dryad.pack', from: 'steam', steamId: '3404717872' }] }),
        mod('ll-32374', { packs: [{ file: 'soil_corrupted_units_asset.pack', from: 'download' }] }),
        mod('ll-48415', { packs: [{ file: 'soil_corrupted_units_asset.pack', from: 'download' }] })
      ],
      presets: []
    }
    const workshop: InstalledPack = { file: 'zli_katarin_reskins.pack', source: 'workshop', steamId: '3471883808', path: 'W:/3471883808/zli_katarin_reskins.pack', size: 1, mtime: 0 }
    const old: InstalledPack = { file: 'soil_corrupted_units_asset.pack', source: 'data', path: 'D:/data/soil_corrupted_units_asset.pack', size: 1, mtime: 0, modId: 'll-32374' }
    const oldUpload: InstalledPack = { file: 'alivia_dryad.pack', source: 'workshop', steamId: '3404717872', path: 'W:/3404717872/alivia_dryad.pack', size: 1, mtime: 0 }
    const { known } = matchInstalled(buildIndex(shared), [workshop, old, oldUpload])
    expect([...known.keys()].sort()).toEqual(['mod:ll-23966', 'mod:ll-32374', 'mod:steam-3404717872', 'mod:steam-3471883808'])
  })

  it('marks preset entries installed, missing, or installed in another version', () => {
    const status = presetStatus(index, catalog.presets[0], [
      pack('groovy_mct.pack', 'workshop', '2927955021'),
      pack('MiaoYingCorrupted_Compendium_workshop.pack', 'workshop', '3705392682')
    ])
    expect(status.map((s) => s.state)).toEqual(['installed', 'missing', 'other-version'])
  })

  it('warns about data packs that shadow a Workshop copy', () => {
    const warnings = staleDataPacks(index, [
      pack('Alarielle_Temptation_Bloom.pack', 'workshop', '3644437727'),
      pack('Alarielle_Temptation_Bloom.pack', 'data'),
      pack('Alarielle_Temptation_Bloom_Assets.pack', 'data'),
      pack('unrelated.pack', 'data')
    ])
    expect(warnings.map((w) => w.pack.file)).toEqual(['Alarielle_Temptation_Bloom.pack', 'Alarielle_Temptation_Bloom_Assets.pack'])
  })
})
