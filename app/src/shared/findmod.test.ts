import { describe, expect, it } from 'vitest'
import { findMods, matchedPack, matchScore, workshopIdOf } from './findmod'

const items = [
  { key: 'mod:a', name: "[9.0] Grandolph's Simple Dynamic Settlements Reborn", packs: ['grandolph_sds.pack'] },
  { key: 'mod:b', name: '[Endo] Sisters of Twilight', text: ['Reskin of the Sisters of Twilight'] },
  { key: 'mod:c', name: '[Endo] Dark Elves - Loreful', text: ['Also dresses the Sisters of Twilight'] },
  { key: 'pack:wef_arrows_ignore_trees_905_sisters.pack', name: 'wef_arrows_ignore_trees_905_sisters', packs: ['wef_arrows_ignore_trees_905_sisters.pack'] },
  { key: 'steamId:1', name: 'Bloodlines: Strigoi reskin', packs: ['StrigoiReskin.pack'] }
]

describe('find a mod by name', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(findMods('grandolphs simple', items).map((i) => i.key)).toEqual(['mod:a'])
    expect(findMods('strigoi', items).map((i) => i.key)).toEqual(['steamId:1'])
  })

  it('finds a mod by one of its pack files', () => {
    expect(findMods('grandolph_sds', items).map((i) => i.key)).toEqual(['mod:a'])
    expect(findMods('StrigoiReskin.pack', items).map((i) => i.key)).toEqual(['steamId:1'])
  })

  it('needs every word, in any order, and ranks names before other texts', () => {
    expect(findMods('twilight sisters', items).map((i) => i.key)).toEqual(['mod:b', 'mod:c'])
    expect(findMods('sisters', items).map((i) => i.key)).toEqual(['mod:b', 'pack:wef_arrows_ignore_trees_905_sisters.pack', 'mod:c'])
    expect(findMods('sisters dynamic', items)).toEqual([])
  })

  it('needs at least two letters', () => {
    expect(matchScore('s', items[1])).toBe(0)
    expect(findMods('  ', items)).toEqual([])
  })

  it('tells a Workshop link from a name', () => {
    expect(workshopIdOf('https://steamcommunity.com/sharedfiles/filedetails/?id=3706296713')).toBe('3706296713')
    expect(workshopIdOf('3706296713')).toBe('3706296713')
    expect(workshopIdOf('Sisters of Twilight')).toBeUndefined()
  })

  it('finds a name typed in the plural and says which pack a bundle was found by', () => {
    expect(matchScore('OvN Lost Worlds', { key: 'a', name: 'OvN Lost World', packs: ['ovn_lost_world.pack'] })).toBeGreaterThan(0)
    const dovakin = { key: 'b', name: 'DOVAKIN reskin series', packs: ['Warrior of Chaos.pack', 'Sons of Gork.pack'] }
    expect(matchedPack('sons of gork', dovakin)).toBe('Sons of Gork.pack')
    expect(matchedPack('dovakin', dovakin)).toBeUndefined()
  })
})
