import type { Mod } from '@catalog/schema'
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

/** Pick-one packs of a mod (same `exclusiveGroup`, e.g. with/without futa models, language): group → files in catalog order. */
export function variantGroups(mod: Mod | undefined): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const p of mod?.packs ?? []) {
    if (!p.exclusiveGroup) continue
    groups.set(p.exclusiveGroup, [...(groups.get(p.exclusiveGroup) ?? []), p.file])
  }
  return groups
}

/**
 * What to call the versions of one pick-one group in the version choice. A note that names each version is taken as it is;
 * a note all of them share ("Hair") names the part instead, and what tells them apart is in their file names
 * (2_Morathi_hair_white.pack → "White").
 */
export function variantLabels(mod: Mod | undefined, files: string[]): { caption: string; label(file: string): string } {
  const noteOf = (f: string) => mod?.packs.find((p) => p.file === f)?.note
  const notes = files.map(noteOf)
  if (new Set(notes).size === files.length && notes.every(Boolean)) return { caption: 'Version', label: (f) => noteOf(f)! }
  const tokens = new Map(files.map((f) => [f, f.replace(/\.pack$/i, '').split(/[_\s-]+/).filter(Boolean)]))
  const lists = [...tokens.values()]
  let head = 0
  while (lists.every((t) => t.length > head + 1 && t[head].toLowerCase() === lists[0][head].toLowerCase())) head++
  const names = new Map(files.map((f) => {
    const rest = tokens.get(f)!.slice(head).join(' ')
    return [f, rest[0].toUpperCase() + rest.slice(1)]
  }))
  const shared = notes[0] && notes.every((n) => n === notes[0]) ? notes[0] : 'Version'
  return { caption: shared, label: (f) => (new Set(names.values()).size === files.length ? names.get(f)! : f) }
}

/**
 * Of the installed packs of one mod, keeps one per pick-one group: the player's choice (`chosen`: group → file)
 * when it is installed, else the first installed one in catalog order. Packs outside a group all stay.
 */
export function pickVariants(all: InstalledPack[], groups: Map<string, string[]>, chosen: Record<string, string> = {}): InstalledPack[] {
  const drop = new Set<string>()
  for (const [group, files] of groups) {
    const lower = files.map((f) => f.toLowerCase())
    const present = all.filter((p) => lower.includes(p.file.toLowerCase()))
    if (present.length < 2) continue
    const want = present.find((p) => p.file.toLowerCase() === chosen[group]?.toLowerCase())
      ?? [...present].sort((a, b) => lower.indexOf(a.file.toLowerCase()) - lower.indexOf(b.file.toLowerCase()))[0]
    for (const p of present) if (p !== want) drop.add(p.path)
  }
  return all.filter((p) => !drop.has(p.path))
}

/**
 * Picks the installed packs for profile entries (already in load order). `packsFor` returns the
 * installed packs of one entry, best match first; entries without any are reported as missing.
 * Of a mod's pick-one variants only one is loaded (see `pickVariants`).
 */
export function planLaunch(
  entries: { key: string; name: string; pack?: string; packs?: string[]; groups?: Map<string, string[]>; chosen?: Record<string, string> }[],
  packsFor: (key: string) => InstalledPack[]
): LaunchPlan {
  const packs: InstalledPack[] = []
  const missing: string[] = []
  for (const e of entries) {
    // A community fix's copy comes before the Workshop pack of the same name (the first line of a name wins).
    const all = [...packsFor(e.key)].sort((a, b) => Number(!!b.fix) - Number(!!a.fix))
    // A template names the exact packs; other installed packs of the same mod (variants) stay out.
    const named = (e.packs ?? (e.pack ? [e.pack] : [])).map((p) => p.toLowerCase())
    const exact = named.length ? all.filter((p) => named.includes(p.file.toLowerCase())) : []
    const found = exact.length ? exact : pickVariants(all, e.groups ?? new Map(), e.chosen)
    if (found.length) packs.push(...found)
    else missing.push(e.name)
  }
  return { packs, missing, text: buildModList(packs) }
}
