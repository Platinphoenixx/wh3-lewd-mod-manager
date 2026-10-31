# WH3 Lewd Mod Manager

**18+ only.** A desktop app and a curated catalog for the adult ("lewd") mods of *Total War: Warhammer III* –
the LazyIcarus / Kerberos / Readman ecosystem and everything around it, scattered across LoversLab, the
Steam Workshop and Discord.

## What it does

- **Catalog** of the mods with descriptions, images, files, requirements, incompatibilities and load-order
  rules, collected from LoversLab, the Lewdhammer wiki, the community Discord and the Steam Workshop.
- **Profiles**: start from a community template (tested mod lists, KPW's per-character guides, or a template
  built from a mod's own requirements) and switch on every optional add-on that fits. Dependencies are
  added automatically, conflicts and "pick one" alternatives are shown, the load order is computed.
- **Installation check**: which mods of a profile are installed, which are missing, and old LoversLab packs
  in the data folder that would break their Steam versions.
- **Community**: suggest mods, report how a mod works for you, add rules (requires / incompatible /
  load order) and corrections – straight from the app as GitHub issues. Your own rules apply locally at once.

The app never contacts LoversLab, Steam or Discord on its own (only images are loaded from their sites).
It downloads one file, the catalog, at most once a day.

## How the catalog stays current

- A weekly GitHub Action re-reads LoversLab and the Steam Workshop, updates versions, dates, images and
  files, adds new mods as *unverified* entries and publishes a new catalog. No AI and no manual step needed.
- Maintainers review community issues; labelling one `accepted` applies it to the catalog automatically.

## Building

```
cd app
npm install
node node_modules/electron/install.js   # if npm skipped Electron's install script
npm run build
npm run start
```

Catalog pipeline (Python 3.12+): `pip install -r curator/requirements.txt`, then `python curator/update.py`.
See `CLAUDE.md` for the data layout.

## Credits

All mods belong to their authors. This project only links to them and summarises their pages; download
mods from their original pages and support the authors there.
