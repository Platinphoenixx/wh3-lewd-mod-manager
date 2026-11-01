"""Summary of all pack analyses (raw/packs/*.json) against the catalog → work/pack-report.md.

For each analysed mod: its packs, declared dependencies and whether the catalog knows them, model/
texture references the base game does not have and which other analysed mod provides them, and
files it shares with other analysed mods (overrides). Run after analyze_pack.py and build_catalog.py.
"""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
packs_dir = ROOT / "raw" / "packs"
catalog = json.loads((ROOT.parent / "catalog" / "catalog.json").read_text("utf-8"))
mods = {m["id"]: m for m in catalog["mods"]}
pack_owner = {p["file"].lower(): m["id"] for m in catalog["mods"] for p in m.get("packs", [])}
for preset in catalog["presets"]:
    for e in preset["entries"]:
        t = e.get("target") or {}
        pack_owner.setdefault(e["pack"].lower(), t.get("mod") or t.get("external") or e.get("steamId") or "?")

analyses = {a["mod"]: a for a in (json.loads(f.read_text("utf-8")) for f in sorted(packs_dir.glob("*.json")))}
owner_of_file = defaultdict(set)
for mid, a in analyses.items():
    for f in a["files"]:
        owner_of_file[f["path"]].add(mid)

lines = ["# Pack analyses", "", f"{len(analyses)} mods analysed.", ""]
for mid, a in sorted(analyses.items()):
    name = mods.get(mid, {}).get("name", mid)
    lines += [f"## {name} ({mid})", "", f"- Packs: {', '.join(a['packs'])} – {a['fileCount']} files, "
              f"top folders {a['byTopFolder']}"]
    if a["dependencies"]:
        deps = [f"{d} → {pack_owner.get(d.lower(), 'UNKNOWN')}" for d in a["dependencies"]]
        lines.append(f"- Declared dependencies: {'; '.join(deps)}")
    r = a["references"]
    if r["total"]:
        lines.append(f"- References: {r['total']} (own {r['inMod']}, base game {r['inBaseGame']}, unresolved {len(r['unresolved'])})")
    provided = defaultdict(list)
    for ref in r["unresolved"]:
        for other in owner_of_file.get(ref, set()) - {mid}:
            provided[other].append(ref)
    for other, refs in provided.items():
        lines.append(f"- Needs files from {mods.get(other, {}).get('name', other)} ({other}): {len(refs)}, e.g. {refs[0]}")
    missing = [x for x in r["unresolved"] if not owner_of_file.get(x, set()) - {mid}]
    if missing:
        lines.append(f"- Unresolved, provided by no analysed mod: {len(missing)}, e.g. {', '.join(missing[:3])}")
    shared = defaultdict(int)
    for f in a["files"]:
        for other in owner_of_file[f["path"]] - {mid}:
            shared[other] += 1
    for other, n in sorted(shared.items(), key=lambda x: -x[1])[:6]:
        lines.append(f"- Shares {n} files with {mods.get(other, {}).get('name', other)} ({other})")
    lines.append("")

out = ROOT / "work" / "pack-report.md"
out.write_text("\n".join(lines), "utf-8")
print(f"{len(analyses)} analyses -> {out}")
