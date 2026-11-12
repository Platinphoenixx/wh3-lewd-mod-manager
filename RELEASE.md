# Releasing a version

The app checks GitHub's *latest release* once a day and shows a card when a newer version exists, so a
release is all it takes for players to hear about it.

1. Raise `version` in `app/package.json` (e.g. `0.1.0` → `0.2.0`).
2. Check: `cd app && npm run typecheck && npm test && node ../relay/worker.test.mjs`.
3. Build: `npm run dist` → `app/release/WH3-Lewd-Mod-Manager-Setup-<version>.exe` and
   `WH3-Lewd-Mod-Manager-<version>-portable.exe`. Start the portable one once to check it opens.
4. Commit and push the version bump.
5. Publish (tag `v<version>`, the two exe files, notes below):
   ```
   gh release create v0.2.0 app/release/WH3-Lewd-Mod-Manager-Setup-0.2.0.exe app/release/WH3-Lewd-Mod-Manager-0.2.0-portable.exe --title "0.2.0" --notes-file notes.md
   ```
   The catalog is bundled as of the build; the app downloads newer catalogs by itself.

## Notes for the first release (draft, 0.1.0)

**WH3 Lewd Mod Manager 0.1.0 – first public version. 18+ only.**

One place for the lewd mods of Total War: Warhammer III, scattered across LoversLab, the Steam Workshop, Nexus Mods
and Discord: what each mod does, what it needs, what it does not go with, and a list that starts.

**Pick and play**
- *Play*: pick a character or a theme, then how much you want – Essentials, Full campaign (recommended), Extended or
  Everything – and the app walks you through the choices with pictures: her look, the army's look, add-ons, heroes.
  It says what vouches for each size (played by its author, launch-tested) and saves an ordinary profile you can
  change at any time.
- Where options go together (an army pack with a few extra units), you can tick several; where they exclude each
  other, the card says why ("both dress the same units").
- Mods whose look changes as a campaign goes on (Alarielle's eight stages, Lazy's corruption stages) are told apart
  from a look that only lasts until the first stage.
- Lords no mod makes playable (the Sisters of Twilight, Repanse, Neferata, Hellebron, Teclis …) in their own
  campaign: their look, the army's look and the add-ons that work in any campaign. *Good to know* says what a mod
  does when you play one of its ladies yourself.
- *Play with a mod…*: search a mod by name or link and see every setup it belongs to or fits; a mod the game does not
  start with offers the setups without it and the fixes players shared.

**Install and launch**
- Workshop items are subscribed through Steam; LoversLab and Nexus Mods files are downloaded in the app's own window
  with your login (the missing LoversLab files of a profile in one go); the window says which file to take.
- *Files you already have*: packs and archives in your Downloads (or folders you choose) are found and installed
  instead of downloaded again.
- Old copies that would shadow a newer version are moved to a backup folder. The game starts with exactly the
  profile's load order, loading only the version you chose when a mod comes in several.
- Every template and every size Play offers was launch-tested: it reaches the main menu with game version 9.0.5.
  *(Fill in the result of the launch test before publishing.)*

**Your own lists**
- Import a list that works for you from the CA launcher or the WH3 Mod Manager: it stays as you played it, the
  *Check* tab says what the catalog would warn about and why, *Ideas* suggests other looks and add-ons that fit.
- Your own mods (packs the catalog does not know) are read and placed in the load order with a reason.
- *Fill this profile*: lewd and general mods that fit, ranked by what ties them to your list; a reskin says which
  look in your list it would replace.

**Community**
- Share a setup that works for you; after a session, one click says whether it worked. The best rated setups show up
  on the character's page.
- Flag any rule you know to be wrong; three players flagging it mark it as disputed, and a maintainer decides.
- Suggest a mod, a correction or a fix for a mod that does not start – no GitHub account needed.
- *Made by*: who made what in each list, with their support pages.

**When something goes wrong**
- After a game session, script errors are shown per mod (known harmless ones apart), with a ready-made report for the
  modder; your user name and folders are removed from it.

The catalog updates itself (at most daily); a new app version is announced in the app, nothing updates by itself.
Windows only. Not code-signed: SmartScreen may ask once (*More info → Run anyway*).
