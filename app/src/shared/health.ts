/**
 * Hints about the state of a setup after the game changed: mods older than the last game update,
 * and script errors from the game's own log (lua_mod_log.txt, rewritten at every start).
 */

/** "lastupdated" from steamapps/appmanifest_1142710.acf, in milliseconds. */
export function gameUpdatedFromManifest(acf: string): number | undefined {
  const m = /"lastupdated"\s+"(\d+)"/i.exec(acf)
  return m ? Number(m[1]) * 1000 : undefined
}

/** The update's name without the announcement wording ("Patch 8.1 Now Live" -> "Patch 8.1"). */
export function updateName(title: string): string {
  return title.replace(/\s*(\bis\s+)?(out now|now live|live now)[!.]*\s*$/i, '').trim() || title
}

/** Steam's build number of the installed game ("buildid" in the app manifest). */
export function gameBuildFromManifest(acf: string): string | undefined {
  return /"buildid"\s+"(\d+)"/i.exec(acf)?.[1]
}

/**
 * The last major game update the player has installed: the newest catalog entry that is not newer
 * than Steam's last update of the game (when known). Hotfixes are not in the list.
 */
export function lastMajorUpdate(updates: { date: string; title: string }[] | undefined, installed?: number): { date: number; title: string } | undefined {
  const list = (updates ?? []).map((u) => ({ date: Date.parse(u.date), title: updateName(u.title) })).filter((u) => !installed || u.date <= installed)
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

/**
 * The game writes a failed mod script as a block (checked in game, 9.0.4):
 *   Failed to load mod file [script\_lib\mod\x.lua], error is: cannot open x: No such file or directory. Will attempt to require() …
 *       error loading module x from file x:[string "script\_lib\mod\x.lua"]:2: unexpected symbol near '='
 *   Failed to load mod: [script\_lib\mod\x.lua]
 * The first line's message is misleading; the indented line has the real one. One block = one failure,
 * reported as "script\_lib\mod\x.lua:2: unexpected symbol near '='".
 */
export function parseLuaLog(text: string): ScriptLog {
  const log: ScriptLog = { loaded: [], failed: [] }
  let block: { script?: string; first: string; detail?: string } | null = null
  const close = () => {
    if (block) log.failed.push({ line: block.detail ?? block.first, script: block.script ? normScript(block.script) : undefined })
    block = null
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // Indented lines continue the failure above them.
    if (block && /^\s/.test(raw)) {
      const m = /\[string "([^"]+)"\]:(\d+):\s*(.*)$/.exec(line)
      if (m) block.detail ??= `${m[1]}:${m[2]}: ${m[3]}`
      continue
    }
    close()
    const script = /\[([^\]]+\.lua)\]/i.exec(line)?.[1]
    if (/loaded successfully/i.test(line)) {
      if (script) log.loaded.push(normScript(script))
    } else if (/^Loading mod file \[/i.test(line) || /\(\) not found, continuing$/i.test(line)) {
      // A script name like pj_error_wrapping.lua is not a failure, nor is a script without a function of its
      // name (the game tries one per script in a campaign: "pj_error_wrapping() not found, continuing").
    } else if (/^Failed to load mod file/i.test(line)) {
      block = { script, first: line }
    } else if (/^Failed to load mod: /i.test(line)) {
      // Summary of a block already counted.
      if (!log.failed.some((f) => script && f.script === normScript(script))) log.failed.push({ line, script: script ? normScript(script) : undefined })
    } else if (/fail|error|attempt to|traceback|cannot|unable/i.test(line)) {
      log.failed.push({ line, script: script ? normScript(script) : undefined })
    }
  }
  close()
  return log
}
