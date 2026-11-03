"""Which catalog mods change game data (database tables or scripts), from the pack analyses of a local mod archive.

    python curator/mod_tables.py <archive analysis items.jsonl>

Writes curator/raw/mod_tables.json: {mod id: {"tables": n, "scripts": n}} for every mod whose packs were analysed (the
archive itself stays local). build_catalog.py turns it into Mod.changesData; mods not in the file fall back to their kind.
Run it again after analysing new packs (tools in the dev notes); nothing else needs it.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
catalog = json.loads((ROOT.parent / "catalog" / "catalog.json").read_text("utf-8"))
by_steam = {}
for m in catalog["mods"]:
    for s in m.get("sources", {}).get("steam") or []:
        by_steam.setdefault(s["id"], m["id"])
out = {}
for line in open(sys.argv[1], encoding="utf-8"):
    it = json.loads(line)
    mods = set(it.get("mods") or [])
    if it.get("src") == "steam" and it.get("id") in by_steam:
        mods.add(by_steam[it["id"]])
    tables = len(it.get("tables") or [])
    scripts = (it.get("topFolders") or {}).get("script", 0)
    for mid in mods:
        cur = out.setdefault(mid, {"tables": 0, "scripts": 0})
        cur["tables"] = max(cur["tables"], tables)
        cur["scripts"] = max(cur["scripts"], scripts)
(ROOT / "raw" / "mod_tables.json").write_text(json.dumps(dict(sorted(out.items())), indent=1) + "\n", "utf-8", newline="\n")
print(len(out), "mods,", sum(1 for v in out.values() if v["tables"] or v["scripts"]), "change game data")
