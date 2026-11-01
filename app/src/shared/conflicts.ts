/**
 * Overlaps between mod packs, computed from their file indexes.
 *
 * Two packs containing the same file path is a real override: the game uses the copy from the pack
 * that loads last (higher in the list). Two packs adding files to the same database table is only a
 * hint – rows conflict only when their keys collide, which needs the table contents to tell.
 */

export interface PackFiles {
  /** Pack file name, as shown to the user. */
  name: string
  files: { path: string; size: number }[]
}

export interface Overlap {
  /** The pack that wins (higher priority = earlier in the given order). */
  winner: string
  loser: string
  count: number
  /** Overlapping files grouped by kind (db, text, script, model, texture, ui, audio, other). */
  byKind: Record<string, number>
  samples: string[]
}

export interface SharedTables {
  a: string
  b: string
  tables: string[]
}

export interface ConflictReport {
  overlaps: Overlap[]
  sharedTables: SharedTables[]
}

// Bookkeeping files every RPFM-made pack carries; they say nothing about conflicts.
export const IGNORED = /\.rpfm_reserved$|^settings\.|^notes\./

export function kindOf(path: string): string {
  if (path.startsWith('db/')) return 'db'
  if (path.startsWith('text/')) return 'text'
  if (path.startsWith('script/')) return 'script'
  if (path.startsWith('ui/')) return 'ui'
  if (path.startsWith('audio/') || path.startsWith('audioprojects/')) return 'audio'
  if (/\.(dds|png|tga|jpg)$/.test(path)) return 'texture'
  if (/^(variantmeshes|models|animations)\//.test(path) || /\.(rigid_model_v2|wsmodel|anim|bmd)$/.test(path)) return 'model'
  return 'other'
}

/** "db/units_tables/my_mod" → "units_tables". */
export function tableOf(path: string): string | null {
  const m = /^db\/([^/]+)\//.exec(path)
  return m ? m[1] : null
}

/**
 * @param packs in load order, highest priority first (top of the mod list).
 * @param sampleSize how many example paths to keep per overlap.
 */
export function analyzeConflicts(packs: PackFiles[], sampleSize = 8): ConflictReport {
  const owners = new Map<string, number[]>() // path -> pack indexes, in priority order
  const tables = packs.map(() => new Set<string>())
  packs.forEach((p, i) => {
    for (const f of p.files) {
      if (IGNORED.test(f.path)) continue
      const list = owners.get(f.path)
      if (list) list.push(i)
      else owners.set(f.path, [i])
      const t = tableOf(f.path)
      if (t) tables[i].add(t)
    }
  })

  const pairs = new Map<string, Overlap>()
  for (const [path, list] of owners) {
    if (list.length < 2) continue
    // Every lower pack loses this file to the highest one that has it.
    const top = list[0]
    for (const other of list.slice(1)) {
      const key = `${top}|${other}`
      let o = pairs.get(key)
      if (!o) pairs.set(key, (o = { winner: packs[top].name, loser: packs[other].name, count: 0, byKind: {}, samples: [] }))
      o.count++
      const k = kindOf(path)
      o.byKind[k] = (o.byKind[k] ?? 0) + 1
      if (o.samples.length < sampleSize) o.samples.push(path)
    }
  }

  // Tables nearly every mod writes to (effects, effect bundles…) make every pair "share" something;
  // only tables used by a minority of the packs are a useful hint.
  const usage = new Map<string, number>()
  for (const set of tables) for (const t of set) usage.set(t, (usage.get(t) ?? 0) + 1)
  const everywhere = (t: string) => packs.length >= 5 && (usage.get(t) ?? 0) > Math.max(3, packs.length * 0.25)

  const sharedTables: SharedTables[] = []
  for (let a = 0; a < packs.length; a++) {
    for (let b = a + 1; b < packs.length; b++) {
      const shared = [...tables[a]].filter((t) => tables[b].has(t) && !everywhere(t))
      if (shared.length) sharedTables.push({ a: packs[a].name, b: packs[b].name, tables: shared.sort() })
    }
  }
  return { overlaps: [...pairs.values()].sort((x, y) => y.count - x.count), sharedTables }
}
