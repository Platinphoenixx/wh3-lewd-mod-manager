import type { Catalog } from '@catalog/schema'
import type { Contribution, UserRule } from './community'
import type { ConflictReport } from './conflicts'
import type { Profile } from './profile'

/** A .pack file found in the game's data folder or a Workshop download folder. */
export interface InstalledPack {
  file: string
  source: 'workshop' | 'data'
  /** Workshop item id (folder name) for workshop packs. */
  steamId?: string
  path: string
  size: number
  mtime: number
}

export interface GameScan {
  gamePath: string | null
  dataPath: string | null
  workshopPaths: string[]
  /** Non-vanilla packs only (vanilla = listed in data/manifest.txt). */
  packs: InstalledPack[]
  vanillaPackCount: number
  errors: string[]
}

/** Per-user settings, stored in the app's user-data folder. */
export interface Settings {
  /** Game folder chosen by the user when auto-detection fails (…\Total War WARHAMMER III). */
  gamePath?: string
  /** Where to fetch catalog updates from (an https URL to catalog.json). Empty = default / bundled catalog. */
  catalogUrl?: string
  /** GitHub repository ("owner/name") that receives community contributions as issues. */
  contribRepo?: string
}

/** Defaults for the community build: the public repository publishes the catalog and receives contributions. */
export const DEFAULTS: Required<Pick<Settings, 'catalogUrl' | 'contribRepo'>> = {
  catalogUrl: 'https://raw.githubusercontent.com/Platinphoenixx/wh3-lewd-mod-manager/main/catalog/catalog.json',
  contribRepo: 'Platinphoenixx/wh3-lewd-mod-manager'
}

/** What the renderer may call in the main process (exposed by the preload script). */
export interface Api {
  getCatalog(): Promise<Catalog>
  scanGame(): Promise<GameScan>
  openExternal(url: string): Promise<void>
  listProfiles(): Promise<Profile[]>
  saveProfile(profile: Profile): Promise<Profile[]>
  deleteProfile(id: string): Promise<Profile[]>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  /** Opens a folder picker; returns the chosen path or null. */
  pickFolder(): Promise<string | null>
  listRules(): Promise<UserRule[]>
  saveRules(rules: UserRule[]): Promise<void>
  listContributions(): Promise<Contribution[]>
  addContribution(c: Contribution): Promise<Contribution[]>
  /** File overlaps between installed packs; `paths` in load order, highest priority first. */
  packConflicts(paths: string[]): Promise<ConflictReport & { unreadable: string[] }>
}
