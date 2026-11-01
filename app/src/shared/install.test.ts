import { describe, expect, it } from 'vitest'
import type { Catalog, Mod } from '@catalog/schema'
import { buildIndex } from './match'
import { archivesFor, installSourceFor, pickDownloads } from './install'

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
    mod('nothing', {})
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
})
