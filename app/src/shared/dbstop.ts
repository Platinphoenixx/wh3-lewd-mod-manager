/**
 * When the game stops while it loads its database ("crash to database"), it writes crash_report/bad_mods_report.txt: the
 * first entry it could not use, its table and the pack it came from, and the packs it blames. The app reads that report
 * after a game it started closes, names the mod of the profile the pack belongs to and offers to switch it off
 * (mocks/e1_crash_card.png, e2_crash_list.png).
 */

export interface DbStop {
  /** When the game wrote its report (ms). */
  at: number
  /** first_invalid_packfile – the pack the entry came from. */
  pack?: string
  /** first_invalid_database_table, e.g. land_units_to_unit_abilites_junctions_tables. */
  table?: string
  /** first_invalid_database_record – the entry's keys, as the game writes them. */
  record?: string
  /** The packs listed under BadMods. */
  badMods: string[]
}

/** The report's text → its facts; null when it names no pack at all. */
export function parseBadModsReport(text: string, at: number): DbStop | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const get = (key: string) => {
    const l = lines.find((x) => x.startsWith(`${key}:`))
    return l ? l.slice(key.length + 1).trim() || undefined : undefined
  }
  const from = lines.indexOf('BadMods')
  const badMods = from < 0 ? [] : lines.slice(from + 1).filter((l) => l && !l.includes(':'))
  const pack = get('first_invalid_packfile') ?? badMods[0]
  if (!pack) return null
  return { at, pack, table: get('first_invalid_database_table'), record: get('first_invalid_database_record'), badMods }
}

/** The table's name as the game's tools show it (without "_tables"). */
export const tableLabel = (table?: string): string | undefined => table?.replace(/_tables$/i, '')

const fileName = (p: string) => p.replace(/^.*[\\/]/, '').toLowerCase()

/** The started entry a stop belongs to: the one that started the pack the game named (else one it listed as bad). */
export function culpritOf<E extends { key: string; paths: string[] }>(stop: DbStop, entries: E[]): E | undefined {
  for (const name of [stop.pack, ...stop.badMods].filter((n): n is string => !!n).map((n) => n.toLowerCase())) {
    const e = entries.find((x) => x.paths.some((p) => fileName(p) === name))
    if (e) return e
  }
  return undefined
}

/**
 * What the app keeps per profile after a stop, until the profile's next start: shown on the load order (banner, marked
 * row). `added`: the mod was not loaded at the last start of this profile that got to the main menu.
 */
export interface DbStopMark extends DbStop {
  profileId: string
  key?: string
  name?: string
  added?: boolean
  /** Set by the message card's "Switch it off and play again": the profile does it once it is open. */
  act?: 'off-play'
}

export function markFor(stop: DbStop, profileId: string, entries: { key: string; name: string; paths: string[] }[], lastGood?: string[]): DbStopMark {
  const e = culpritOf(stop, entries)
  return { ...stop, profileId, key: e?.key, name: e?.name, added: e && lastGood ? !lastGood.includes(e.key) : undefined }
}

/** The line a report to the catalog counts (the same stop on two PCs gives the same line). */
export function dbStopLine(stop: DbStop): string {
  return `Game stopped at loading: database table ${tableLabel(stop.table) ?? '?'}, entry ${stop.record ?? '?'}${stop.pack ? ` (${stop.pack})` : ''}`
}
