import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GameScan } from '@shared/api'
import { buildModList, MOD_LIST_FILE } from '@shared/launch'
import { WH3_APP_ID } from './game'

export interface LaunchResult {
  ok: boolean
  message: string
  modListPath?: string
}

/**
 * Writes the mod list for `packPaths` (load order, highest priority first) into the game folder and
 * starts the game with it. Only packs found by the given scan are used.
 */
export async function launchGame(scan: GameScan, packPaths: string[]): Promise<LaunchResult> {
  if (!scan.gamePath) return { ok: false, message: 'The game folder was not found. Choose it in Settings.' }
  const byPath = new Map(scan.packs.map((p) => [p.path, p]))
  const packs = packPaths.map((p) => byPath.get(p)).filter((p) => !!p)
  const modListPath = join(scan.gamePath, MOD_LIST_FILE)
  try {
    await writeFile(modListPath, buildModList(packs), 'utf8')
  } catch (e) {
    return { ok: false, message: `Could not write ${MOD_LIST_FILE} into the game folder: ${(e as Error).message}` }
  }
  // The semicolon is part of the game's argument syntax; pass it as one argv value, without a shell.
  // Without SteamAppId the game restarts itself through Steam, which asks about the "custom
  // parameter" and then opens the CA launcher with all mods off: the mod list is lost.
  const child = spawn(join(scan.gamePath, 'Warhammer3.exe'), [`${MOD_LIST_FILE};`], {
    cwd: scan.gamePath,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SteamAppId: WH3_APP_ID, SteamGameId: WH3_APP_ID }
  })
  const started = await new Promise<string | null>((resolve) => {
    child.once('error', (e) => resolve(e.message))
    child.once('spawn', () => resolve(null))
  })
  if (started) return { ok: false, message: `Could not start the game: ${started}`, modListPath }
  child.unref()
  return { ok: true, message: `Started with ${packs.length} mods.`, modListPath }
}
