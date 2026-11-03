import { describe, expect, it } from 'vitest'
import type { Catalog, Mod } from '@catalog/schema'
import { buildIndex } from './match'
import { dateOfFile, findLocal, type LocalFile } from './localfiles'

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id, name: id, authors: [], kind: 'units', summary: '', tags: [], sources: {}, packs: [], relations: [],
    curation: { lastChecked: '2026-11-03', confidence: 'high' }, ...extra
  }
}
const catalog: Catalog = {
  schemaVersion: 1, generatedAt: '', sources: [], tiers: [], notes: [], campaignGuides: [], external: [], presets: [],
  mods: [mod('nx-28', { updated: '2026-10-01' }), mod('nx-77', { updated: '2026-10-02' }), mod('dc-bst')]
}
const index = buildIndex(catalog)
const file = (name: string, date: string, extra: Partial<LocalFile> = {}): LocalFile => ({ name, size: 1, date, path: `D:/dl/${name}`, ...extra })

describe('local files', () => {
  it('reads the date a download carries in its name', () => {
    expect(dateOfFile('Black Iron Legion-77-11-9-1754770147.7z', '2026-11-03')).toBe('2025-08-09')
    expect(dateOfFile('2495_Warmaidens Resource Pack 22 13.21 2026-10-30T12-09Z amGzCmdas', '2026-11-03')).toBe('2026-10-30')
    expect(dateOfFile('1451994011584692335_dd_bst.pack', '2026-11-03')).toBe('2025-12-20')
    expect(dateOfFile('mymod.pack', '2026-11-03T10:00:00Z')).toBe('2026-11-03')
  })

  it('takes a pack of the same name from the mod’s own download, and tells an old copy only for one-file mods', () => {
    const cat: Catalog = { ...catalog, mods: [
      mod('nx-41', { updated: '2025-12-24', packs: [{ file: '@Slaanesh Legion.pack', from: 'download' }, { file: '@Succubus.pack', from: 'download' }] })] }
    const files = [
      file('@Slaanesh Legion.pack', '2026-09-24', { path: 'D:/nexus/45/Chaos_warmaidens 45 12.74/@Slaanesh Legion.pack' }),
      file('@Slaanesh Legion.pack', '2025-12-01', { path: String.raw`D:\nexus\41\Warmaidens of Dark Princess\@Slaanesh Legion.pack` })
    ]
    const [m] = findLocal(buildIndex(cat), files, [{ key: 'mod:nx-41', modId: 'nx-41', name: 'Succubus Legion', packs: ['@Slaanesh Legion.pack'] }])
    expect(m.file.path).toContain('41')
    expect(m.newer).toBeUndefined()
  })

  it('takes the first version found of a mod made of versions to pick from', () => {
    const m = findLocal(index, [file('b.pack', '2026-01-01'), file('c.pack', '2026-01-01')], [{ key: 'mod:dc-bst', modId: 'dc-bst', name: 'x', packs: ['a.pack', 'b.pack', 'c.pack'], anyOf: true }])
    expect(m.map((x) => x.pack)).toEqual(['b.pack'])
  })

  it('finds a missing pack by name, also without the "!" Discord drops, and says when the copy is older', () => {
    const files = [
      file('@Ancient Warmaidens.pack', '2026-10-01', { path: 'D:/a/Ancient.7z', inArchive: true }),
      file('@Ancient Warmaidens.pack', '2026-10-01'),
      file('@Chaosdawi Maidens.pack', '2025-08-09'),
      file('1451994011584692335_dd_bst.pack', '2025-12-20')
    ]
    const m = findLocal(index, files, [
      { key: 'mod:nx-28', modId: 'nx-28', name: 'Tomb Kings', packs: ['@Ancient Warmaidens.pack'] },
      { key: 'mod:nx-77', modId: 'nx-77', name: 'Iron Legion', packs: ['@Chaosdawi Maidens.pack'] },
      { key: 'mod:dc-bst', modId: 'dc-bst', name: 'dd_bst', packs: ['!dd_bst.pack', 'missing.pack'] }
    ])
    expect(m.map((x) => [x.pack, x.file.path, x.newer])).toEqual([
      ['@Ancient Warmaidens.pack', 'D:/dl/@Ancient Warmaidens.pack', undefined],
      ['@Chaosdawi Maidens.pack', 'D:/dl/@Chaosdawi Maidens.pack', '2026-10-02'],
      ['!dd_bst.pack', 'D:/dl/1451994011584692335_dd_bst.pack', undefined]
    ])
  })
})
