/**
 * Hints about the state of a setup after the game changed: mods older than the last game update,
 * and script errors from the game's own log (lua_mod_log.txt, rewritten at every start).
 */

/** "lastupdated" from steamapps/appmanifest_1142710.acf, in milliseconds. */
export function gameUpdatedFromManifest(acf: string): number | undefined {
  const m = /"lastupdated"\s+"(\d+)"/i.exec(acf)
  return m ? Number(m[1]) * 1000 : undefined
}

/**
 * The last major game update the player has installed: the newest catalog entry that is not newer
 * than Steam's last update of the game (when known). Hotfixes are not in the list.
 */
export function lastMajorUpdate(updates: { date: string; title: string }[] | undefined, installed?: number): { date: number; title: string } | undefined {
  const list = (updates ?? []).map((u) => ({ date: Date.parse(u.date), title: u.title })).filter((u) => !installed || u.date <= installed)
  return list.sort((a, b) => b.date - a.date)[0]
}

/**
 * A mod that changes game data (database tables or scripts) and was not updated since the last game
 * update is the usual suspect when a game crashes after a patch. Only a hint: many such mods still work.
 */
export function olderThanGame(modUpdated: number | undefined, gameUpdated: number | undefined, changesData: boolean): boolean {
  return !!modUpdated && !!gameUpdated && changesData && modUpdated < gameUpdated
}

export interface ScriptLog {
  /** Script files the game loaded from mods (normalised: lower case, forward slashes). */
  loaded: string[]
  /** Lines that report a failure, with the script they name (if any). */
  failed: { line: string; script?: string }[]
}

export const normScript = (p: string) => p.replace(/\\/g, '/').toLowerCase()

export function parseLuaLog(text: string): ScriptLog {
  const log: ScriptLog = { loaded: [], failed: [] }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const script = /\[([^\]]+\.lua)\]/i.exec(line)?.[1]
    if (/loaded successfully/i.test(line)) {
      if (script) log.loaded.push(normScript(script))
    } else if (/fail|error|attempt to|traceback|cannot|unable/i.test(line)) {
      log.failed.push({ line, script: script ? normScript(script) : undefined })
    }
  }
  return log
}
