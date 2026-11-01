import type { Catalog } from '@catalog/schema'
import { targetFor, targetKey, type CatalogIndex } from './match'
import { baseKeys } from './profile'

/**
 * Mod lists from other launchers, turned into a profile: the template that matches best becomes the
 * base, the rest are switched-on extras (catalog mods) or own mods (packs the catalog does not know).
 */

export interface ImportedMod {
  pack: string
  steamId?: string
}

export interface ImportSource {
  id: string
  /** "CA launcher – current mod list", "WH3 Mod Manager – preset 'X'", a .twmods file name… */
  label: string
  mods: ImportedMod[]
}

const fileOf = (p: string) => p.replace(/^.*[\\/]/, '')
const workshopIdOf = (p: string) => /[\\/]1142710[\\/](\d+)[\\/]/.exec(p)?.[1]

/** A .twmods profile exported by the CA launcher: one `mod_lookup_key://…/<pack>` line per active mod. */
export function parseTwmods(text: string): ImportedMod[] {
  const out: ImportedMod[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^mod_lookup_key:\/\/[0-9a-f]+@(.+)$/.exec(line.trim())
    if (!m) continue
    const s = /^steam_workshop:\d+\/(\d+)@\d+\/(.+)$/.exec(m[1])
    out.push(s ? { pack: s[2], steamId: s[1] } : { pack: fileOf(m[1]) })
  }
  return out
}

/** The CA launcher's current list (…/The Creative Assembly/Launcher/20190104-moddata.dat), active mods only. */
export function parseCaModdata(json: string): ImportedMod[] {
  const list = JSON.parse(json) as { packfile?: string; active?: boolean; game?: string; order?: number }[]
  return list
    .filter((m) => m.active && (m.game ?? 'warhammer3') === 'warhammer3' && m.packfile)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((m) => ({ pack: fileOf(m.packfile!), steamId: workshopIdOf(m.packfile!) }))
}

/** Presets of the WH3 Mod Manager (…/wh3mm/config.json): the current list and every named preset. */
export function parseWh3mm(json: string): ImportSource[] {
  type Preset = { name?: string; mods?: { name: string; path?: string; workshopId?: string; isEnabled?: boolean }[] }
  const c = JSON.parse(json) as { gameToCurrentPreset?: { wh3?: Preset }; gameToPresets?: { wh3?: Preset[] } }
  const mods = (p: Preset) =>
    (p.mods ?? []).filter((m) => m.isEnabled).map((m) => ({ pack: m.name, steamId: m.workshopId || (m.path ? workshopIdOf(m.path) : undefined) }))
  const out: ImportSource[] = []
  if (c.gameToCurrentPreset?.wh3) out.push({ id: 'wh3mm:current', label: 'WH3 Mod Manager – current mod list', mods: mods(c.gameToCurrentPreset.wh3) })
  for (const [i, p] of (c.gameToPresets?.wh3 ?? []).entries()) {
    out.push({ id: `wh3mm:${i}`, label: `WH3 Mod Manager – preset “${p.name || i + 1}”`, mods: mods(p) })
  }
  return out.filter((s) => s.mods.length)
}

/** Profile key for an imported mod: its catalog mod when known, else an own-mod key. */
export function keyForImported(index: CatalogIndex, m: ImportedMod): string {
  const t = targetFor(index, { file: m.pack, source: m.steamId ? 'workshop' : 'data', steamId: m.steamId, path: '', size: 0, mtime: 0 })
  return t ? targetKey(t) : m.steamId ? `steamId:${m.steamId}` : `pack:${m.pack}`
}

/**
 * The profile for an imported list: based on the template that shares the most mods with it
 * (Jaccard similarity), with the template's other mods removed and the rest added as extras.
 */
export function profileFromImport(catalog: Catalog, index: CatalogIndex, mods: ImportedMod[]): { presetId: string; extras: string[]; removed: string[] } {
  const keys = [...new Set(mods.map((m) => keyForImported(index, m)))]
  const wanted = new Set(keys)
  let best = catalog.presets[0]
  let bestScore = -1
  for (const p of catalog.presets) {
    const base = new Set(baseKeys(p))
    const shared = [...base].filter((k) => wanted.has(k)).length
    const score = shared / (base.size + wanted.size - shared || 1)
    if (score > bestScore) [best, bestScore] = [p, score]
  }
  const base = baseKeys(best)
  return { presetId: best.id, extras: keys.filter((k) => !base.includes(k)), removed: [...new Set(base.filter((k) => !wanted.has(k)))] }
}
