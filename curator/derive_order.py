"""Load-order rules the tested lists imply, for mods that change the same files.

    python curator/derive_order.py <archive analysis folder>

Two mods that overwrite some of the same files (from the archive's pack analysis: items.jsonl + overlaps.json) and
stand in the same relative order in every tested list that has both, keep that order elsewhere too: when the app adds
one of them to another list, it goes on the same side of the other (the case of Readman's TTT, which carries an older
copy of a CCC table and breaks the game above CCC). Writes curator/raw/tested_order.json:
[{"above": <mod id>, "below": <mod id>, "lists": n, "files": n}] (above = higher priority = earlier in the list).
build_catalog.py adds these as loadOrder rules unless a curated rule says otherwise. Run it again when tested lists
change; the archive itself stays local.
"""
import collections
import itertools
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
analysis = Path(sys.argv[1])
catalog = json.loads((ROOT.parent / "catalog" / "catalog.json").read_text("utf-8"))
by_steam = {s["id"]: m["id"] for m in catalog["mods"] for s in m.get("sources", {}).get("steam") or []}
item_mods = {}
for line in open(analysis / "items.jsonl", encoding="utf-8"):
    it = json.loads(line)
    mods = set(it.get("mods") or [])
    if it.get("src") == "steam" and it.get("id") in by_steam:
        mods.add(by_steam[it["id"]])
    item_mods[it["key"]] = mods
shared = collections.Counter()  # (mod, mod) -> files both have
for path, items in json.load(open(analysis / "overlaps.json", encoding="utf-8")).items():
    mods = sorted({m for i in items for m in item_mods.get(i, ())})
    if len(mods) < 30:  # files nearly every mod ships (common textures) say nothing
        for a, b in itertools.combinations(mods, 2):
            shared[(a, b)] += 1

order = collections.defaultdict(lambda: [0, 0])  # (a, b) sorted -> [a above b, b above a]
for p in catalog["presets"]:
    if p.get("origin") != "tested":
        continue
    seq = []
    for e in p["entries"]:
        mid = (e.get("target") or {}).get("mod")
        if mid and mid not in seq:
            seq.append(mid)
    pos = {m: i for i, m in enumerate(seq)}
    for a, b in itertools.combinations(sorted(pos), 2):
        if shared.get((a, b)):
            order[(a, b)][0 if pos[a] < pos[b] else 1] += 1
rules = []
for (a, b), (ab, ba) in sorted(order.items()):
    if ab and not ba:
        rules.append({"above": a, "below": b, "lists": ab, "files": shared[(a, b)]})
    elif ba and not ab:
        rules.append({"above": b, "below": a, "lists": ba, "files": shared[(a, b)]})
(ROOT / "raw" / "tested_order.json").write_text(json.dumps(rules, indent=1) + "\n", "utf-8", newline="\n")
print(len(rules), "rules from", sum(1 for p in catalog["presets"] if p.get("origin") == "tested"), "tested lists;",
      sum(1 for v in order.values() if v[0] and v[1]), "pairs with mixed order skipped")
