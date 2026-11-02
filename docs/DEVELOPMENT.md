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
  - `src/shared/suggest.ts` "Fill this profile" (tested): lewd and general mods that fit the template (same
    character/faction, recommended by or extending profile mods) and that community lists for the same
    character use; Workshop subscribers / LoversLab downloads (refreshed weekly) break ties. Never conflicts,
    removed template mods or other characters' campaigns. Suggestions that exclude each other (incompatible,
    versions of one add-on, reskins of the same character) come as one "pick one" choice. UI: `renderer/src/Suggestions.tsx`.
  - `src/renderer/src/Creators.tsx` credits: every creator whose mod is in a profile (makers of the template's
    campaign/progression/framework mods first), with support links (Patreon, Ko-fi, …) and author pages that
    `build_catalog.py` takes from the mods' own pages; Workshop uploader names come from
    `curator/raw/steam_creators.json` (refreshed by `update.py`).
  - `src/main/pack.ts` reader for .pack indexes (PFH5/PFH6: header, dependency list, file index, RPFM's
    dependency note; never reads file data otherwise), cached per file (tested)
  - `src/shared/conflicts.ts` overlaps between packs: same file path = real override (higher pack wins);
    same database table = hint only, tables most packs use are ignored (tested)
  - Install + launch: `src/shared/install.ts` picks the source per missing entry (Steam > LoversLab >
    Discord > manual, tested); `src/main/steamWorker.ts` is a separate utilityProcess that uses
    steamworks.js as app 1142710 to subscribe/download and then exits (`steam.ts` drives it);
    `src/main/installer.ts` installs .pack/.7z/.zip/.rar into data (7zip-bin, node-unrar-js), records
    them in userData/installed.json, moves stale packs to userData/backup, and opens LoversLab in its own
    window (persistent partition) to catch the download; the window's boxes say which file to take
    (`downloadHints`/`packHints`; Nexus files are matched through their content previews) and the
    sign-in box shows only while signed out; a window closes after the files the profile needs. Unless
    the setting `autoLoversLab` is false, one window
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
  - Problem reports: `src/shared/report.ts` (tested) builds a Markdown report for modders from a launch
    snapshot (`userData/last-launch.json`, written by ▶ Play: load order, origin base/extra/own, template,
    game version from Warhammer3.exe + Steam build) and the script log: differences from the template, mods
    older than the last major update, file overlaps; user names and local folders are replaced
    (`anonymize`). Main sends `game:exited` when a started game closes; the app then reads the log again.
    UI: `ReportDialog.tsx` (copy for Discord / full / save), `Notices.tsx` (message cards with action and
    timer), tab counters (`setTabCount`), image placeholders while loading (`data-done`, set in `main.tsx`).
  - Made by (`renderer/src/Creators.tsx`): one line per creator of a template/profile with their mods, what
    those do, and one ♥ Support menu; `build_catalog.py` marks support links that belong to someone credited on
    another author's page (`support[].owner`).
  - Sending without an account: `relay/` (Cloudflare Worker, setup in `relay/README.md`, tests
    `node relay/worker.test.mjs`) stores problem reports privately and files contributions as GitHub issues;
    the app posts from the main process (`relay:report`, `relay:contribution`, `DEFAULTS.relayUrl`, random
    install id in userData/install-id.json).
  - Nexus Mods: entries read by hand from nexusmods.com (`curator/raw/nexus/list-*.txt`, curated with neutral texts
    in `curator/work/nexus-curation.json`, mirrors of catalog mods only get `sources.nexus`). Its `details` hold what a
    mod page itself says (version, packs from the file previews with pick-one groups, requirements, conflicts, load
    order, known issues, support) and replace the list-page guesses. No automatic Nexus
    crawl: its numbers stay as read. The app downloads Nexus files in its own window (`persist:nexus`, like
    LoversLab), with the player's browser as fallback.
  - Dev/test: `WH3LMM_USER_DATA=<folder>` uses throwaway app data; `--tab=profiles-order` (or any tab)
    opens a view directly.
  - `src/renderer/` UI; commands in `app/`: `npm run typecheck`, `npm test`, `npm run build`, `npm run start`, `npm run dist`
    (electron-builder: Windows installer + portable exe in app/release/, see RELEASE.md). `src/main/appUpdate.ts` asks
    GitHub's latest release at most daily and the app shows a card when it is newer; it never updates itself.
  - Release defaults (catalog URL, contribution repo) live in `DEFAULTS` in `src/shared/api.ts`.
- `curator/` – Python pipeline that builds the catalog (`pip install -r curator/requirements.txt`).

## Maintenance (automatic, the default)

The project keeps itself current without anyone's manual work or paid service.
- `.github/workflows/update-catalog.yml` (weekly): `curator/update.py` re-crawls the LoversLab club,
  refreshes public Steam data, adds automatic entries for uncurated mods (`curator/work/auto-new.json`,
  confidence low), rebuilds the catalog, writes `CHANGES.md`, commits. Versions/dates always come fresh
  from the raw data on every build.
- `curator/fetch_reports.py` (called by update.py when the secrets RELAY_URL / RELAY_EXPORT_TOKEN exist) writes
  only counts per error to `curator/raw/error_reports.json`; build_catalog.py makes errors reported by 3+ players
  a known issue of the mod until the mod is updated.
- `.github/workflows/apply-contribution.yml`: a maintainer labels an app-created issue `accepted` →
  `curator/apply_contribution.py` records it in `curator/community.json` → `build_catalog.py` applies it
  (rules → relations/load order, feedback → counters + known issues, corrections → community notes,
  new mods → unverified entries).
- Apps download only `catalog.json` (at most daily, ETag); they never query LoversLab/Steam/Discord
  except for showing images.

## Optional curation (by hand)

Curated data is layered; later layers override earlier ones field by field (a field is replaced whole):
`auto-new.json` < `part-*.json` < `followup-ll.json` < `followup-steam.json` < `followup-research.json` < `followup-review.json`
< `followup-archives.json` < `followup-discord.json` < `followup-community.json` < `manual.json`; then `community.json` is applied
on top. In a layer, `"field+": [...]` appends to a list field and `"field-": [...]` drops the items that contain one of
the texts (relations/packs: by target mod, pack, Steam id or file), so a later pass can retire a fixed warning without
repeating the whole list. `followup-discord.json` holds the facts of the Discord pass (2026-11-02: the mod's author, a
Modder-role member or several players; never a single report). Relations and known issues from `discord-mods.json` are
added after the layers, so fix those in that file. Texts (`description`, `summary`, `recommendedFor`, `features`) come from `desc-*.json`, which win
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
- `curator/work/part-6.json`: mods found in the Discord pass of 2026-11-02, each checked against its Workshop data.
- Never guess facts; mark uncertainty in `curation.confidence` / `openQuestions`. Texts neutral, non-graphic.
- Reading the Discord server is manual and must look like a person reading (no API, no automation).
  Discord's search only matches exact spellings: try several variants (apostrophes, spaces, underscores)
  and unique tokens (Steam/LL ids, pack file names, `from:`, `has:link in:`); "no hits" proves little.

## Conventions

- Load order: higher in the list = loaded later = wins.
- Old LoversLab `.pack` copies in the game's data folder shadow Workshop versions; see `cleanup` rules.
- Only non-explicit images may be stored in this repository; everything else is linked externally.
- Machine- or person-specific notes stay in local, gitignored files, never in tracked files.
