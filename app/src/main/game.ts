import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { GameScan, InstalledPack } from '@shared/api'

export const WH3_APP_ID = '1142710'
const GAME_DIR = 'Total War WARHAMMER III'

/** Library folders listed in Steam's libraryfolders.vdf ("path" entries). */
export function parseLibraryFolders(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'))
}

export function steamRoots(): string[] {
  const candidates = [
    process.env.WH3_STEAM_PATH,
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Steam'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Steam')
  ]
  return candidates.filter((p): p is string => !!p && existsSync(p))
}

async function libraries(): Promise<string[]> {
  const libs = new Set<string>()
  for (const root of steamRoots()) {
    libs.add(root)
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
    if (existsSync(vdf)) for (const p of parseLibraryFolders(await readFile(vdf, 'utf8'))) libs.add(p)
  }
  return [...libs]
}

/** Pack names that ship with the game, from data/manifest.txt ("path<TAB>size<TAB>flag"). */
export function parseManifest(text: string): Set<string> {
  const names = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const file = line.split('\t')[0]
    if (file.toLowerCase().endsWith('.pack') && !file.includes('/')) names.add(file.toLowerCase())
  }
  return names
}

async function packsIn(dir: string, source: InstalledPack['source'], steamId?: string): Promise<InstalledPack[]> {
  const out: InstalledPack[] = []
  for (const file of await readdir(dir)) {
    if (!file.toLowerCase().endsWith('.pack')) continue
    const path = join(dir, file)
    const s = await stat(path)
    out.push({ file, source, steamId, path, size: s.size, mtime: s.mtimeMs })
  }
  return out
}

/** `gamePathOverride` comes from the user's settings and wins over auto-detection. */
export async function scanGame(gamePathOverride?: string): Promise<GameScan> {
  const scan: GameScan = { gamePath: null, dataPath: null, workshopPaths: [], packs: [], vanillaPackCount: 0, errors: [] }
  const libs = await libraries()
  if (gamePathOverride) {
    if (existsSync(join(gamePathOverride, 'Warhammer3.exe'))) {
      scan.gamePath = gamePathOverride
      // Workshop content lives in the same library as the game: <library>/steamapps/common/<game>.
      libs.unshift(join(gamePathOverride, '..', '..', '..'))
    } else scan.errors.push(`The configured game folder has no Warhammer3.exe: ${gamePathOverride}`)
  }
  if (!libs.length) scan.errors.push('Steam was not found. Choose the game folder in Settings.')

  for (const lib of [...new Set(libs)]) {
    const game = join(lib, 'steamapps', 'common', GAME_DIR)
    if (!scan.gamePath && existsSync(join(game, 'Warhammer3.exe'))) scan.gamePath = game
    const workshop = join(lib, 'steamapps', 'workshop', 'content', WH3_APP_ID)
    if (existsSync(workshop)) scan.workshopPaths.push(workshop)
  }

  if (scan.gamePath) {
    scan.dataPath = join(scan.gamePath, 'data')
    const manifestPath = join(scan.dataPath, 'manifest.txt')
    const vanilla = existsSync(manifestPath) ? parseManifest(await readFile(manifestPath, 'utf8')) : new Set<string>()
    if (!vanilla.size) scan.errors.push('data/manifest.txt is missing; vanilla packs cannot be told apart from mods.')
    const dataPacks = await packsIn(scan.dataPath, 'data')
    scan.vanillaPackCount = dataPacks.filter((p) => vanilla.has(p.file.toLowerCase())).length
    scan.packs.push(...dataPacks.filter((p) => !vanilla.has(p.file.toLowerCase())))
  } else if (libs.length) {
    scan.errors.push(`${GAME_DIR} was not found in any Steam library.`)
  }

  for (const workshop of scan.workshopPaths) {
    for (const id of await readdir(workshop)) {
      try {
        scan.packs.push(...(await packsIn(join(workshop, id), 'workshop', id)))
      } catch (e) {
        scan.errors.push(`Workshop item ${id}: ${(e as Error).message}`)
      }
    }
  }
  return scan
}
