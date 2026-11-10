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
  /**
   * Rules players flagged as wrong, by rule id ("conflict|mod:a|mod:b"): only those 3+ players flagged or a maintainer
   * decided (a retired rule is already out of the catalog's relations; the app no longer shows it).
   */
  ruleFlags?: Record<string, RuleFlag>;
}

export interface StageLook {
  character: string;
  stages?: number;
  /** Its own model from the first turn: a reskin of the character never shows, so none is offered. */
  fromStart?: boolean;
  /** Mods that also replace the stage models, or that are no look of hers: they get no "until her first stage". */
  exempt?: string[];
  /** Mods that also change some textures the stages use. */
  partly?: string[];
  /** A picture of the stages. */
  image?: string;
}

export interface RuleFlag {
  /** Players who flagged it (one per install); set from 3 on. */
  flags?: number;
  /** retired = the rule is gone; kept = it stays, `answer` says why; changed = it stays, `answer` is its new reason. */
  decision?: "retired" | "kept" | "changed";
  answer?: string;
  date?: string;
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
   * derived = generated from a mod's own page: the mod plus everything it requires, ordered by tier,
   * community = a list a player shared from the app (see `community`),
   * vanilla = a legendary lord played in the game's own campaign: no mod is needed, the list is what fits the lord.
   */
  origin: "tested" | "guide" | "derived" | "community" | "vanilla";
  /** The factions (catalog tags, e.g. "wood elves") the lord leads; mods for them fit the list. */
  factions?: string[];
  /** The DLC the lord comes with, if any. */
  dlc?: string;
  phaseNote?: string;         // e.g. "switch only from corruption stage 5 on"
  /** English Markdown: what this campaign is about, what the list contains, how to play it. */
  description?: string;
  highlights?: string[];
  /** Mod ids whose images represent this preset (the app shows their covers). */
  coverMods?: string[];
  source: { type: "discord" | "loverslab" | "wiki" | "steam" | "derived" | "community"; url?: string; file?: string; author?: string; date?: string };
  /** In load order as given by the source: first entry = highest priority. */
  entries: PresetEntry[];
  /**
   * Changes the curator made to the source list because packs got newer versions since it was made
   * (moved to Steam, merged into one pack, fixed re-uploads). to = new pack file, or "removed".
   */
  modernized?: { from: string; to: string; note?: string }[];
  /**
   * A list about a group or subject rather than one character (e.g. "Daemons of Slaanesh"): the app shows it
   * under Themes instead of "Play as". Lists without it belong to their first playAs character.
   */
  theme?: string;
  /**
   * curator/launch_test.py started the game with exactly this list's packs (only kept while the list still has
   * the same packs): "main menu" = the game loaded every mod.
   */
  launchTest?: { result: string; game: string; date: string };
  /**
   * A community setup's own understanding of its mod, from the community's channel: what it recommends with it (the
   * app adds these first) and what runs against the setup's point (never suggested), each with the reason.
   */
  recommends?: { target: ModTarget; note?: string }[];
  avoid?: { target: ModTarget; note: string }[];
  /** What a mod does in this setup that a player should know before choosing it ("Good to know"): a lady you play yourself counting as won over. */
  tips?: { target: ModTarget; text: string }[];
  /** Players who played it with the app: "it worked" / "it didn't" (one vote per install; counted daily). */
  votes?: { up: number; down: number };
  /** A shared setup: the template it was built on, how far the sharer played, the game version, own packs by name. */
  community?: { base?: string; far?: string; game?: string; own?: string[] };
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
  /**
   * The mod changes a character's model by itself as a campaign goes on (read from its packs and scripts). A reskin of that
   * character usually only changes how she looks before her first stage; the app says so.
   */
  stageLooks?: StageLook[];
  /**
   * A reskin that replaces the units of these factions (catalog tags, e.g. "wood elves") wholesale. Two such reskins of the
   * same faction overwrite the same files (read from their packs), so a list takes one: the app offers them as the army's look.
   */
  factionLook?: string[];
  /**
   * Characters whose look the mod changes without being a reskin of theirs: an army pack that also replaces the faction's
   * lords (read from its pack). With it in a list, "no look" for such a character means this mod's look, not the game's.
   */
  alsoLooks?: string[];
  /** Mods whose files are all in this one with the same content (read from the packs): next to it they add nothing. */
  contains?: string[];
  /**
   * Characters whose look it changes by replacing the game's own model files, not the model definitions. Any other look of
   * hers (a reskin, an army pack's `alsoLooks`) points her to other models, so this one is then not visible.
   */
  baseModels?: string[];
  /** Offered among the editor's suggestions only, never part of a Play size (gameplay changes a player adds by choice); the reason. */
  suggestOnly?: string;
  /** The game does not start with it (the catalog's own launch test, manual.json "noTemplate"); it is never suggested. */
  stopsGame?: string;
  /** Newest date any of its sources gives (YYYY-MM-DD; a Discord post by its message id). Set by the build. */
  updated?: string;
  /** It changes game data (database tables or scripts), from the pack analyses or its kind. Set by the build. */
  changesData?: boolean;
  /** Date of a launch test after the last big game update with this mod in the list (main menu reached). Set by the build. */
  confirmed?: string;
  /** Script errors of the mod that are known and do no harm (script path + a text of the message); shown, not counted as errors. */
  harmlessScriptErrors?: { script: string; match: string; note: string }[];
  /** Fixes players shared for it (links and what to do), each accepted by a maintainer (community.json, type "fix"). */
  fixes?: CommunityFix[];
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

/** A fix a player shared for a mod that does not work as published; shown after a maintainer accepted it. */
export interface CommunityFix {
  id: string;                 // "fix-<issue number>"
  links: string[];
  steps: string;              // what a player has to do
  far?: string;               // how far the sharer got ("Played 20+ turns")
  game?: string;
  date: string;
  /** "It worked / it didn't" of players who used it. */
  votes?: { up: number; down: number };
}

export interface PackRef {
  file: string;               // e.g. "kerberos_mod_assets.pack"
  from: "steam" | "download";
  steamId?: string;
  optional?: boolean;
  exclusiveGroup?: string;
  /** LoversLab download that contains this pack, without extension (e.g. "@female_unit_cards_nsfw_1_5"); from the pack analysis. */
  archive?: string;
  /** Where this pack is downloaded when the mod's own page does not have it (e.g. a fixed version posted on Discord). */
  url?: string;
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
  /** For "requires": the pack of the target mod that is needed, when the target has versions (Community Beastmen full vs. light). */
  pack?: string;
  /** For a conditional "requires": it holds whenever this pack of the mod itself is loaded (from the condition text). */
  whenPack?: string;
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
