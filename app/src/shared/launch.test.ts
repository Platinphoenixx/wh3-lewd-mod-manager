import { describe, expect, it } from 'vitest'
import type { InstalledPack } from './api'
import type { Mod } from '@catalog/schema'
import { buildModList, pickVariants, planLaunch, variantLabels } from './launch'

const ws = (file: string, id: string): InstalledPack => ({ file, source: 'workshop', steamId: id, path: `E:\\Steam\\workshop\\content\\1142710\\${id}\\${file}`, size: 1, mtime: 0 })
const data = (file: string): InstalledPack => ({ file, source: 'data', path: `E:\\Game\\data\\${file}`, size: 1, mtime: 0 })

describe('buildModList', () => {
  it('lists workshop folders, then packs in priority order', () => {
    expect(buildModList([ws('!!framework.pack', '1'), data('local.pack'), ws('reskin.pack', '2')])).toBe(
      [
        'add_working_directory "E:/Steam/workshop/content/1142710/1";',
        'add_working_directory "E:/Steam/workshop/content/1142710/2";',
        'mod "!!framework.pack";',
        'mod "local.pack";',
        'mod "reskin.pack";',
        ''
      ].join('\n')
    )
  })

  it('keeps only the first of two packs with the same name', () => {
    expect(buildModList([data('a.pack'), ws('A.pack', '9')])).toContain('mod "a.pack";\n')
    expect(buildModList([data('a.pack'), ws('A.pack', '9')])).not.toContain('mod "A.pack"')
  })
})

describe('planLaunch', () => {
  it('collects installed packs in entry order and reports missing entries', () => {
    const installed: Record<string, InstalledPack[]> = { 'mod:a': [ws('a.pack', '1')], 'mod:c': [data('c.pack')] }
    const plan = planLaunch(
      [{ key: 'mod:a', name: 'A' }, { key: 'mod:b', name: 'B' }, { key: 'mod:c', name: 'C' }],
      (k) => installed[k] ?? []
    )
    expect(plan.packs.map((p) => p.file)).toEqual(['a.pack', 'c.pack'])
    expect(plan.missing).toEqual(['B'])
  })

  it('loads every pack a template names for one mod', () => {
    const azr = [data('@@Compendium_Play_as_Azazel_Overwrite.pack'), ws("kerb_Azazel's_Realm_steam.pack", '3643871692'), data('azr_other_variant.pack')]
    const plan = planLaunch([{ key: 'mod:azr', name: 'AZR', pack: '@@Compendium_Play_as_Azazel_Overwrite.pack', packs: ['@@Compendium_Play_as_Azazel_Overwrite.pack', "kerb_Azazel's_Realm_steam.pack"] }], () => azr)
    expect(plan.packs.map((p) => p.file)).toEqual(['@@Compendium_Play_as_Azazel_Overwrite.pack', "kerb_Azazel's_Realm_steam.pack"])
  })

  it('uses only the pack a template names when a mod has several installed (variants)', () => {
    const variants = [data('@@ A Loi variant.pack'), data('@@ B Loi variant.pack')]
    const plan = planLaunch([{ key: 'mod:loi', name: 'Loi', pack: '@@ B Loi variant.pack' }], () => variants)
    expect(plan.packs.map((p) => p.file)).toEqual(['@@ B Loi variant.pack'])
  })
})

describe('pickVariants', () => {
  const groups = new Map([['futa', ['@Legion.pack', '@Legion (no futa).pack']]])
  const both = [data('@Legion (no futa).pack'), data('@Legion.pack'), data('@reskin1.pack')]

  it('loads one pack per pick-one group, the first in catalog order by default', () => {
    expect(pickVariants(both, groups).map((p) => p.file)).toEqual(['@Legion.pack', '@reskin1.pack'])
  })

  it("keeps the player's choice when it is installed", () => {
    expect(pickVariants(both, groups, { futa: '@legion (no futa).pack' }).map((p) => p.file)).toEqual(['@Legion (no futa).pack', '@reskin1.pack'])
    expect(pickVariants([data('@Legion.pack')], groups, { futa: '@Legion (no futa).pack' }).map((p) => p.file)).toEqual(['@Legion.pack'])
  })

  it('is used by planLaunch for mods without an exact template pack', () => {
    const plan = planLaunch([{ key: 'mod:x', name: 'X', groups, chosen: { futa: '@Legion (no futa).pack' } }], () => both)
    expect(plan.packs.map((p) => p.file)).toEqual(['@Legion (no futa).pack', '@reskin1.pack'])
  })
})

describe('variantLabels', () => {
  const mod = (packs: { file: string; note?: string }[]) => ({ packs }) as unknown as Mod
  const hair = ['2_Morathi_hair_white.pack', '2_Morathi_hair_red.pack', '2_Morathi_hair_blood.pack']

  it('tells versions apart by their file names when they share one note, and names the part', () => {
    const { caption, label } = variantLabels(mod(hair.map((file) => ({ file, note: 'Hair' }))), hair)
    expect(caption).toBe('Hair')
    expect(hair.map(label)).toEqual(['White', 'Red', 'Blood'])
  })

  it('keeps what differs inside a name', () => {
    const skins = ['1_Morathi_fresh_skin.pack', '1_Morathi_fresh_skin_wet.pack', '1_Morathi_amber_skin.pack']
    expect(skins.map(variantLabels(mod(skins.map((file) => ({ file, note: 'Skin' }))), skins).label)).toEqual(['Fresh skin', 'Fresh skin wet', 'Amber skin'])
  })

  it('takes notes that already name each version', () => {
    const files = ['a.pack', 'b.pack']
    const v = variantLabels(mod([{ file: 'a.pack', note: 'Katarin version' }, { file: 'b.pack', note: 'Miao version' }]), files)
    expect(v.caption).toBe('Version')
    expect(files.map(v.label)).toEqual(['Katarin version', 'Miao version'])
  })

  it('works without notes and falls back to the file name when nothing tells them apart', () => {
    expect(['x_one.pack', 'x_two.pack'].map(variantLabels(undefined, ['x_one.pack', 'x_two.pack']).label)).toEqual(['One', 'Two'])
    expect(variantLabels(undefined, ['a.pack', 'A.pack']).label('a.pack')).toBe('a.pack')
  })
})
