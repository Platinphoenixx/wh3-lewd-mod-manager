import type { InstalledPack } from './api'

/** Name of the mod list this app writes into the game folder (separate from other managers' files). */
export const MOD_LIST_FILE = 'wh3lmm_mods.txt'

export interface LaunchPlan {
  /** Packs in load order, highest priority first. */
  packs: InstalledPack[]
  /** Profile entries that have no installed pack (shown before launching). */
  missing: string[]
  text: string
}

/**
 * The text the game reads at start (`Warhammer3.exe wh3lmm_mods.txt;`): one `add_working_directory`
 * per Workshop folder, then one `mod` line per pack in priority order, the first line winning.
 * Packs in the game's data folder need no working directory.
 */
export function buildModList(packs: InstalledPack[]): string {
  const dirs: string[] = []
  for (const p of packs) {
    if (p.source !== 'workshop') continue
    const dir = p.path.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/')
    if (!dirs.includes(dir)) dirs.push(dir)
  }
  const seen = new Set<string>()
  const mods: string[] = []
  for (const p of packs) {
    const key = p.file.toLowerCase()
    if (seen.has(key)) continue // the same pack name twice would confuse the game; the higher one wins
    seen.add(key)
    mods.push(`mod "${p.file}";`)
  }
  return [...dirs.map((d) => `add_working_directory "${d}";`), ...mods].join('\n') + '\n'
}

/**
 * Picks the installed packs for profile entries (already in load order). `packsFor` returns the
 * installed packs of one entry, best match first; entries without any are reported as missing.
 */
export function planLaunch(
  entries: { key: string; name: string; pack?: string }[],
  packsFor: (key: string) => InstalledPack[]
): LaunchPlan {
  const packs: InstalledPack[] = []
  const missing: string[] = []
  for (const e of entries) {
    const all = packsFor(e.key)
    // A template names the exact pack; other installed packs of the same mod (variants) stay out.
    const exact = e.pack ? all.filter((p) => p.file.toLowerCase() === e.pack!.toLowerCase()) : []
    const found = exact.length ? exact : all
    if (found.length) packs.push(...found)
    else missing.push(e.name)
  }
  return { packs, missing, text: buildModList(packs) }
}
