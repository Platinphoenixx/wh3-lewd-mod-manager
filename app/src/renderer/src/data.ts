import { createContext, useContext } from 'react'
import type { Catalog, ExternalMod, Mod, ModTarget } from '@catalog/schema'
import type { GameScan } from '@shared/api'
import type { UserRule } from '@shared/community'
import type { CatalogIndex } from '@shared/match'
import type { ContributeRequest } from './ContributeDialog'

export interface AppData {
  /** Catalog with the user's own rules merged in. */
  catalog: Catalog
  index: CatalogIndex
  scan: GameScan | null
  rescan(): void
  openMod(id: string): void
  blurImages: boolean
  rules: UserRule[]
  saveRules(rules: UserRule[]): void
  /** Opens the contribution dialog. */
  contribute(req: ContributeRequest): void
  /** "owner/name" of the GitHub repository for contributions, or "" when none is set. */
  contribRepo: string
}

export const DataContext = createContext<AppData | null>(null)

export function useData(): AppData {
  const d = useContext(DataContext)
  if (!d) throw new Error('DataContext missing')
  return d
}

export type Resolved = { kind: 'mod'; mod: Mod } | { kind: 'external'; ext: ExternalMod } | { kind: 'raw'; label: string }

export function resolveTarget(data: AppData, t: ModTarget): Resolved {
  if ('mod' in t) {
    const mod = data.index.mods.get(t.mod)
    return mod ? { kind: 'mod', mod } : { kind: 'raw', label: t.mod }
  }
  if ('external' in t) {
    const ext = data.catalog.external.find((e) => e.id === t.external)
    return ext ? { kind: 'external', ext } : { kind: 'raw', label: t.external }
  }
  if ('steamId' in t) return { kind: 'raw', label: `Steam ${t.steamId}` }
  return { kind: 'raw', label: t.pack }
}

export function steamUrl(id: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
}

export function coverOf(mod: Mod): string | undefined {
  const img = mod.images?.find((i) => i.kind === 'cover') ?? mod.images?.[0]
  return img?.thumb ?? img?.url
}

export const KIND_LABEL: Record<Mod['kind'], string> = {
  framework: 'Framework',
  campaign: 'Campaign',
  progression: 'Progression',
  reskin: 'Reskin',
  units: 'Units',
  submod: 'Submod',
  patch: 'Patch',
  translation: 'Translation',
  assets: 'Assets',
  utility: 'Utility',
  collection: 'Collection'
}
