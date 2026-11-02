import { describe, expect, it } from 'vitest'
import { gameBuildFromManifest, gameUpdatedFromManifest, lastMajorUpdate, olderThanGame, parseLuaLog, updateName } from './health'

describe('health hints', () => {
  it('reads the last game update from the Steam manifest', () => {
    expect(gameUpdatedFromManifest('"AppState"\n{\n\t"appid"\t\t"1142710"\n\t"lastupdated"\t\t"1793470983"\n}')).toBe(1793470983000)
    expect(gameUpdatedFromManifest('')).toBeUndefined()
    expect(gameBuildFromManifest('\t"buildid"\t\t"25961564"\n')).toBe('25961564')
  })

  it('names updates without the announcement wording', () => {
    expect(updateName('Lords of the End Times is OUT NOW!')).toBe('Lords of the End Times')
    expect(updateName('Patch 8.1 Now Live')).toBe('Patch 8.1')
    expect(updateName('Bhashiva Character Pack & Update 8.0 Out Now!')).toBe('Bhashiva Character Pack & Update 8.0')
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

  it('reads a failure block as the game writes it (one failure, the real message)', () => {
    const log = parseLuaLog([
      '',
      '****************************',
      'Loading Mods',
      'Loading mod file [script\\_lib\\mod\\qa_console.lua]',
      'Mod [script\\_lib\\mod\\qa_console.lua] loaded successfully',
      'Loading mod file [script\\_lib\\mod\\wh3lmm_script_test.lua]',
      '\tFailed to load mod file [script\\_lib\\mod\\wh3lmm_script_test.lua], error is: cannot open wh3lmm_script_test: No such file or directory. Will attempt to require() this file to generate a more meaningful error message:',
      '\t\terror loading module wh3lmm_script_test from file wh3lmm_script_test:[string "script\\_lib\\mod\\wh3lmm_script_test.lua"]:2: unexpected symbol near \'=\'',
      'Failed to load mod: [script\\_lib\\mod\\wh3lmm_script_test.lua]',
      '****************************'
    ].join('\r\n'))
    expect(log.loaded).toEqual(['script/_lib/mod/qa_console.lua'])
    expect(log.failed).toEqual([{ line: 'script\\_lib\\mod\\wh3lmm_script_test.lua:2: unexpected symbol near \'=\'', script: 'script/_lib/mod/wh3lmm_script_test.lua' }])
  })

  it('reads a runtime failure once and ignores script names that only contain "error"', () => {
    const log = parseLuaLog([
      'Loading mod file [script\\_lib\\mod\\!kerb_alar.lua]',
      'Failed to execute loaded mod file [script\\_lib\\mod\\!kerb_alar.lua], error is: [string "script\\_lib\\mod\\!kerb_alar.lua"]:1: attempt to index global \'mother_ostankya_features\' (a nil value)',
      'Failed to load mod: [script\\_lib\\mod\\!kerb_alar.lua]',
      'Loading mod file [script\\_lib\\mod\\pj_error_wrapping.lua]',
      'Mod [script\\_lib\\mod\\pj_error_wrapping.lua] loaded successfully',
      // In a campaign the game calls a function named like each script; a missing one is normal.
      'pj_error_wrapping() not found, continuing'
    ].join('\r\n'))
    expect(log.loaded).toEqual(['script/_lib/mod/pj_error_wrapping.lua'])
    expect(log.failed.map((f) => f.script)).toEqual(['script/_lib/mod/!kerb_alar.lua'])
  })
})
