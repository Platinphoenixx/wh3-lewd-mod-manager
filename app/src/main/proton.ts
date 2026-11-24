import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { GameScan } from '@shared/api'
import {
  compatToolName, compatToolNames, officialProtonFolder, parseVdf, pickDefaultProton, protonLaunch, requiredToolAppId,
  vdfGet, type ProtonLaunch
} from '@shared/proton'
import { libraries, steamRoots, WH3_APP_ID } from './game'

/** The Steam library the game is installed in (<library>/steamapps/common/<game>). */
const libraryOf = (gamePath: string) => join(gamePath, '..', '..', '..')

/** The game's Proton prefix (made by Steam at the game's first start). */
export const compatDataOf = (gamePath: string) => join(libraryOf(gamePath), 'steamapps', 'compatdata', WH3_APP_ID)

/**
 * The folder the game sees as its AppData\Roaming: Windows' own, or on Linux the one inside the game's Proton prefix
 * (crash reports, the CA launcher's mod list).
 */
export function gameAppData(scan: GameScan | null, windowsAppData: string): string | null {
  if (process.platform === 'win32') return windowsAppData
  if (!scan?.gamePath) return null
  return join(compatDataOf(scan.gamePath), 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'Roaming')
}

const read = (p: string) => readFile(p, 'utf8').catch(() => '')

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name)
  } catch {
    return []
  }
}

/** A Proton folder: has the `proton` script Steam runs. */
const isProton = (dir: string) => existsSync(join(dir, 'proton'))

export interface ProtonChoice {
  launch?: ProtonLaunch
  /** Which Proton, in words ("GE-Proton9-20 (Steam's choice for the game)"). */
  proton?: string
  error?: string
}

/**
 * How to start the game on Linux: the Proton version Steam would use (or the one the player chose in Settings), its
 * runtime and the game's prefix. An error says what is missing in words a player can act on.
 */
export async function protonFor(scan: GameScan, exeArgs: string[], chosen?: string): Promise<ProtonChoice> {
  if (!scan.gamePath) return { error: 'The game folder was not found. Choose it in Settings.' }
  const roots = steamRoots()
  const steamRoot = roots[0]
  if (!steamRoot) return { error: 'Steam was not found in your home folder.' }
  const libs = [...new Set([libraryOf(scan.gamePath), ...(await libraries())])]
  const compatData = compatDataOf(scan.gamePath)
  if (!existsSync(join(compatData, 'pfx'))) {
    return { error: 'The game has no Proton prefix yet. Start it once from Steam (with Proton), close it, then use Play here.' }
  }

  // Every Proton there is: Valve's own in the libraries' steamapps/common, others in compatibilitytools.d.
  const official = new Map<string, string>()
  for (const lib of libs) {
    for (const d of await subdirs(join(lib, 'steamapps', 'common'))) {
      if (/^proton/i.test(d) && isProton(join(lib, 'steamapps', 'common', d)) && !official.has(d)) official.set(d, join(lib, 'steamapps', 'common', d))
    }
  }
  const custom = new Map<string, string>() // internal name → folder
  for (const base of [...roots.map((r) => join(r, 'compatibilitytools.d')), '/usr/share/steam/compatibilitytools.d']) {
    for (const d of await subdirs(base)) {
      const dir = join(base, d)
      if (!isProton(dir)) continue
      const names = compatToolNames(await read(join(dir, 'compatibilitytool.vdf')))
      for (const n of names.length ? names : [d]) if (!custom.has(n)) custom.set(n, dir)
    }
  }

  let proton: string | undefined
  let label: string | undefined
  if (chosen?.trim()) {
    if (!isProton(chosen.trim())) return { error: `The Proton folder chosen in Settings has no "proton" file: ${chosen.trim()}` }
    proton = chosen.trim()
    label = `${basename(proton)} (chosen in Settings)`
  } else {
    const name = compatToolName(await read(join(steamRoot, 'config', 'config.vdf')), WH3_APP_ID)
    if (name) {
      const folder = officialProtonFolder(name)
      proton = custom.get(name) ?? (folder ? official.get(folder) ?? [...official].find(([d]) => d.startsWith(folder))?.[1] : undefined)
      if (proton) label = `${basename(proton)} (Steam's choice for the game)`
      else return { error: `Steam runs the game with "${name}", but that Proton was not found. Start the game once from Steam so Steam installs it, or choose a Proton folder in Settings.` }
    } else {
      const folder = pickDefaultProton([...official.keys()])
      proton = folder ? official.get(folder) : [...custom.values()][0]
      if (proton) label = `${basename(proton)} (newest Proton found)`
    }
  }
  if (!proton) return { error: 'No Proton was found. Install one in Steam (Settings → Compatibility), or choose its folder in Settings.' }

  // The runtime the Proton version asks for (Steam Linux Runtime "sniper" for current versions).
  let runtime: string | undefined
  const toolId = requiredToolAppId(await read(join(proton, 'toolmanifest.vdf')))
  if (toolId) {
    for (const lib of libs) {
      const acf = join(lib, 'steamapps', `appmanifest_${toolId}.acf`)
      if (!existsSync(acf)) continue
      const dir = vdfGet(parseVdf(await read(acf)), 'AppState', 'installdir')
      const entry = typeof dir === 'string' ? join(lib, 'steamapps', 'common', dir) : ''
      if (entry && existsSync(join(entry, '_v2-entry-point'))) { runtime = entry; break }
    }
    if (!runtime) return { error: `${label} needs Steam's Linux runtime (app ${toolId}), which is not installed. Start the game once from Steam, then use Play here.` }
  }

  return {
    proton: label,
    launch: protonLaunch({
      proton, runtime, exe: join(scan.gamePath, 'Warhammer3.exe'), args: exeArgs, appId: WH3_APP_ID,
      compatData, steamRoot, gamePath: scan.gamePath, libraries: libs
    })
  }
}
