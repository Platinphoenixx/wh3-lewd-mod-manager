# WH3 Lewd Mod Manager

Desktop app plus a curated catalog for the scattered adult ("lewd") mods of Total War: Warhammer 3:
catalog with dependencies and images, campaign profiles with every optional add-on, installation check,
community contributions. App UI and catalog texts are English.

## Layout

- `catalog/catalog.json` – the generated catalog the app reads; types in `catalog/schema.ts`.
- `app/` – Electron 45 + electron-vite + React 19 + TypeScript.
  - `src/main/` game/Workshop detection and pack scan (`game.ts`), catalog loading with daily ETag update
    check (`catalog.ts`), JSON storage of profiles/settings/rules/contributions in the app's userData (`store.ts`)
  - `src/shared/match.ts` installed packs ↔ catalog, preset status, stale data packs (tested)
  - `src/shared/profile.ts` profile builder: options per template, dependencies, conflicts,
    alternatives (exclusiveGroup), load order (tested)
  - `src/shared/community.ts` user rules (applied locally) and GitHub issue contributions (tested)
  - `src/main/pack.ts` reader for .pack indexes (PFH5/PFH6: header, dependency list, file index, RPFM's
    dependency note; never reads file data otherwise), cached per file (tested)
  - `src/shared/conflicts.ts` overlaps between packs: same file path = real override (higher pack wins);
    same database table = hint only, tables most packs use are ignored (tested)
  - Install + launch: `src/shared/install.ts` picks the source per missing entry (Steam > LoversLab >
    Discord > manual, tested); `src/main/steamWorker.ts` is a separate utilityProcess that uses
    steamworks.js as app 1142710 to subscribe/download and then exits (`steam.ts` drives it);
    `src/main/installer.ts` installs .pack/.7z/.zip/.rar into data (7zip-bin, node-unrar-js), records
    them in userData/installed.json, moves stale packs to userData/backup, and opens LoversLab in its own
    window (persistent partition) to catch the download; with the setting `autoLoversLab` one window
    downloads all missing LL mods of a profile in a row (`downloadQueueFromLoversLab`; file choice via
    `PackRef.archive` + `pickDownloads` in `src/shared/install.ts`, else the player picks; any wait is
    LoversLab's own in that window, the app adds none and never gets around it); `src/shared/launch.ts` + `src/main/launch.ts`
    write `wh3lmm_mods.txt` (add_working_directory per Workshop folder, `mod "x.pack";` in priority
    order, first line wins – confirmed in game) and start `Warhammer3.exe wh3lmm_mods.txt;` with
    `SteamAppId` set (without it the game restarts through Steam and the CA launcher drops the list).
    Packs the app installed are matched to their mod via userData/installed.json.
  - Own mods (installed packs the catalog does not know): `src/shared/own.ts` keys them
    (`steamId:<id>` / `pack:<file>`), collects pack facts (dependencies, shared files, tables) and places
    them in a profile's load order with a reason; user moves are stored as `Profile.pins` (tested).
    `renderer/src/OwnMods.tsx`: "Your mods" cards, drop-to-install, Workshop link. Titles of unknown
    Workshop items come from the player's Steam client once (userData/workshop-details.json);
    previews via the `wh3lmm://workshop/<id>` protocol.
  - `src/shared/importlist.ts`: mod lists of the CA launcher (`Launcher/20190104-moddata.dat`, `.twmods`)
    and the WH3 Mod Manager (`wh3mm/config.json`) become a profile on the closest template (tested).
    `src/shared/health.ts`: mods that change game data and are older than the last major game update
    (`catalog.gameUpdates`, read by update.py from the game's Steam announcements; hotfixes excluded),
    and script errors from `lua_mod_log.txt` mapped to their packs (tested).
  - Dev/test: `WH3LMM_USER_DATA=<folder>` uses throwaway app data; `--tab=profiles-order` (or any tab)
    opens a view directly.
  - `src/renderer/` UI; commands in `app/`: `npm run typecheck`, `npm test`, `npm run build`, `npm run start`
  - Release defaults (catalog URL, contribution repo) live in `DEFAULTS` in `src/shared/api.ts`.
- `curator/` – Python pipeline that builds the catalog (`pip install -r curator/requirements.txt`).

## Maintenance without AI (the default)

The project must keep working without anyone's AI subscription.
- `.github/workflows/update-catalog.yml` (weekly): `curator/update.py` re-crawls the LoversLab club,
  refreshes public Steam data, adds automatic entries for uncurated mods (`curator/work/auto-new.json`,
  confidence low), rebuilds the catalog, writes `CHANGES.md`, commits. Versions/dates always come fresh
  from the raw data on every build.
- `.github/workflows/apply-contribution.yml`: a maintainer labels an app-created issue `accepted` →
  `curator/apply_contribution.py` records it in `curator/community.json` → `build_catalog.py` applies it
  (rules → relations/load order, feedback → counters + known issues, corrections → community notes,
  new mods → unverified entries).
- Apps download only `catalog.json` (at most daily, ETag); they never query LoversLab/Steam/Discord
  except for showing images.

## Optional curation (by hand or with an AI assistant)

Curated data is layered; later layers override earlier ones field by field (a field is replaced whole):
`auto-new.json` < `part-*.json` < `followup-ll.json` < `followup-steam.json` < `followup-research.json` < `followup-review.json`
< `followup-archives.json` < `followup-community.json` < `manual.json`; then `community.json` is applied
on top. Texts (`description`, `summary`, `recommendedFor`, `features`) come from `desc-*.json`, which win
over all layers – fix texts there.
- `curator/analyze_pack.py` – reads a mod's .pack files (index + reference files only): file list,
  declared dependencies, tables, and which packs provide the models/materials/textures it refers to
  (`--with` suspected requirements, `--vanilla` the game's data folder) → `curator/raw/packs/<mod>.json`.
  Findings go into `followup-archives.json`. `build_catalog.py` takes pack names (when the curated
  entry has none) and pack-header dependencies from these files; `curator/pack_report.py` summarises
  all analyses (cross-mod file needs, shared files) into `work/pack-report.md` (local).
- `curator/crawl_ll.py` – LoversLab club → `curator/raw/ll/` (page text with `[[SPOILER]]` and `[img …]`
  markers, images, Steam ids). LL pages need a full browser user agent; downloads need a login.
- `curator/raw/steam_items.json` (public Workshop API), `steam_hidden.json` (pages only visible when
  logged in), `ll_files.json` (download lists, read with a login without downloading anything).
- `curator/work/part-*.json` structured entries (ids `ll-<file id>`, `steam-<id>`, `dc-<slug>`),
  `desc-*.json` long texts + image captions, `preset-desc.json` template texts, `kpw.json` per-character
  guides, `discord-mods.json` Discord-only mods, `followup-*.json` later passes.
- `curator/manual.json`: `packAliases`, `refAliases` (free-text names → mod), `mergeMods` (duplicates),
  `externalToMod`, `mods` overrides (incl. `cleanup` rules for stale LoversLab packs).
- `curator/parse_twmods.py` turns CA launcher mod lists (.twmods) into tested presets.
- `curator/build_catalog.py` → `catalog/catalog.json` + `curator/work/report.md`. It also derives presets
  from KPW guides and from campaign/progression mods' requirements, so templates follow the catalog.
- `curator/work/part-5.json`: Workshop finds from the Discord research and the Steam items they refer to.
  Tags: `general` = normal gameplay/UI/visual mods players combine with the lewd ones (own group in
  profiles, "Content" filter in the catalog), `beautification` = reskins without nudity.
  `work/research-steam-skipped.txt` lists what is deliberately not in the catalog, with the reason.
- Never guess facts; mark uncertainty in `curation.confidence` / `openQuestions`. Texts neutral, non-graphic.
- Reading the Discord server is manual and must look like a person reading (no API, no automation).
  Discord's search only matches exact spellings: try several variants (apostrophes, spaces, underscores)
  and unique tokens (Steam/LL ids, pack file names, `from:`, `has:link in:`); "no hits" proves little.

## Conventions

- Load order: higher in the list = loaded later = wins.
- Old LoversLab `.pack` copies in the game's data folder shadow Workshop versions; see `cleanup` rules.
- Only non-explicit images may be stored in this repository; everything else is linked externally.
- Machine- or person-specific notes go into `CLAUDE.local.md` (gitignored), never into tracked files.
