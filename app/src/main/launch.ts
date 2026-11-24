import { spawn } from 'node:child_process'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { GameScan } from '@shared/api'
import { buildModList, MOD_LIST_FILE } from '@shared/launch'
import { wineDrivePath } from '@shared/proton'
import { WH3_APP_ID } from './game'
import { protonFor } from './proton'

export interface LaunchResult {
  ok: boolean
  message: string
  modListPath?: string
}

/** One line per start in userData/launch.log (what was run, and on Linux with which Proton), for players' questions. */
async function logLaunch(text: string): Promise<void> {
  await appendFile(join(app.getPath('userData'), 'launch.log'), `${new Date().toISOString()} ${text}\n`, 'utf8').catch(() => {})
}

/**
 * Writes the mod list for `packPaths` (load order, highest priority first) into the game folder and
 * starts the game with it. Only packs found by the given scan are used. On Linux the game runs through Proton, started
 * the way Steam starts it (`protonPath`: the player's own choice of Proton, else Steam's).
 */
export async function launchGame(scan: GameScan, packPaths: string[], protonPath?: string, onExit?: (ranMs: number, code: number | null) => void): Promise<LaunchResult> {
  if (!scan.gamePath) return { ok: false, message: 'The game folder was not found. Choose it in Settings.' }
  const byPath = new Map(scan.packs.map((p) => [p.path, p]))
  const packs = packPaths.map((p) => byPath.get(p)).filter((p) => !!p)
  const linux = process.platform !== 'win32'
  const modListPath = join(scan.gamePath, MOD_LIST_FILE)
  try {
    // Under Proton the game sees the Linux folders as drive Z:.
    await writeFile(modListPath, buildModList(packs, linux ? wineDrivePath : undefined), 'utf8')
  } catch (e) {
    return { ok: false, message: `Could not write ${MOD_LIST_FILE} into the game folder: ${(e as Error).message}` }
  }
  // The semicolon is part of the game's argument syntax; pass it as one argv value, without a shell.
  // Without SteamAppId the game restarts itself through Steam, which asks about the "custom
  // parameter" and then opens the CA launcher with all mods off: the mod list is lost.
  const args = [`${MOD_LIST_FILE};`]
  let command = join(scan.gamePath, 'Warhammer3.exe')
  let commandArgs = args
  let env: NodeJS.ProcessEnv = { ...process.env, SteamAppId: WH3_APP_ID, SteamGameId: WH3_APP_ID }
  let via = ''
  if (linux) {
    const p = await protonFor(scan, args, protonPath)
    if (!p.launch) {
      await logLaunch(`not started: ${p.error}`)
      return { ok: false, message: p.error ?? 'Proton was not found.', modListPath }
    }
    command = p.launch.command
    commandArgs = p.launch.args
    env = { ...process.env, ...p.launch.env }
    // An AppImage's own library folders must not leak into the game's runtime.
    if (process.env.APPDIR && env.LD_LIBRARY_PATH?.includes(process.env.APPDIR)) delete env.LD_LIBRARY_PATH
    via = ` with ${p.proton}`
  }
  await logLaunch(`start${via}: ${JSON.stringify([command, ...commandArgs])} (${packs.length} mods)`)
  const child = spawn(command, commandArgs, { cwd: scan.gamePath, detached: true, stdio: 'ignore', env })
  const started = await new Promise<string | null>((resolve) => {
    child.once('error', (e) => resolve(e.message))
    child.once('spawn', () => resolve(null))
  })
  if (started) {
    await logLaunch(`could not start: ${started}`)
    return { ok: false, message: `Could not start the game: ${started}`, modListPath }
  }
  // The app still hears when the game closes (to check the script log), but does not keep it alive.
  const t0 = Date.now()
  // Its exit code too: 0 when the player quit the game, anything else when it crashed or was killed.
  child.once('exit', (code) => {
    void logLaunch(`ended after ${Math.round((Date.now() - t0) / 1000)} s, exit code ${code}`)
    onExit?.(Date.now() - t0, code)
  })
  child.unref()
  return { ok: true, message: `Started with ${packs.length} mods${via}.`, modListPath }
}
