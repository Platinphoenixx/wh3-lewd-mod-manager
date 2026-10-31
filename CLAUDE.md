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
`auto-new.json` < `part-*.json` < `followup-ll.json` < `followup-steam.json` < `followup-research.json`
< `followup-community.json` < `manual.json`; then `community.json` is applied on top.
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
- Never guess facts; mark uncertainty in `curation.confidence` / `openQuestions`. Texts neutral, non-graphic.
- Reading the Discord server is manual and must look like a person reading (no API, no automation).
  Discord's search only matches exact spellings: try several variants (apostrophes, spaces, underscores)
  and unique tokens (Steam/LL ids, pack file names, `from:`, `has:link in:`); "no hits" proves little.

## Conventions

- Load order: higher in the list = loaded later = wins.
- Old LoversLab `.pack` copies in the game's data folder shadow Workshop versions; see `cleanup` rules.
- Only non-explicit images may be stored in this repository; everything else is linked externally.
- Machine- or person-specific notes go into `CLAUDE.local.md` (gitignored), never into tracked files.
