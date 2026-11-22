import { describe, expect, it } from 'vitest'
import { moveProfile, sortProfiles, usedLabel } from './profileSort'

const p = (id: string, name: string, updatedAt: string, createdAt = updatedAt) => ({ id, name, updatedAt, createdAt })
const list = [p('a', 'Azazel', '2026-11-01'), p('b', 'beastmen Test', '2026-11-10'), p('c', 'Alarielle', '2026-11-05')]

describe('sortProfiles', () => {
  it('puts the profile opened last on top, else the last changed', () => {
    expect(sortProfiles(list, 'used', {}, []).map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(sortProfiles(list, 'used', { a: '2026-11-20T10:00:00Z' }, []).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('sorts by name without minding case', () => {
    expect(sortProfiles(list, 'name', {}, []).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
  it('keeps the dragged order, new profiles first', () => {
    const withNew = [...list, p('d', 'New', '2026-11-21')]
    expect(sortProfiles(withNew, 'own', {}, ['c', 'a', 'b']).map((x) => x.id)).toEqual(['d', 'c', 'a', 'b'])
  })
})

describe('moveProfile', () => {
  it('drops below when dragged down and above when dragged up', () => {
    expect(moveProfile(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveProfile(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveProfile(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
  })
})

describe('usedLabel', () => {
  const now = new Date('2026-11-22T12:00:00')
  it('says how long ago', () => {
    expect(usedLabel('2026-11-22T08:00:00', now)).toBe('used today')
    expect(usedLabel('2026-11-21T23:00:00', now)).toBe('used yesterday')
    expect(usedLabel('2026-11-19T10:00:00', now)).toBe('used 3 days ago')
    expect(usedLabel('2026-11-01T10:00:00', now)).toBe('used 3 weeks ago')
    expect(usedLabel(undefined, now)).toBe('')
  })
})
