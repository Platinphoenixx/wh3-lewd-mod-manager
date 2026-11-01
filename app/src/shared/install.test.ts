import { describe, expect, it } from 'vitest'
import type { Catalog, Mod } from '@catalog/schema'
import { buildIndex } from './match'
import { archivesFor, downloadHints, installSourceFor, packHints, pickDownloads, wantedPacks } from './install'

function mod(id: string, sources: Mod['sources']): Mod {
  return { id, name: id, authors: [], kind: 'units', summary: '', tags: [], sources, packs: [], relations: [], curation: { lastChecked: '', confidence: 'high' } }
}

const catalog = {
  schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], presets: [], campaignGuides: [],
  external: [{ id: 'ext-mct', name: 'MCT', steamId: '2927955021' }],
  mods: [
    mod('both', { steam: [{ id: '111' }], loverslab: { fileId: '1', url: 'https://www.loverslab.com/files/file/1-x/', category: 'mods' } }),
    mod('ll', { loverslab: { fileId: '2', url: 'https://www.loverslab.com/files/file/2-x/', category: 'mods' } }),
    mod('dc', { discord: [{ channel: 'x', messageUrl: 'https://discord.com/channels/1/2/3' }] }),
    mod('nx', { nexus: { modId: '22', url: 'https://www.nexusmods.com/totalwarwarhammer3/mods/22' }, discord: [{ channel: 'x', messageUrl: 'https://discord.com/channels/1/2/4' }] }),
    mod('nothing', {}),
    mod('gone', { steam: [{ id: '333', removed: true }], loverslab: { fileId: '3', url: 'https://www.loverslab.com/files/file/3-x/', category: 'mods' } })
  ]
} as unknown as Catalog
const index = buildIndex(catalog)

describe('installSourceFor', () => {
  it('prefers Steam, then LoversLab, then Nexus, then Discord', () => {
    expect(installSourceFor(catalog, index, { key: 'mod:nx' })).toEqual({ kind: 'nexus', url: 'https://www.nexusmods.com/totalwarwarhammer3/mods/22?tab=files' })
    expect(installSourceFor(catalog, index, { key: 'mod:both' })).toEqual({ kind: 'steam', id: '111' })
    expect(installSourceFor(catalog, index, { key: 'mod:ll' })).toEqual({ kind: 'loverslab', url: 'https://www.loverslab.com/files/file/2-x/' })
    expect(installSourceFor(catalog, index, { key: 'mod:dc' })).toEqual({ kind: 'discord', url: 'https://discord.com/channels/1/2/3' })
    expect(installSourceFor(catalog, index, { key: 'mod:nothing' })).toEqual({ kind: 'manual', url: undefined })
  })

  it('skips Workshop items that were removed from Steam', () => {
    expect(installSourceFor(catalog, index, { key: 'mod:gone' })).toEqual({ kind: 'loverslab', url: 'https://www.loverslab.com/files/file/3-x/' })
  })

  it('uses the Workshop id a template gives and resolves externals', () => {
    expect(installSourceFor(catalog, index, { key: 'mod:ll', steamId: '999', from: 'steam' })).toEqual({ kind: 'steam', id: '999' })
    expect(installSourceFor(catalog, index, { key: 'external:ext-mct' })).toEqual({ kind: 'steam', id: '2927955021' })
  })

  it('keeps a template entry that is a download as a download', () => {
    expect(installSourceFor(catalog, index, { key: 'mod:ll', steamId: '999', from: 'download' })).toEqual({ kind: 'loverslab', url: 'https://www.loverslab.com/files/file/2-x/' })
  })
})

describe('LoversLab file choice', () => {
  const cards = {
    ...mod('cards', {}),
    packs: [
      { file: '@female_unit_cards.pack', from: 'download' as const, archive: '@female_unit_cards_1_5' },
      { file: '@female_unit_cards_nsfw.pack', from: 'download' as const, archive: '@female_unit_cards_nsfw_1_5' },
      { file: 'shared.pack', from: 'download' as const }
    ]
  }
  const rows = [
    { name: '@female_unit_cards_1_5.7z', href: 'a' },
    { name: '@female_unit_cards_nsfw_1_5.7z', href: 'b' }
  ]

  it('finds the download of the packs a template wants', () => {
    expect(archivesFor(cards, ['@Female_Unit_Cards_NSFW.pack'])).toEqual(['@female_unit_cards_nsfw_1_5'])
    expect(pickDownloads(rows, archivesFor(cards, ['@female_unit_cards_nsfw.pack']))).toEqual([rows[1]])
  })

  it('leaves the choice to the player when it is not clear', () => {
    expect(archivesFor(cards)).toBeUndefined() // no template pack: variants are the player's choice
    expect(archivesFor(cards, ['shared.pack'])).toBeUndefined() // pack without a known download
    expect(pickDownloads(rows, undefined)).toBeNull()
    expect(pickDownloads(rows, ['other'])).toBeNull()
    expect(pickDownloads([rows[0]], undefined)).toEqual([rows[0]]) // a single file needs no choice
  })

  const vassals = {
    ...mod('vassals', {
      downloads: [
        { name: '@n_SlaaneshVassals.pack', url: 'https://www.loverslab.com/files/file/1-x/?do=download', description: 'Version for Slaanesh factions' },
        { name: '@n_SlaaneshVassals_Non_Slaanesh_Factions.pack', url: 'https://www.loverslab.com/files/file/1-x/?do=download', description: 'Version for all other factions' }
      ]
    }),
    packs: [
      { file: '@n_SlaaneshVassals.pack', from: 'download' as const, optional: true },
      { file: '@n_SlaaneshVassals_Non_Slaanesh_Factions.pack', from: 'download' as const, optional: true }
    ]
  }

  it('treats a pack offered directly on the page as its own download', () => {
    expect(archivesFor(vassals, ['@n_SlaaneshVassals_Non_Slaanesh_Factions.pack'])).toEqual(['@n_slaaneshvassals_non_slaanesh_factions'])
  })

  it('tells the download window which file the profile uses and what the others are', () => {
    expect(downloadHints(vassals, ['@n_SlaaneshVassals_Non_Slaanesh_Factions.pack'])).toEqual([
      { name: '@n_SlaaneshVassals.pack', note: 'Version for Slaanesh factions', wanted: false },
      { name: '@n_SlaaneshVassals_Non_Slaanesh_Factions.pack', note: 'Version for all other factions', wanted: true }
    ])
    expect(downloadHints(vassals).every((h) => !h.wanted)).toBe(true)
  })

  it("picks the version for the profile's character when the template names no file", () => {
    const seduce = {
      ...mod('seduce', {}),
      packs: [
        { file: 'tdw_cth_seduce.pack', from: 'download' as const, note: "Miao Ying version; needs Lazy's Miao progression" },
        { file: 'tdw_kat_seduce.pack', from: 'download' as const, note: "Katarin version; needs Lazy's Corrupted Katarin" },
        { file: 'tdw_mor_seduce.pack', from: 'download' as const, note: 'Morathi version; needs Morathi Ascension' }
      ]
    }
    expect(wantedPacks(seduce, undefined, ['Miao'])).toEqual(['tdw_cth_seduce.pack'])
    expect(wantedPacks(seduce, 'Corrupted Chars can Seduce', ['Katarin'])).toEqual(['tdw_kat_seduce.pack'])
    expect(wantedPacks(seduce, 'tdw_mor_seduce.pack', ['Miao'])).toEqual(['tdw_mor_seduce.pack']) // the template wins
    expect(wantedPacks(seduce, undefined, ['Alarielle'])).toBeUndefined()
    expect(wantedPacks(seduce, undefined, [])).toBeUndefined()
  })

  it('names the packs a Nexus mod needs: template packs, else the base and the usual variant', () => {
    const parts = {
      ...mod('parts', {}),
      packs: [
        { file: 'base.pack', from: 'download' as const },
        { file: 'skin_a.pack', from: 'download' as const, exclusiveGroup: 'skin' },
        { file: 'skin_b.pack', from: 'download' as const, exclusiveGroup: 'skin' },
        { file: 'armour.pack', from: 'download' as const, optional: true, exclusiveGroup: 'armour' },
        { file: 'sword.pack', from: 'download' as const, optional: true }
      ]
    }
    expect(packHints(parts).filter((h) => h.wanted).map((h) => h.name)).toEqual(['base.pack', 'skin_a.pack'])
    expect(packHints(parts, ['Skin_B.pack']).filter((h) => h.wanted).map((h) => h.name)).toEqual(['skin_b.pack'])
  })
})
