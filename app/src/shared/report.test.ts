import { describe, expect, it } from 'vitest'
import { anonymize, buildReport, countErrors, errorSignature, groupFailures, movedEntries, type LaunchEntry, type LaunchSnapshot, type ReportInput } from './report'

const entry = (key: string, extra: Partial<LaunchEntry> = {}): LaunchEntry => ({ key, name: key, origin: 'base', paths: [], ...extra })

describe('problem reports', () => {
  it('finds template entries the player moved', () => {
    const e = [entry('a', { templateIndex: 0 }), entry('c', { templateIndex: 2 }), entry('x', { origin: 'extra' }), entry('b', { templateIndex: 1 }), entry('d', { templateIndex: 3 })]
    expect([...movedEntries(e)]).toEqual(['c'])
    expect(movedEntries([entry('a', { templateIndex: 0 }), entry('b', { templateIndex: 1 })]).size).toBe(0)
    expect(movedEntries([]).size).toBe(0)
  })

  it('removes user names and local folders', () => {
    const ctx = { home: 'C:\\Users\\Jane', gamePath: 'D:\\Steam\\steamapps\\common\\Total War WARHAMMER III', workshopPaths: ['D:\\Steam\\steamapps\\workshop\\content\\1142710'] }
    expect(anonymize('C:\\Users\\Jane\\AppData\\x.lua and C:/Users/Jane/y', ctx)).toBe('<user folder>\\AppData\\x.lua and <user folder>/y')
    expect(anonymize('D:\\Steam\\steamapps\\common\\Total War WARHAMMER III\\data\\a.pack', ctx)).toBe('<game>\\data\\a.pack')
    expect(anonymize('D:\\Steam\\steamapps\\workshop\\content\\1142710\\123\\a.pack', ctx)).toBe('<workshop>\\123\\a.pack')
    expect(anonymize('E:\\Users\\Bob\\file', {})).toBe('E:\\Users\\<user>\\file')
  })

  it('groups failures per mod', () => {
    const g = groupFailures([
      { line: 'a1', packs: ['p/a.pack'] }, { line: 'b', packs: [] }, { line: 'a1', packs: ['p/a.pack'] }, { line: 'a2', packs: ['p/a.pack'] }, { line: 'b', packs: [] }
    ])
    expect(g).toEqual([
      { index: 0, packs: ['p/a.pack'], lines: [{ line: 'a1', count: 2 }, { line: 'a2', count: 1 }] },
      { index: 1, packs: [], lines: [{ line: 'b', count: 2 }] }
    ])
  })

  it('gives the same error on two PCs the same signature', () => {
    const a = errorSignature('mod:ll-1', 'C:\\Users\\Jane\\x.lua:12: attempt  to index nil (0x1F2)')
    const b = errorSignature('mod:ll-1', 'D:\\Games\\x.lua:12: attempt to index nil (0xAB)')
    expect(a).toBe(b)
    expect(a).toContain('<path> attempt to index nil')
    expect(errorSignature('mod:ll-2', 'x')).not.toBe(errorSignature('mod:ll-1', 'x'))
  })

  it('counts identical error lines', () => {
    expect(countErrors(['x', 'y', 'x'])).toEqual([{ line: 'x', count: 2 }, { line: 'y', count: 1 }])
  })

  const snapshot: LaunchSnapshot = {
    at: Date.parse('2026-11-01T20:00:00Z'),
    profile: { id: 'p', name: 'My run' },
    template: { id: 't', name: 'Alarielle – early game', author: 'Readman' },
    game: { version: '9.0.4', build: '25961564', lastMajor: { date: Date.parse('2026-09-24'), title: 'Lords of the End Times' } },
    entries: [
      entry('mod:a', { name: 'A', templateIndex: 0 }),
      entry('mod:x', { name: 'X', origin: 'extra', source: 'LoversLab 1' }),
      entry('mod:b', { name: 'B', templateIndex: 1, stale: true, updated: Date.parse('2026-09-20') }),
      entry('pack:own.pack', { name: 'own.pack', origin: 'own', source: 'data folder' })
    ],
    removed: ['R']
  }
  const input: ReportInput = {
    modName: 'B', errors: [{ line: 'b.lua:1: boom', count: 3 }], packs: ['b.pack'], snapshot, appVersion: '0.1.0', catalogDate: '2026-11-01',
    where: 'new campaign, turn 40', overlaps: [{ winner: 'own.pack', loser: 'b.pack', count: 1, sample: 'db/x' }],
    options: { versions: true, differences: true, stale: true, overlaps: true, fullOrder: true }
  }

  it('writes every section the player keeps', () => {
    const md = buildReport(input)
    expect(md).toContain('WARHAMMER III 9.0.4 (Steam build 25961564)')
    expect(md).toContain('b.lua:1: boom   (3×)')
    expect(md).toContain('+ added    X (LoversLab 1)')
    expect(md).toContain('- removed  R')
    expect(md).toContain('+ own mod  own.pack (data folder)')
    expect(md).toContain('- B – updated 2026-09-20')
    expect(md).toContain('own.pack overrides b.pack in 1 file (e.g. db/x)')
    expect(md).toContain('Where: new campaign, turn 40')
    expect(md).toContain('4. own.pack (data folder)')
  })

  it('leaves out what is switched off and keeps the short version short', () => {
    const md = buildReport({ ...input, options: { versions: false, differences: false, stale: false, overlaps: false, fullOrder: true } }, true)
    expect(md).not.toContain('9.0.4')
    expect(md).not.toContain('Differences')
    expect(md).not.toContain('Full load order')
    expect(buildReport({ ...input, snapshot: null })).toContain('Load order: unknown')
  })
})
