/**
 * Starting the game on Linux. Warhammer 3 is a Windows game there, run by Steam's Proton; the app starts it the way
 * Steam does: the Proton version Steam uses for the game (Steam's own config, else Steam's default), inside the
 * Steam Linux Runtime that Proton asks for, with the game's own Proton prefix. Everything here only reads text Steam
 * wrote; `src/main/proton.ts` finds the files.
 */

export type Vdf = { [key: string]: string | Vdf }

/** Steam's text key-value files (config.vdf, libraryfolders.vdf, toolmanifest.vdf, appmanifest_*.acf). Keys keep their case. */
export function parseVdf(text: string): Vdf {
  const tokens: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|([{}])|\/\/[^\n]*|([^\s{}"]+)/g
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) tokens.push('"' + m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"'))
    else if (m[2]) tokens.push(m[2])
    else if (m[3]) tokens.push('"' + m[3])
  }
  let i = 0
  const block = (): Vdf => {
    const out: Vdf = {}
    while (i < tokens.length) {
      const t = tokens[i++]
      if (t === '}') return out
      if (t === '{') continue
      const key = t.slice(1)
      const next = tokens[i++]
      if (next === '{') out[key] = block()
      else if (next !== undefined && next !== '}') out[key] = next.slice(1)
    }
    return out
  }
  return block()
}

/** A key of a block, ignoring case (Steam writes "CompatToolMapping" and "compattoolmapping" alike). */
export function vdfGet(v: Vdf | string | undefined, ...path: string[]): Vdf | string | undefined {
  let cur: Vdf | string | undefined = v
  for (const key of path) {
    if (!cur || typeof cur === 'string') return undefined
    const k = Object.keys(cur).find((x) => x.toLowerCase() === key.toLowerCase())
    cur = k === undefined ? undefined : cur[k]
  }
  return cur
}

/**
 * The compatibility tool Steam runs the game with, from config/config.vdf: the game's own choice ("Force the use of a
 * specific compatibility tool"), else Steam's default for all games (entry "0"). Undefined when neither is set.
 */
export function compatToolName(configVdf: string, appId: string): string | undefined {
  const mapping = vdfGet(parseVdf(configVdf), 'InstallConfigStore', 'Software', 'Valve', 'Steam', 'CompatToolMapping')
  for (const id of [appId, '0']) {
    const name = vdfGet(mapping, id, 'name')
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return undefined
}

/**
 * The folder name (in steamapps/common) of one of Valve's own Proton versions, from Steam's internal name:
 * proton_experimental → "Proton - Experimental", proton_9 → "Proton 9.0", proton_63 → "Proton 6.3".
 */
export function officialProtonFolder(name: string): string | undefined {
  const n = name.toLowerCase()
  if (n === 'proton_experimental') return 'Proton - Experimental'
  if (n === 'proton_hotfix') return 'Proton Hotfix'
  const m = /^proton_(\d+)$/.exec(n)
  if (!m) return undefined
  const d = m[1]
  // From Proton 7 on one number ("proton_9" = 9.0, "proton_10" = 10.0); older ones carry the minor version
  // (63 = 6.3, 513 = 5.13, 316 = 3.16).
  if (Number(d) >= 7 && Number(d) <= 19) return `Proton ${d}.0`
  return `Proton ${d[0]}.${d.slice(1)}`
}

/**
 * The Proton to use when Steam names none, from the Proton folders found: the newest numbered version, else
 * Experimental, else whatever there is. `folders` are names like "Proton 9.0", "Proton 9.0 (Beta)", "Proton - Experimental".
 */
export function pickDefaultProton(folders: string[]): string | undefined {
  const numbered = folders
    .map((f) => ({ f, v: /^Proton (\d+)\.(\d+)/.exec(f) }))
    .filter((x) => x.v)
    .sort((a, b) => Number(b.v![1]) - Number(a.v![1]) || Number(b.v![2]) - Number(a.v![2]) || a.f.length - b.f.length)
  return numbered[0]?.f ?? folders.find((f) => /experimental/i.test(f)) ?? folders[0]
}

/** The internal names a compatibility tool folder (compatibilitytools.d/<folder>) declares in its compatibilitytool.vdf. */
export function compatToolNames(compatibilityToolVdf: string): string[] {
  const tools = vdfGet(parseVdf(compatibilityToolVdf), 'compatibilitytools', 'compat_tools')
  return tools && typeof tools !== 'string' ? Object.keys(tools) : []
}

/** The Steam app id of the runtime a Proton version needs (toolmanifest.vdf "require_tool_appid"; 1628350 = sniper). */
export function requiredToolAppId(toolManifestVdf: string): string | undefined {
  const id = vdfGet(parseVdf(toolManifestVdf), 'manifest', 'require_tool_appid')
  return typeof id === 'string' && /^\d+$/.test(id) ? id : undefined
}

/** A path as the game sees it under Proton: Wine shows the Linux file system as drive Z:. */
export function wineDrivePath(linuxPath: string): string {
  return linuxPath.startsWith('/') ? `Z:${linuxPath}` : linuxPath
}

export interface ProtonLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * The command Steam itself would run: `<runtime>/_v2-entry-point --verb=waitforexitandrun -- <proton>/proton
 * waitforexitandrun <exe> <args>` (or Proton alone when it needs no runtime), with the variables Proton reads.
 * `waitforexitandrun` keeps the command running until the game ends, so the app hears when it closed and how.
 */
export function protonLaunch(o: {
  proton: string; runtime?: string; exe: string; args: string[]; appId: string
  compatData: string; steamRoot: string; gamePath: string; libraries: string[]
}): ProtonLaunch {
  const protonBin = `${o.proton}/proton`
  const tail = [protonBin, 'waitforexitandrun', o.exe, ...o.args]
  const env: Record<string, string> = {
    SteamAppId: o.appId,
    SteamGameId: o.appId,
    STEAM_COMPAT_APP_ID: o.appId,
    STEAM_COMPAT_DATA_PATH: o.compatData,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: o.steamRoot,
    STEAM_COMPAT_INSTALL_PATH: o.gamePath,
    // Libraries outside the home folder (another disk) have to be visible inside the runtime's container.
    STEAM_COMPAT_LIBRARY_PATHS: [...new Set(o.libraries)].join(':')
  }
  return o.runtime
    ? { command: `${o.runtime}/_v2-entry-point`, args: ['--verb=waitforexitandrun', '--', ...tail], env }
    : { command: protonBin, args: tail.slice(1), env }
}
