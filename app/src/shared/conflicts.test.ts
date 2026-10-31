import { describe, expect, it } from 'vitest'
import { analyzeConflicts, kindOf } from './conflicts'

const pack = (name: string, ...paths: string[]) => ({ name, files: paths.map((path) => ({ path, size: 1 })) })

describe('analyzeConflicts', () => {
  it('reports overridden files with the higher pack as winner', () => {
    const r = analyzeConflicts([
      pack('top.pack', 'variantmeshes/wh3/miao.wsmodel', 'text/db/top.loc'),
      pack('bottom.pack', 'variantmeshes/wh3/miao.wsmodel', 'db/units_tables/bottom')
    ])
    expect(r.overlaps).toEqual([
      { winner: 'top.pack', loser: 'bottom.pack', count: 1, byKind: { model: 1 }, samples: ['variantmeshes/wh3/miao.wsmodel'] }
    ])
  })

  it('ignores RPFM bookkeeping files', () => {
    const r = analyzeConflicts([pack('a.pack', 'dependencies_manager_v2.rpfm_reserved'), pack('b.pack', 'dependencies_manager_v2.rpfm_reserved')])
    expect(r.overlaps).toEqual([])
  })

  it('lists tables both packs add rows to, without calling it an override', () => {
    const r = analyzeConflicts([pack('a.pack', 'db/units_tables/a', 'db/land_units_tables/a'), pack('b.pack', 'db/units_tables/b')])
    expect(r.overlaps).toEqual([])
    expect(r.sharedTables).toEqual([{ a: 'a.pack', b: 'b.pack', tables: ['units_tables'] }])
  })

  it('drops tables most packs use from the hints', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => pack(`${n}.pack`, `db/effects_tables/${n}`))
    many[0].files.push({ path: 'db/units_tables/a', size: 1 })
    many[1].files.push({ path: 'db/units_tables/b', size: 1 })
    expect(analyzeConflicts(many).sharedTables).toEqual([{ a: 'a.pack', b: 'b.pack', tables: ['units_tables'] }])
  })

  it('attributes a file shared by three packs to the topmost one', () => {
    const r = analyzeConflicts([pack('1', 'ui/x.png'), pack('2', 'ui/x.png'), pack('3', 'ui/x.png')])
    expect(r.overlaps.map((o) => `${o.winner}>${o.loser}`)).toEqual(['1>2', '1>3'])
  })
})

describe('kindOf', () => {
  it('classifies paths', () => {
    expect(['db/x/y', 'text/db/a.loc', 'script/a.lua', 'ui/a.png', 'audio/a.wem', 'a/b.dds', 'variantmeshes/a', 'x.txt'].map(kindOf))
      .toEqual(['db', 'text', 'script', 'ui', 'audio', 'texture', 'model', 'other'])
  })
})
