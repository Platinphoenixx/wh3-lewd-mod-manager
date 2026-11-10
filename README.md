# WH3 Lewd Mod Manager

**18+ only.** A desktop app and a curated catalog for the adult ("lewd") mods of *Total War: Warhammer III* –
the LazyIcarus / Kerberos / Readman ecosystem and everything around it, scattered across LoversLab, the
Steam Workshop, Nexus Mods and Discord.

## What it does

- **Catalog** of the mods with descriptions, images, files, requirements, incompatibilities and load-order
  rules, collected from LoversLab, Nexus Mods, the Lewdhammer wiki, the community Discord and the Steam Workshop.
- **Profiles**: start from a community template (tested mod lists, KPW's per-character guides, a template
  built from a mod's own requirements, or a lord in the game's own campaign with the looks and add-ons that fit) and go through three steps: choices, install, load order & play.
  Switch on every optional add-on that fits. Dependencies are
  added automatically, conflicts and "pick one" alternatives are shown, the load order is computed.
  Your own mods (packs the catalog does not know) are read and placed in the load order with a reason.
  *Fill this profile* suggests lewd and general mods that fit the character and that other players combine
  with it; mods that exclude each other come as a pick-one choice. When several versions of one mod are
  installed (for example with or without futa models, or another language), only the one you choose is loaded.
- **Made by**: every template and profile shows who made the mods in it, what each of them added, and
  their support pages (Patreon, Ko-fi, …) – so you can find and support the people behind what you liked.
- **Install and play**: subscribes Workshop items through Steam, downloads LoversLab files in a LoversLab
  window with your own login, Nexus Mods files in a Nexus window (Premium downloads start at once), moves old
  packs that would shadow newer versions to a backup folder, and
  starts the game with exactly the profile's load order.
- **Problems**: after the game closes, script errors from the game's log are shown per mod, with a report
  for the modder (game version, differences from the template, outdated mods, file overlaps).
- **Community**: suggest mods, report how a mod works for you, add rules and corrections. Your own rules
  apply locally at once.

## Install

1. Download the latest version from [Releases](../../releases): the **Setup** file installs the app, the
   **portable** file runs without installing.
2. The app is not code-signed, so Windows SmartScreen may warn on first start: *More info → Run anyway*.
3. Start it; it finds Steam and the game by itself (otherwise choose the game folder in *Settings*).

A new version is announced inside the app; nothing updates or installs by itself.

## What the app talks to

- **GitHub**, at most once a day: the catalog (only when it changed) and whether a new app version exists.
- **Steam, LoversLab, Nexus Mods** only when you install a mod (Workshop subscriptions through your Steam client,
  the LoversLab or Nexus download page in a window with your login). Images are loaded from their sites.
- **The project's relay** only when you press *Send*: a suggestion becomes a GitHub issue without needing
  a GitHub account; a problem report is stored privately and only counted (an error shows up in the
  catalog once three or more players reported it). You see exactly what is sent first; no names, no IP
  addresses, and Windows user names and folders are removed from reports. See [`relay/`](relay/).

## How the catalog stays current

- A weekly GitHub Action re-reads LoversLab and the Steam Workshop, updates versions, dates, images and
  files, adds new mods as *unverified* entries and publishes a new catalog. No AI and no manual step needed.
- Maintainers review community issues; labelling one `accepted` applies it to the catalog automatically.

## Building

```
cd app
npm install
node node_modules/electron/install.js   # if npm skipped Electron's install script
npm run build && npm run start          # run from source
npm run dist                            # Windows installer + portable exe in app/release/
```

Catalog pipeline (Python 3.12+): `pip install -r curator/requirements.txt`, then `python curator/update.py`.
See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the data layout and [`RELEASE.md`](RELEASE.md) for publishing a version.

## Credits

All mods belong to their authors. This project only links to them and summarises their pages; download
mods from their original pages and support the authors there.
