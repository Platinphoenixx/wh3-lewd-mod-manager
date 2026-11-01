import { describe, expect, it } from 'vitest'
import type { InstalledPack } from './api'
import { buildModList, pickVariants, planLaunch } from './launch'

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
