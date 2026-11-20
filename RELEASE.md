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

## Notes for 0.1.11

**WH3 Lewd Mod Manager 0.1.11 – a one-time thank-you. 18+ only.**

- After a game the app started ends cleanly – at least 20 minutes played, quit normally, no mod failed – a small bubble
  under *Support this app* asks once whether the app saved you time and points to Ko-fi. It never comes again, whatever
  you click. When the app asks "Did it work?" after the same game, the bubble only follows an "It worked".

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.10

**WH3 Lewd Mod Manager 0.1.10 – see how big downloads are doing. 18+ only.**

- Every download window (LoversLab, Nexus Mods, the LoversLab queue) shows the running download on top: percent, how much
  of how much, speed and time left; the window title and its taskbar button show it too.
- After a minute without data a hint says so: keep the window open, it goes on by itself – and if nothing moves for five
  minutes, download the file in your browser and drop it onto the app window.
- The LoversLab queue no longer gives up on a big file after 15 minutes while data is still coming; only a download that
  got nothing for 10 minutes is stopped.
- No more empty white window while LoversLab answers: the queue says it is opening LoversLab. A page that does not load
  says so, with *Reload* and *Open in your browser*.
- The download windows write what they do to `queue.log` in the app's data folder, for finding out why one did not work.

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.9

**WH3 Lewd Mod Manager 0.1.9 – details in Play's choices, no gameplay surprises in the big sizes. 18+ only.**

- *Play*: every mod in the "Which of these do you want?" step has a *details* link (its picture opens it too), so you can
  read what a mod you don't know does before you keep or untick it.
- From the catalog (no app update needed): *Bestial Gunners – Guns for Beastmen!* is no longer part of the Beastmen list's
  sizes. It rearms the whole faction with guns, and a player saw deformed models and an ammunition bar on melee Ungors
  with it; it stays available as a suggestion in the editor, with that note.
- The same goes for every list: the bigger sizes (Extended, Everything) no longer add gameplay mods – units, new lords and
  heroes, overhauls, skill trees – just because they fit the faction. Such a mod comes along only when the list's own mods
  or its community recommend it, community lists for the character use it, or it is made for the character; the editor
  still suggests the others.
- Profiles: once you picked a look for a character (another Morathi look instead of the list's), the suggestions no longer
  offer further looks that would only replace your pick. Looks for the list's own skins stay a choice.

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.8

**WH3 Lewd Mod Manager 0.1.8 – no more closing the app by mistake. 18+ only.**

- A mod's page closes with **← Close** at its top left, away from the window's own × in the corner.
- A picture opened large has its own **Close picture** button right below it (a click anywhere still closes it too).
- **Esc** closes what is open on top: the picture, then the mod's page, then a dialog. While you type in a field, Esc stays
  with the field, so nothing you wrote is lost.

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.7

**WH3 Lewd Mod Manager 0.1.7 – back button, get mods from the catalog, find mods in a profile. 18+ only.**

- **Back and forward:** the mouse's side buttons (and Alt+← / Alt+→) go back to where you were – the tab, a character's
  page and step in Play, the profile and its step, an open mod.
- **Catalog:** every mod has its own button. *Subscribe* for Steam Workshop mods, *Download* for LoversLab and Nexus Mods
  (in the app's own window, with your login), *Open post* for Discord files. What the mod needs comes along
  ("+ 2 it needs").
- **Add to profile ▾** next to it lists your profiles and says how the mod fits each: already in it, fits (and what comes
  along), the setup avoids it, conflicts with …, another character's campaign. *Add* puts it in the profile; the notice
  takes you to the install step. *New profile with this mod…* starts Play with it.
- **Profiles:** a search field below the steps finds a mod in the profile by its name or pack file – in the load order,
  the install list and the choices.

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.6

**WH3 Lewd Mod Manager 0.1.6 – a new app by the same maker. 18+ only.**

- *Play* shows a small card for the **Stellaris Lewd Playset Builder** (alpha), the same kind of app for Stellaris,
  with a link to its LoversLab page. Click × and it stays away.

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.5

**WH3 Lewd Mod Manager 0.1.5 – find a mod by its name. 18+ only.**

- *Add a mod of your own* (profile editor, step 1) now takes a mod's name as well as a Workshop link. Typing a name
  shows where that mod is: already in the profile (or switched off there – *Switch on*), among your installed mods
  (*Switch on*), or in the catalog (*Add*). It also finds a mod by its pack file name, and ignores case and
  punctuation ("grandolphs" finds "Grandolph's"). If the mod is not there, a link opens the Steam Workshop search
  for that name; paste the mod's link back into the field.

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.4

**WH3 Lewd Mod Manager 0.1.4 – Azazel in Play. 18+ only.**

- *Play as* now has **Azazel**: the Chaos route of Azazel's Realm (Readman's list and KPW's quick list) is her own
  character page instead of hiding in the *Chaos lords* theme. Her card also names the lords these lists play
  (Archaon, Be'lakor, a Daemon Prince) – the same goes for every character whose lists also play other lords.
- Lords' names follow the game's spelling everywhere (Be'lakor, N'Kari).

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.3

**WH3 Lewd Mod Manager 0.1.3 – see what your shared lists do. 18+ only.**

- *Play*: once players vote for a shared setup, the most popular one (at least 10 "it worked", more than "it didn't")
  stands as a fifth card next to the four sizes – *Community favourite* – and is chosen like one.
- *Community → Your shared setups*: every list you shared, with how many players said it worked or didn't (and why),
  how many use it, and whether a maintainer looked at it. *Edit your notes…* changes its name and words later.
- *Sent contributions* now say what became of them: in the catalog, waiting, or not added (with the reason); flagged
  rules say whether they were retired or kept.
- A *News* card at start tells you when something changed: your setup is in Play, more players said it worked, your
  suggestion was added.
- Importing a list from another launcher: when it plays another character than its closest template (Miao Ying through
  ATB), that character is kept and used when you share it.

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.2

**WH3 Lewd Mod Manager 0.1.2 – shared setups show up faster. 18+ only.**

- *Share your setup*: a setup with mods the catalog does not know appears within a day too, marked as *not reviewed*
  until a maintainer has looked at it, instead of waiting for that check. Its page says so; the votes show how it
  played for others.
- The catalog side changed as well (no app update needed for it): suggested mods that link to Steam, LoversLab or
  Nexus Mods are added on their own, and a rule enough players flagged as wrong falls by itself once the lists that go
  against it played well.

Windows only. Not code-signed: SmartScreen or your browser may warn once because the app is new
(*More info → Run anyway* / *Keep*).

## Notes for 0.1.1

**WH3 Lewd Mod Manager 0.1.1 – small fixes. 18+ only.**

- *Share your setup*: mods you added to a list by hand are now shared with their pack files. 0.1.0 sent their names
  instead; the catalog repairs setups shared that way, so nothing you already shared is lost.
- *Play*: *Themes* now come before *In the game's own campaign*.

The catalog keeps updating itself as before (new since 0.1.0, among others: Kerberos' Alarielle-Morathi expansion for ATB,
launch-tested with the Alarielle early game list). Windows only. Not code-signed: SmartScreen or your browser may warn
once because the app is new (*More info → Run anyway* / *Keep*); no antivirus engine on VirusTotal flagged 0.1.0.

## Notes for the first release (0.1.0)

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
- Every template and every size Play offers was launch-tested with game version 9.0.5 (2026-11-14/15): all 37 templates
  and 143 of 144 Play profiles (every size plus random choices) reach the main menu. The one that did not carried a mod
  part that no longer starts with the current game (the Miao Ying part of Miaoying(tit) & Katarin(tit)); it is now marked
  and never offered.

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
