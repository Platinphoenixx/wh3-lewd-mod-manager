/**
 * Shape of catalog/catalog.json.
 *
 * The catalog is curated from LoversLab, the Lewdhammer wiki and the Discord server
 * (see docs/DEVELOPMENT.md). The app only reads it; everything it knows about mods that it
 * cannot see in the installed .pack files comes from here.
 *
 * Load-order convention (same as the launcher and wh3mm): a mod higher in the list is
 * loaded later and wins conflicts. "above" in this file always means "higher priority".
 */

export interface Catalog {
  schemaVersion: 1;
  generatedAt: string; // ISO timestamp of the last curation run
  sources: SourceRun[];
  mods: Mod[];
  /** Mods referenced by catalog entries but not part of the lewd scene (SFO, MCT, UI mods...). */
  external: ExternalMod[];
  /** Global load-order tiers, lowest priority first. Mods pick one via Mod.tier. */
  tiers: Tier[];
  /** Free-form knowledge that does not belong to one mod (wiki rules, Discord FAQ...). */
  notes: Note[];
  /** Ready-made mod lists from the community, the starting point of the profile wizard. */
  presets: Preset[];
  /** Per-character guides (KPW's link lists): required DLC, campaign type, what to get. */
  campaignGuides: CampaignGuide[];
  /** Major game updates, newest first (from the game's Steam announcements; hotfixes excluded). */
  gameUpdates?: { date: string; title: string }[];
}

export interface CampaignGuide {
  character: string;
  campaigns?: ("IE" | "IEE" | "RoC")[];
  dlc: { name: string; why?: string; required: boolean }[];
  notes: string[];
  /** Mods the guide lists, in its order. */
  /** url: download location outside Steam/LL (Discord message, MEGA...). */
  entries: { name: string; target?: ModTarget; optional?: boolean; note?: string; url?: string }[];
  source: { type: "discord"; url: string; author?: string };
}

/**
 * A complete, ordered mod list someone in the community tested for one campaign,
 * e.g. Readman's .twmods lists from #many-modlist-methods.
 */
export interface Preset {
  id: string;                 // e.g. "readman-alarielle-early"
  name: string;
  playAs: string[];
  /** Campaigns are played in phases; "late" lists must only be switched to mid-campaign. */
  phase: "early" | "late" | "any";
  /**
   * tested  = a complete list someone played with (load order tested),
   * guide   = a community guide's list (e.g. KPW's per-character docs; order as in the guide),
   * derived = generated from a mod's own page: the mod plus everything it requires, ordered by tier.
   */
  origin: "tested" | "guide" | "derived";
  phaseNote?: string;         // e.g. "switch only from corruption stage 5 on"
  /** English Markdown: what this campaign is about, what the list contains, how to play it. */
  description?: string;
  highlights?: string[];
  /** Mod ids whose images represent this preset (the app shows their covers). */
  coverMods?: string[];
  source: { type: "discord" | "loverslab" | "wiki" | "steam" | "derived"; url?: string; file?: string; author?: string; date?: string };
  /** In load order as given by the source: first entry = highest priority. */
  entries: PresetEntry[];
  /**
   * Changes the curator made to the source list because packs got newer versions since it was made
   * (moved to Steam, merged into one pack, fixed re-uploads). to = new pack file, or "removed".
   */
  modernized?: { from: string; to: string; note?: string }[];
}

export interface PresetEntry {
  pack: string;
  steamId?: string;
  /** Catalog mod or external this pack belongs to, when known. */
  target?: ModTarget;
  from: "steam" | "download";
}

export interface SourceRun {
  source: "loverslab" | "steam" | "wiki" | "discord";
  fetchedAt: string;
  detail?: string; // e.g. which Discord channels were read
}

export type ModKind =
  | "framework"    // shared base others build on (Lazy's Corruption Framework, Generic framework)
  | "campaign"     // adds a playable story / "play as X"
  | "progression"  // corruption stages for a character, usable in several campaigns
  | "reskin"       // model/texture replacement, usually variant-selector based
  | "units"        // new units / lords / heroes
  | "submod"       // extends or tweaks another mod
  | "patch"        // compatibility or bug fix between mods
  | "translation"
  | "assets"       // shared asset packs without gameplay
  | "utility"      // console, MCT, debug tools...
  | "collection";  // a Steam collection; its items are "requires" relations


export interface Mod {
  /**
   * Stable id derived from where the mod lives: "ll-<LL file id>" (e.g. "ll-42028"),
   * "steam-<workshop id>" for mods that exist only on Steam, "dc-<slug>" for Discord-only.
   */
  id: string;
  name: string;
  authors: string[];
  kind: ModKind;
  summary: string;            // 1-3 sentences, English, written by the curator (list views)
  /**
   * Detail-view text, English Markdown, a few short paragraphs: what the mod does, how it plays,
   * what changes in a campaign, when it makes sense. Written by the curator, not copied.
   */
  description?: string;
  features?: string[];        // short English bullet points
  /** For optional add-ons: who should add it and what it brings to a profile. */
  recommendedFor?: string;
  tags: string[];
  /** Image URLs (hotlinked; the app caches them). Order = display order, first is the cover. */
  images?: ModImage[];

  sources: {
    loverslab?: {
      fileId: string; url: string; version?: string; updated?: string; category: string
      /** Download count on LoversLab (from the weekly crawl). */
      downloads?: number
      /** The page offers exactly one file; value is its type ("pack?", "7z", "rar", "zip", "text/link"). */
      singleFile?: string
      /** The download leads off LoversLab (Steam, Mega, Nexus…). */
      externalDownload?: boolean
    };
    /** The mod's Nexus Mods page (read by hand; numbers as of that reading). */
    nexus?: { modId: string; url: string; uploaded?: string; endorsements?: number; downloads?: number; adult?: boolean; version?: string; updated?: string };
    /** Workshop items that belong to this mod. Many are unlisted and only linked from LL. */
    steam?: SteamItem[];
    /** Files that are only distributed on LL / Discord as downloads. */
    downloads?: DownloadFile[];
    discord?: DiscordRef[];
    wiki?: string[];
  };

  /** Support links found on the mod's own pages (Patreon, Ko-fi, …); a page may also credit collaborators. */
  /** owner = the creator the link belongs to, when that is not this mod's author (credited on their page). */
  support?: { platform: string; url: string; owner?: string }[];
  /** The uploader's pages: LoversLab profile, Steam Workshop files. */
  authorPages?: { site: "loverslab" | "steam"; name?: string; url: string }[];

  /** .pack filenames this mod installs. Used to recognise it in the data/workshop folders. */
  packs: PackRef[];

  /** Set for campaign/progression mods: what you can play as. Drives the profile wizard. */
  playAs?: PlayAs[];

  relations: Relation[];
  loadOrder?: LoadOrderRule;
  tier?: string;              // Tier.id

  /**
   * Leftovers that break this mod. Typical case: the mod moved from LoversLab to Steam, and an old
   * .pack with the same name in the data folder takes priority over the Workshop copy and crashes.
   * The app warns and offers to move matching files to a backup folder (never deletes silently).
   */
  cleanup?: {
    staleDataPacks?: string[];      // file names or glob patterns inside <game>/data
    unsubscribeSteamIds?: string[]; // superseded Workshop items
    note: string;
  };

  requiresDlc?: string[];     // e.g. "Shadows of Change"
  campaigns?: ("IE" | "IEE" | "RoC")[]; // Immortal Empires, IE Expanded, Realm of Chaos
  status?: "stable" | "beta" | "wip" | "abandoned" | "superseded";
  knownIssues?: string[];
  installNotes?: string[];    // things a human must know (MCT settings, start a new campaign...)

  /** Accepted community feedback ("how does it work for you"), counted per verdict. */
  communityReports?: { works: number; issues: number; broken: number; lastReport?: string };
  /** Accepted community corrections and hints, shown as-is next to the curated text. */
  communityNotes?: { text: string; url?: string; date: string }[];

  curation: {
    lastChecked: string;      // ISO date
    confidence: "high" | "medium" | "low"; // low = guessed from vague text, verify before trusting
    openQuestions?: string[];
  };
}

export interface ModImage {
  url: string;
  thumb?: string;
  /** cover = title image, screenshot = in-game, loadorder = mod-manager screenshot, other = diagrams etc. */
  kind: "cover" | "screenshot" | "loadorder" | "other";
  caption?: string;           // English
  source: "loverslab" | "steam" | "discord" | "wiki" | "nexus";
}

export interface SteamItem {
  id: string;
  title?: string;
  unlisted?: boolean;
  /** Last Workshop update (YYYY-MM-DD), refreshed on every catalog build. */
  updated?: string;
  /** Variant of the mod this item is for, when one mod ships several Steam items. */
  role?: string;
  /** Current Workshop subscribers (refreshed weekly). */
  subscribers?: number;
  /** Removed from the Workshop; the app installs from the mod's other source instead. */
  removed?: boolean;
}

export interface DownloadFile {
  name: string;               // file name as offered on LL / Discord
  url: string;                // LL download page or Discord message link
  /** What the file is for, e.g. "Cultist voice + less heel clipping", or its size. */
  description?: string;
  /** Files in the same group are alternatives: install exactly one. */
  exclusiveGroup?: string;
  optional?: boolean;
  note?: string;
}

export interface DiscordRef {
  channel: string;            // channel name, e.g. "#kerberos-projects"
  messageUrl?: string;
  note?: string;
}

export interface PackRef {
  file: string;               // e.g. "kerberos_mod_assets.pack"
  from: "steam" | "download";
  steamId?: string;
  optional?: boolean;
  exclusiveGroup?: string;
  /** LoversLab download that contains this pack, without extension (e.g. "@female_unit_cards_nsfw_1_5"); from the pack analysis. */
  archive?: string;
  note?: string;
}

export interface PlayAs {
  character: string;          // "Alarielle", "Miao Ying", "N'Kari"...
  faction?: string;
  campaigns?: ("IE" | "IEE" | "RoC")[];
  note?: string;              // e.g. "requires Lazy's Morathi progression"
}

/** Target of a relation: another catalog mod, an external mod, or a raw pack/steam id. */
export type ModTarget =
  | { mod: string }
  | { external: string }
  | { steamId: string }
  | { pack: string };

export type RelationKind =
  | "requires"      // will not work without it
  | "recommends"    // optional, the author suggests it (offered as a checkbox)
  | "optional"      // optional add-on that hooks into this mod
  | "incompatible"  // must not be active together
  | "extends"       // this is a submod/patch/translation of the target
  | "supersedes";   // replaces an older mod; do not use both

export interface Relation {
  kind: RelationKind;
  target: ModTarget;
  note?: string;
  /** Only relevant with some option, e.g. "only when playing as Morathi". */
  condition?: string;
  /** Alternatives: of all "recommends"/"optional" relations sharing a group, pick at most one. */
  exclusiveGroup?: string;
  /** "community" = accepted community contribution, "user" = the local user's own rule (never in catalog.json). */
  source: { type: "loverslab" | "discord" | "wiki" | "steam" | "nexus" | "inferred" | "community" | "user"; url?: string };
}

export interface LoadOrderRule {
  above?: ModTarget[];        // must have higher priority than these
  below?: ModTarget[];        // must have lower priority than these
  note?: string;
}

export interface Tier {
  id: string;                 // e.g. "framework", "progression", "reskin", "visual-submod"
  label: string;
  note?: string;
}

export interface ExternalMod {
  id: string;
  name: string;
  steamId?: string;
  url?: string;
  note?: string;
  /** Workshop uploader and their support links, like Mod.authors / authorPages / support. */
  authors?: string[];
  authorPages?: Mod["authorPages"];
  support?: Mod["support"];
}

export interface Note {
  topic: string;
  text: string;
  source: { type: "loverslab" | "discord" | "wiki"; url?: string };
}
