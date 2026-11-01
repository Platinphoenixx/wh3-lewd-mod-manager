import { describe, expect, it } from 'vitest'
import { gameUpdatedFromManifest, lastMajorUpdate, olderThanGame, parseLuaLog } from './health'

describe('health hints', () => {
  it('reads the last game update from the Steam manifest', () => {
    expect(gameUpdatedFromManifest('"AppState"\n{\n\t"appid"\t\t"1142710"\n\t"lastupdated"\t\t"1793470983"\n}')).toBe(1793470983000)
    expect(gameUpdatedFromManifest('')).toBeUndefined()
  })

  it('takes the newest major update the player has installed', () => {
    const ups = [{ date: '2026-09-24', title: '9.0' }, { date: '2026-07-09', title: '8.1' }]
    expect(lastMajorUpdate(ups, Date.parse('2026-10-31'))?.title).toBe('9.0')
    expect(lastMajorUpdate(ups, Date.parse('2026-08-01'))?.title).toBe('8.1')
    expect(lastMajorUpdate(ups)?.title).toBe('9.0')
    expect(lastMajorUpdate(undefined)).toBeUndefined()
  })

  it('flags only data-changing mods older than the game update', () => {
    expect(olderThanGame(1, 2, true)).toBe(true)
    expect(olderThanGame(1, 2, false)).toBe(false)
    expect(olderThanGame(3, 2, true)).toBe(false)
    expect(olderThanGame(undefined, 2, true)).toBe(false)
  })

  it('collects loaded scripts and failures from lua_mod_log.txt', () => {
    const log = parseLuaLog([
      'Loading Mods',
      'Loading mod file [script\\campaign\\mod\\good.lua]',
      'Mod [script\\campaign\\mod\\good.lua] loaded successfully',
      'Loading mod file [script\\campaign\\mod\\Bad.lua]',
      'Failed to load mod file [script\\campaign\\mod\\Bad.lua], error is: attempt to index a nil value',
      '****************************'
    ].join('\r\n'))
    expect(log.loaded).toEqual(['script/campaign/mod/good.lua'])
    expect(log.failed).toEqual([{ line: 'Failed to load mod file [script\\campaign\\mod\\Bad.lua], error is: attempt to index a nil value', script: 'script/campaign/mod/bad.lua' }])
  })
})
