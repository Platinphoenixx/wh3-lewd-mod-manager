"""Launch test of the catalog's templates: does the game reach the main menu with exactly a template's packs?

    python launch_test.py plan --game "<...>/Total War WARHAMMER III" [--packs <folder> ...] [--only id,id]
    python launch_test.py run  --game "<...>/Total War WARHAMMER III" [--packs <folder> ...] [--only id,id]

`--presets <file>` adds lists that are not templates (the profiles Play makes from each size, see the dev tools); their
results stay in <work>/results.json. `plan` only lists, per template, where each pack comes from and what is missing. `run` starts the game once per
template: the packs are hard-linked (no copies; same drive as the Steam library) into <work>/<template>/packs, the
game gets that one working directory through its own list file (wh3lmm_test.txt; the player's lists and the data
folder stay as they are), and the run waits for the main menu (the mod loading block in lua_mod_log.txt), a crash
dump, the game's database report (crash_report/bad_mods_report.txt: first invalid record, table and pack), an error
dialog or a timeout. Then the game is closed and the next template starts. The intro video is switched off for the
run and back afterwards. Per template <work>/<template>/ keeps result.json, the game's report, the script log and a
screenshot of the game's monitor; all results are in <work>/results.json. Each result also goes into
curator/raw/launch_results.json (game version, date, a fingerprint of the template's packs), which the catalog build
uses to mark templates as launch-tested while they still have exactly those packs.

Packs come from the Workshop items the catalog names (Steam must run and the items must be downloaded) and from the
--packs folders (LoversLab/Nexus/Discord downloads, unpacked; searched recursively). Of several copies of a pack the
newest wins (for files under a folder named after a Discord message id, the message date). Windows only.
"""
import argparse
import collections
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WATCH = ROOT / "launch_test_watch.ps1"
APPDATA = Path(os.environ.get("APPDATA", ""))
PREFS = APPDATA / "The Creative Assembly" / "Warhammer3" / "scripts" / "preferences.script.txt"
CRASH = APPDATA / "The Creative Assembly" / "Warhammer3" / "crash_report"
LIST_NAME = "wh3lmm_test.txt"
TIMEOUT = 8 * 60

catalog = json.loads((ROOT.parent / "catalog" / "catalog.json").read_text("utf-8"))
MODS = {m["id"]: m for m in catalog["mods"]}
EXT = {e["id"]: e for e in catalog["external"]}
req_path = ROOT / "raw" / "steam_required.json"
COLLECTIONS = set(json.loads(req_path.read_text("utf-8")).get("collections", [])) if req_path.exists() else set()
norm = lambda n: re.sub(r"[^a-z0-9]", "", n.lower())
RESULTS = ROOT / "raw" / "launch_results.json"
MOD_RESULTS = ROOT / "raw" / "launch_mods.json"


def fingerprint(preset: dict) -> str:
    """The template's packs, order-free: a result counts only while the template still has exactly these packs."""
    return hashlib.sha1("\n".join(sorted(e["pack"].lower() for e in preset["entries"])).encode()).hexdigest()[:12]


def game_version(game: Path) -> str:
    out = subprocess.run(["powershell", "-NoProfile", "-Command", f"(Get-Item '{game / 'Warhammer3.exe'}').VersionInfo.ProductVersion"],
                         capture_output=True, text=True, timeout=60).stdout.strip()
    return ".".join(out.split(".")[:3]) or "unknown"


def record(r: dict, fp: str, game: str):
    data = json.loads(RESULTS.read_text("utf-8")) if RESULTS.exists() else {}
    data[r["id"]] = {"result": r["result"], "game": game, "date": datetime.date.today().isoformat(), "fingerprint": fp,
                     "scriptErrors": len(r.get("scriptErrors", []))}
    RESULTS.write_text(json.dumps(dict(sorted(data.items())), ensure_ascii=False, indent=1) + "\n", "utf-8", newline="\n")


def record_mods(preset: dict, game: str):
    """Every mod of a list that reached the main menu: confirmed for this game version (the build compares the date with
    the last big game update, so the confirmation lapses by itself)."""
    data = json.loads(MOD_RESULTS.read_text("utf-8")) if MOD_RESULTS.exists() else {}
    today = datetime.date.today().isoformat()
    for e in preset["entries"]:
        mid = (e.get("target") or {}).get("mod")
        if mid:
            data[mid] = {"game": game, "date": today}
    MOD_RESULTS.write_text(json.dumps(dict(sorted(data.items())), ensure_ascii=False, indent=1) + "\n", "utf-8", newline="\n")


def snowflake_date(name: str) -> str:
    """Date of a Discord message id at the start of a file or folder name ("<id>_<file>")."""
    m = re.match(r"(\d{17,20})_", name)
    if not m:
        return ""
    return datetime.datetime.fromtimestamp(((int(m.group(1)) >> 22) + 1420070400000) / 1000, datetime.timezone.utc).date().isoformat()


class Packs:
    """Every pack file available: Workshop items by id, the --packs folders by (cleaned) file name."""

    def __init__(self, workshop: Path, folders: list):
        self.workshop = workshop
        self.workshop_names = None
        self.by_name = collections.defaultdict(list)  # lower name -> [(path, date)]
        self.by_norm = collections.defaultdict(list)  # Discord exports drop "!", "@", brackets: also by letters only
        for folder in folders:
            for p in Path(folder).rglob("*.pack"):
                date = snowflake_date(p.name) or snowflake_date(p.parent.name) or \
                    datetime.date.fromtimestamp(p.stat().st_mtime).isoformat()
                name = re.sub(r"^\d{17,20}_", "", p.name)
                self.by_name[name.lower()].append((p, date))
                self.by_norm[norm(name)].append((p, date))

    def find(self, pack: str, steam_ids: list, mod_id: str = ""):
        for sid in steam_ids:
            p = self.workshop / sid / pack
            if p.exists():
                return p
        for sid in steam_ids:  # same name, other spelling of the case
            d = self.workshop / sid
            hit = next((p for p in d.glob("*.pack") if p.name.lower() == pack.lower()), None) if d.exists() else None
            if hit:
                return hit
        hits = self.by_name.get(pack.lower()) or self.by_norm.get(norm(pack)) or []
        # Two mods can ship a pack of the same name (an old upload and its successor): the copy from the mod's own
        # archive folder (ll/<id>, nexus/<id>) wins.
        own = re.match(r"(ll|nx)-(\d+)$", mod_id or "")
        if own:
            folder = ("ll" if own.group(1) == "ll" else "nexus", own.group(2))
            mine = [h for h in hits if any(a == folder[0] and b == folder[1] for a, b in zip(h[0].parts, h[0].parts[1:]))]
            hits = mine or hits
        if hits:
            return max(hits, key=lambda h: h[1])[0]
        # A mod whose own page names no Workshop item but whose pack a subscribed item has (a LoversLab page of a
        # mod that moved to Steam): any Workshop folder with that file.
        if self.workshop_names is None:
            self.workshop_names = {}
            for f in self.workshop.glob("*/*.pack") if self.workshop.exists() else []:
                self.workshop_names.setdefault(f.name.lower(), f)
        return self.workshop_names.get(pack.lower())


def needed_packs(mod: dict) -> list:
    """Packs an entry that names only its mod stands for: non-optional, the first of each pick-one group."""
    out, groups = [], set()
    for p in mod.get("packs") or []:
        g = p.get("exclusiveGroup")
        if p.get("optional") or (g and g in groups):
            continue
        groups.add(g)
        out.append(p)
    return out


def plan(preset: dict, packs: Packs) -> dict:
    files, missing, notes, seen = [], [], [], set()

    def add(pack, steam_ids, label, mod_id=""):
        path = packs.find(pack, steam_ids, mod_id)
        if not path:
            missing.append(f"{pack} ({label})")
            return
        name = path.name if path.name.lower() == pack.lower() else pack  # the name the mod line uses
        if name.lower() not in seen:
            seen.add(name.lower())
            files.append({"pack": name, "path": str(path), "for": label})

    for e in preset["entries"]:
        t = e.get("target") or {}
        mod = MODS.get(t.get("mod")) or EXT.get(t.get("external")) or {}
        label = mod.get("name") or e.get("pack")
        sids = [s["id"] for s in (mod.get("sources") or {}).get("steam") or []] + ([e["steamId"]] if e.get("steamId") else []) \
            + ([mod["steamId"]] if mod.get("steamId") else [])
        if any(s in COLLECTIONS for s in sids):
            notes.append(f"{label}: Steam collection, skipped")
            continue
        if (e.get("pack") or "").lower().endswith(".pack"):
            add(e["pack"], sids, label, t.get("mod", ""))
            continue
        notes.append(f"{label}: the template names the mod, not a pack; using its default packs")
        for p in needed_packs(mod):
            add(p["file"], sids + ([p["steamId"]] if p.get("steamId") else []), label, t.get("mod", ""))
        if not needed_packs(mod):
            for s in sids:
                for p in sorted((packs.workshop / s).glob("*.pack")) if (packs.workshop / s).exists() else []:
                    add(p.name, [s], label)
    return {"id": preset["id"], "name": preset["name"], "origin": preset.get("origin"), "files": files, "missing": missing, "notes": notes,
            "fingerprint": fingerprint(preset)}


def ps(*args) -> str:
    return subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(WATCH), *args],
                          capture_output=True, text=True, encoding="mbcs", errors="replace", timeout=60).stdout


def read_when_free(path: Path) -> str:
    for _ in range(20):
        try:
            return path.read_text("utf-8", "replace")
        except PermissionError:  # the game keeps its report open until it is closed
            time.sleep(1)
    return "(could not be read: still in use)"


def set_intro(enabled: bool):
    t = PREFS.read_text("utf-8")
    PREFS.write_text(re.sub(r"fe_game_intro_video_enabled (true|false);", f"fe_game_intro_video_enabled {'true' if enabled else 'false'};", t), "utf-8")


def run_one(p: dict, game: Path, work: Path) -> dict:
    out = work / p["id"]
    if out.exists():
        shutil.rmtree(out)
    packs_dir = out / "packs"
    packs_dir.mkdir(parents=True)
    for f in p["files"]:
        try:
            os.link(f["path"], packs_dir / f["pack"])  # hard link: the same file, no copy
        except OSError:
            shutil.copy2(f["path"], packs_dir / f["pack"])  # another drive
    text = f'add_working_directory "{packs_dir.as_posix()}";\n' + "".join(f'mod "{f["pack"]}";\n' for f in p["files"])
    (game / LIST_NAME).write_text(text, "utf-8")
    (out / LIST_NAME).write_text(text, "utf-8")
    log = game / "lua_mod_log.txt"
    stamp = lambda: {f: (CRASH / f).stat().st_mtime for f in os.listdir(CRASH)} if CRASH.exists() else {}
    before = stamp()  # bad_mods_report.txt is rewritten each time: compare times, not names
    t0 = time.time()
    env = {**os.environ, "SteamAppId": "1142710", "SteamGameId": "1142710"}  # without them the game restarts through Steam
    proc = subprocess.Popen([str(game / "Warhammer3.exe"), f"{LIST_NAME};"], cwd=game, env=env)
    result, detail, windows = "timeout", f"{TIMEOUT} s", set()
    try:
        while time.time() - t0 < TIMEOUT:
            time.sleep(5)
            new = sorted(f for f, t in stamp().items() if before.get(f) != t)
            if new:
                time.sleep(3)
                result, detail = ("database error", "") if "bad_mods_report.txt" in new else ("crash", ", ".join(new))
                break
            if proc.poll() is not None:
                result, detail = "exited", f"game closed after {time.time() - t0:.0f} s"
                break
            wins = [w for w in ps("windows", "-ProcessId", str(proc.pid)).splitlines() if w.strip()]
            windows.update(wins)
            if any(w.startswith("#32770|") for w in wins):  # a standard Windows dialog: the game's error message
                time.sleep(2)
                result, detail = "error window", " / ".join(wins)
                break
            # The main menu loads mod scripts; the block ends with a line of stars ("Done loading mods!" is MCT's line).
            text = read_when_free(log) if log.exists() and log.stat().st_mtime > t0 else ""
            if "Done loading mods!" in text or re.search(r"Loading Mods[\s\S]*\n\*{10,}\s*$", text):
                time.sleep(20)  # let the main menu scripts finish
                result, detail = "main menu", f"after {time.time() - t0:.0f} s"
                break
        ps("shot", "-ProcessId", str(proc.pid), "-Out", str(out / "screen.png"))
    finally:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        time.sleep(5)
    if result == "database error":
        report = read_when_free(CRASH / "bad_mods_report.txt")
        detail = " | ".join(report.split())
        (out / "bad_mods_report.txt").write_text(report, "utf-8")
    for src, name in ((log, "lua_mod_log.txt"), (game / "!groove_log.txt", "groove_log.txt")):
        if src.exists() and src.stat().st_mtime > t0:
            (out / name).write_text(read_when_free(src), "utf-8")
    errors = []
    if (out / "lua_mod_log.txt").exists():
        errors = [l for l in (out / "lua_mod_log.txt").read_text("utf-8", "replace").splitlines() if re.search(r"^Failed|error is", l)]
    r = {"id": p["id"], "name": p["name"], "result": result, "detail": detail, "scriptErrors": errors, "packs": len(p["files"]),
         "windows": sorted(windows), "seconds": round(time.time() - t0)}
    (out / "result.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), "utf-8")
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("plan", "run"))
    ap.add_argument("--game", required=True, type=Path, help="the game folder (with Warhammer3.exe)")
    ap.add_argument("--packs", nargs="*", default=[], help="folders with downloaded packs (searched recursively)")
    ap.add_argument("--only", help="template ids, comma-separated")
    ap.add_argument("--work", type=Path, help="test folder (default: next to the Steam library's steamapps)")
    ap.add_argument("--presets", type=Path, help="extra lists to test (JSON list of {id, name, entries}), e.g. the profiles Play makes; their results stay in the test folder")
    a = ap.parse_args()
    game = a.game
    workshop = game.parent.parent / "workshop" / "content" / "1142710"
    work = a.work or game.parent.parent.parent / "wh3lmm_launch_test"  # same drive as the library: hard links work
    only = set(a.only.split(",")) if a.only else None
    packs = Packs(workshop, a.packs)
    extra = json.loads(a.presets.read_text("utf-8")) if a.presets else []
    plans = [plan(p, packs) for p in catalog["presets"] + extra if not only or p["id"] in only]
    work.mkdir(parents=True, exist_ok=True)
    (work / "plan.json").write_text(json.dumps(plans, ensure_ascii=False, indent=1), "utf-8")
    if a.mode == "plan":
        for p in plans:
            print(f"{p['id']:45} {len(p['files']):3} packs | missing {len(p['missing'])}")
            for m in p["missing"]:
                print("      MISSING", m)
            for n in p["notes"]:
                print("      note", n)
        return
    if "Warhammer3.exe" in subprocess.run(["tasklist", "/FI", "IMAGENAME eq Warhammer3.exe"], capture_output=True, text=True,
                                          encoding="mbcs", errors="replace").stdout:
        sys.exit("The game is running; close it first.")
    intro = "fe_game_intro_video_enabled true;" in PREFS.read_text("utf-8")
    shutil.copy(PREFS, work / "preferences.backup.txt")
    results = []
    version = game_version(game)
    try:
        set_intro(False)
        for p in plans:
            if p["missing"]:
                results.append({"id": p["id"], "name": p["name"], "result": "skipped", "detail": "missing packs", "missing": p["missing"]})
                print(f"{p['id']}: skipped, missing {p['missing']}", flush=True)
                continue
            r = run_one(p, game, work)
            results.append(r)
            if p.get("origin") != "profile":  # only the catalog's own templates are marked launch-tested
                record(r, p["fingerprint"], version)
            if r["result"] == "main menu":
                record_mods(next(x for x in catalog["presets"] + extra if x["id"] == p["id"]), version)
            print(f"{p['id']}: {r['result']} ({r['detail']}), script errors {len(r['scriptErrors'])}", flush=True)
            (work / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), "utf-8")
    finally:
        set_intro(intro)
        if (game / LIST_NAME).exists():
            (game / LIST_NAME).unlink()
    print("done", datetime.datetime.now().isoformat(timespec="minutes"))


if __name__ == "__main__":
    main()
