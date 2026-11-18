/**
 * Finding a mod by the name a player types ("Add a mod of your own" in the profile editor): in the profile, among the
 * player's installed own mods and in the catalog. Case, spaces and punctuation do not count ("grandolphs" finds
 * "Grandolph's"); every word typed must appear in the mod's name or one of its pack files; other texts (a catalog
 * summary) only count after those.
 */
export interface FindItem {
  key: string
  name: string
  /** Pack files of the mod (with or without ".pack"). */
  packs?: string[]
  /** Weaker texts to search, e.g. a catalog mod's summary. */
  text?: (string | undefined)[]
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')

/** A typed text that is a Workshop link or id rather than a name. */
export const workshopIdOf = (text: string) => /(?:id=|^)(\d{6,12})\b/.exec(text.trim())?.[1]

/** How well an item fits the typed text (higher is better); 0 = no match. */
export function matchScore(typed: string, item: FindItem): number {
  const query = typed.replace(/\.pack\b/gi, '')
  const words = query.split(/\s+/).map(norm).filter(Boolean)
  const whole = norm(query)
  if (whole.length < 2) return 0
  const name = norm(item.name)
  const packs = (item.packs ?? []).map((p) => norm(p.replace(/\.pack$/i, '')))
  const texts = (item.text ?? []).flatMap((t) => (t ? [norm(t)] : []))
  const has = (fields: string[]) => words.every((w) => fields.some((f) => f.includes(w)))
  if (name === whole) return 100
  if (name.startsWith(whole)) return 90
  if (name.includes(whole)) return 80
  if (has([name])) return 70
  if (packs.some((p) => p.includes(whole))) return 60
  if (has([name, ...packs])) return 50
  if (has([name, ...packs, ...texts])) return 20
  return 0
}

/** The items that fit, best first (then by name). */
export function findMods<T extends FindItem>(query: string, items: T[]): T[] {
  return items
    .map((item) => ({ item, score: matchScore(query, item) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .map((x) => x.item)
}
