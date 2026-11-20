import { describe, expect, it } from 'vitest'
import { culpritOf, dbStopLine, markFor, parseBadModsReport, tableLabel } from './dbstop'

// As the game writes it (Miaoying(tit).pack alone, game 9.0.5).
const REPORT = [
  'first_invalid_database_record:wh3_main_cth_cha_storm_dragon_1wh_main_character_abilities_miao_bolt',
  'first_invalid_database_table:land_units_to_unit_abilites_junctions_tables',
  'first_invalid_packfile:Miaoying(tit).pack',
  'BadMods',
  'Miaoying(tit).pack',
  ''
].join('\r\n')

const entries = [
  { key: 'mod:ll-23878', name: "Lazy's Corrupted Miao Ying Progression", paths: ['D:\\Steam\\workshop\\3464018\\!!li_progression_framework_workshop.pack'] },
  { key: 'mod:ll-24571', name: 'Miaoying(tit) & Katarin(tit)', paths: ['D:\\Game\\data\\Miaoying(tit).pack'] }
]

describe('database stop', () => {
  it('reads the game report', () => {
    const s = parseBadModsReport(REPORT, 5)!
    expect(s).toEqual({
      at: 5,
      pack: 'Miaoying(tit).pack',
      table: 'land_units_to_unit_abilites_junctions_tables',
      record: 'wh3_main_cth_cha_storm_dragon_1wh_main_character_abilities_miao_bolt',
      badMods: ['Miaoying(tit).pack']
    })
    expect(tableLabel(s.table)).toBe('land_units_to_unit_abilites_junctions')
  })

  it('takes the first bad mod when the pack line is missing, and nothing without any pack', () => {
    expect(parseBadModsReport('BadMods\nfoo.pack\n', 1)?.pack).toBe('foo.pack')
    expect(parseBadModsReport('first_invalid_database_table:x_tables\n', 1)).toBeNull()
    expect(parseBadModsReport('', 1)).toBeNull()
  })

  it('finds the started entry by its pack file, ignoring case', () => {
    const s = parseBadModsReport(REPORT.replace('Miaoying(tit).pack', 'MIAOYING(TIT).PACK'), 1)!
    expect(culpritOf(s, entries)?.key).toBe('mod:ll-24571')
    expect(culpritOf({ at: 1, pack: 'other.pack', badMods: [] }, entries)).toBeUndefined()
  })

  it('says whether the mod came after the last start that worked', () => {
    const s = parseBadModsReport(REPORT, 1)!
    expect(markFor(s, 'p1', entries, ['mod:ll-23878']).added).toBe(true)
    expect(markFor(s, 'p1', entries, ['mod:ll-23878', 'mod:ll-24571']).added).toBe(false)
    expect(markFor(s, 'p1', entries).added).toBeUndefined()
    expect(markFor(s, 'p1', entries).name).toBe('Miaoying(tit) & Katarin(tit)')
  })

  it('gives one line per table, entry and pack for the catalog', () => {
    expect(dbStopLine(parseBadModsReport(REPORT, 1)!)).toBe(
      'Game stopped at loading: database table land_units_to_unit_abilites_junctions, entry wh3_main_cth_cha_storm_dragon_1wh_main_character_abilities_miao_bolt (Miaoying(tit).pack)'
    )
  })
})
