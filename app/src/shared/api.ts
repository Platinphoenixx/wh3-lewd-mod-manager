import type { Catalog } from '@catalog/schema'
import type { Contribution, UserRule } from './community'
import type { ConflictReport } from './conflicts'
import type { FactsReport } from './own'
import type { Profile } from './profile'

/** A .pack file found in the game's data folder or a Workshop download folder. */
export interface InstalledPack {
  file: string
  source: 'workshop' | 'data'
  /** Workshop item id (folder name) for workshop packs. */
  steamId?: string
  /** Catalog mod this app installed the pack for (from installed.json; data packs only). */
  modId?: string
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

export interface InstallResult {
  ok: boolean
  message: string
  packs: string[]
}

export interface SteamProgress {
  id: string
  status: 'subscribed' | 'downloading' | 'installed' | 'failed'
  current?: number
  total?: number
}

/** Per-user settings, stored in the app's user-data folder. */
export interface Settings {
  /** Game folder chosen by the user when auto-detection fails (…\Total War WARHAMMER III). */
  gamePath?: string
  /** Where to fetch catalog updates from (an https URL to catalog.json). Empty = default / bundled catalog. */
  catalogUrl?: string
  /** GitHub repository ("owner/name") that receives community contributions as issues. */
  contribRepo?: string
  /** Download all missing LoversLab mods of a profile in one go (LoversLab's own wait still applies). */
  autoLoversLab?: boolean
}

export interface LoversLabJob {
  modId: string
  name: string
  url: string
  archives?: string[]
}

export interface LoversLabProgress {
  modId: string
  index: number
  total: number
  status: 'downloading' | 'choose' | 'installed' | 'failed' | 'skipped'
  message?: string
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
  /** Lets the user pick a downloaded .pack/.7z/.zip/.rar and installs its packs into the data folder. */
  installFromFile(modId?: string): Promise<InstallResult>
  /** Opens a LoversLab file page; the file the user downloads there is installed. */
  installFromLoversLab(url: string, modId?: string): Promise<InstallResult>
  /** Moves data-folder packs into a dated backup folder. */
  backupPacks(paths: string[]): Promise<{ moved: string[]; folder: string }>
  /** Subscribes to Workshop items via Steam and waits for their downloads. */
  subscribeWorkshop(ids: string[]): Promise<{ ok: boolean; message?: string; results: { id: string; status: string; error?: string }[] }>
  /** Progress of running subscriptions; returns a function that stops listening. */
  onSteamProgress(cb: (p: SteamProgress) => void): () => void
  /** Writes the mod list for these installed packs (load order) and starts the game. */
  launchGame(paths: string[]): Promise<{ ok: boolean; message: string; modListPath?: string }>
  /** File overlaps between installed packs; `paths` in load order, highest priority first. */
  packConflicts(paths: string[]): Promise<ConflictReport & { unreadable: string[] }>
  /** Dependencies, file counts, tables and shared files of installed packs (to place own mods). */
  packFacts(paths: string[]): Promise<FactsReport>
  /** Installs files dropped onto the window (.pack/.7z/.zip/.rar). */
  installPaths(paths: string[]): Promise<InstallResult>
  /** Local path of a dropped file (Electron no longer exposes File.path). */
  pathForFile(file: File): string
  /** Downloads LoversLab mods one after another in one window and installs them (setting autoLoversLab). */
  installQueueFromLoversLab(jobs: LoversLabJob[]): Promise<{ modId: string; ok: boolean; message: string }[]>
  /** Progress of the LoversLab queue; returns a function that stops listening. */
  onQueueProgress(cb: (p: LoversLabProgress) => void): () => void
  /** Titles of Workshop items from the player's Steam client, cached; by item id. */
  workshopDetails(ids: string[]): Promise<Record<string, { title: string; updated: number; preview?: string }>>
}
