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

- Catalog of the lewd mods for Total War: Warhammer III (LoversLab, Steam Workshop, Nexus Mods, Discord) with
  requirements, conflicts, load-order rules and images.
- *Play*: pick a character or a theme, choose how much content (from the essentials to everything that fits), then
  the app walks you through the choices with pictures – looks, add-ons, heroes – and installs the result.
- Lords no mod makes playable (the Sisters of Twilight, Repanse, Neferata, Hellebron …) in their own campaign: their
  look, the army's look and the add-ons that work in any campaign, as the same guided choices.
- Share a setup that works for you with one click; after playing, say whether it worked. The best rated setups
  show up on the character's page.
- Profiles from tested community lists and guides in three steps (choices, install, play), with every optional add-on; your own mods are placed
  in the load order with a reason.
- *Fill this profile*: suggested lewd and general mods that fit, with pick-one choices for mods that
  exclude each other; a reskin says which look in your list it would replace, and only what players of the
  list really use is selected for you.
- Every template is launch-tested: it reaches the main menu with game version 9.0.4.
- Import a list that works for you from the CA launcher or the WH3 Mod Manager: it stays as you played it, the app says what the
  catalog would warn about and why, and suggests other looks and add-ons that fit. Flag any rule you know to be wrong.
- *Made by*: who made what in each list, with their support pages.
- Installs Workshop items through Steam, LoversLab and Nexus Mods files with your own login; starts the game
  with the profile's load order, loading only the version you chose when a mod comes in several.
- Script errors after a game session, with a ready-made report for the modder.
- Suggestions and problem reports without a GitHub account.

Windows only. Not code-signed: SmartScreen may ask once (*More info → Run anyway*).
