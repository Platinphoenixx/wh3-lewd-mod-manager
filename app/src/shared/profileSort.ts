/**
 * The order of the player's own profiles in the Profiles tab: last used first (the default), by name, or the player's
 * own order (dragged). "Used" means opened in the editor; a profile never opened counts from its last change.
 */
export type ProfileSort = 'used' | 'name' | 'own'

export interface SortableProfile { id: string; name: string; updatedAt?: string; createdAt?: string }

export function sortProfiles<T extends SortableProfile>(list: T[], how: ProfileSort, used: Record<string, string>, order: string[]): T[] {
  const lastUse = (p: T) => used[p.id] ?? p.updatedAt ?? p.createdAt ?? ''
  if (how === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
  if (how === 'own') {
    // Profiles the player has not placed yet (new ones) come first, newest first, then the dragged order.
    const at = new Map(order.map((id, i) => [id, i]))
    const unplaced = list.filter((p) => !at.has(p.id)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    return [...unplaced, ...list.filter((p) => at.has(p.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!)]
  }
  return [...list].sort((a, b) => lastUse(b).localeCompare(lastUse(a)))
}

/** The dragged profile moved to the place of another one (the Profiles list in "Your order"). */
export function moveProfile(ids: string[], moved: string, onto: string): string[] {
  if (moved === onto) return ids
  const rest = ids.filter((id) => id !== moved)
  const to = rest.indexOf(onto)
  const from = ids.indexOf(moved)
  const target = ids.indexOf(onto)
  // Dragged downwards it goes below the profile it was dropped on, upwards above it.
  rest.splice(from < target ? to + 1 : to, 0, moved)
  return rest
}

/** "used today", "used yesterday", "used 3 days ago", "used 2 weeks ago", … */
export function usedLabel(iso: string | undefined, now = new Date()): string {
  if (!iso) return ''
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const days = Math.round((day(now) - day(new Date(iso))) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return 'used today'
  if (days === 1) return 'used yesterday'
  if (days < 14) return `used ${days} days ago`
  if (days < 60) return `used ${Math.floor(days / 7)} weeks ago`
  return `used ${Math.floor(days / 30)} months ago`
}
