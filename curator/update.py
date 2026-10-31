"""Unattended catalog update: no AI, no logins. Meant for a scheduled GitHub Action (or any PC).

Steps:
  1. crawl_ll.py         – re-read the LoversLab club (only changed pages are rewritten)
  2. Steam refresh       – public Workshop details for every known item (titles, dates, previews, packs)
  3. auto entries        – every LL file / Steam item without a curated entry gets an automatic one
                           (name, author, images, files, first paragraph of the page) marked unverified
  4. build_catalog.py    – rebuild catalog/catalog.json
  5. CHANGES.md          – what changed, for maintainers and release notes

Usage:
    python curator/update.py            (from the repository root, with the curator venv / requirements)
Exit code 0 also when nothing changed; CHANGES.md then says so.
"""

import glob
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATOR = ROOT / "curator"
WORK = CURATOR / "work"
STEAM_API = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/"
TODAY = date.today().isoformat()


def load(path, default=None):
    p = Path(path)
    return json.loads(p.read_text("utf-8")) if p.exists() else default


def save(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")


def curated_ids() -> set[str]:
    """Ids that have a hand- or AI-curated entry; those are never overwritten by auto entries."""
    ids = set()
    for f in glob.glob(str(WORK / "part-*.json")) + glob.glob(str(WORK / "followup-*.json")) + [str(CURATOR / "manual.json")]:
        ids |= {m["id"] for m in (load(f, {}) or {}).get("mods", [])}
    for f in glob.glob(str(WORK / "desc-*.json")):
        ids |= set((load(f, {}) or {}).keys())
    return ids


def refresh_steam(extra_ids: set[str]) -> dict:
    """Public Workshop details for all known ids (hidden/adult items need a login and keep their data)."""
    steam = load(CURATOR / "raw" / "steam_items.json", {})
    ids = sorted(set(steam) | extra_ids)
    changed = []
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        data = {"itemcount": len(chunk), **{f"publishedfileids[{j}]": x for j, x in enumerate(chunk)}}
        req = urllib.request.Request(STEAM_API, data=urllib.parse.urlencode(data).encode())
        for x in json.load(urllib.request.urlopen(req, timeout=60))["response"]["publishedfiledetails"]:
            e = steam.setdefault(x["publishedfileid"], {"public": False})
            if x.get("result") != 1:
                continue
            if e.get("updated") and e["updated"] != x.get("time_updated"):
                changed.append(x["publishedfileid"])
            fn = (x.get("filename") or "").rsplit("/", 1)[-1]
            e.update(title=x.get("title"), public=True, updated=x.get("time_updated"), preview_url=x.get("preview_url"),
                     tags=[t["tag"] for t in x.get("tags", [])], description=(x.get("description") or "")[:6000])
            if fn.endswith(".pack") and fn not in e.setdefault("packs", []):
                e["packs"].append(fn)
    save(CURATOR / "raw" / "steam_items.json", steam)
    return {"steam": steam, "changed": changed}


def first_paragraph(text: str, limit: int = 420) -> str:
    """Plain first paragraph of a page text, without spoilers, image markers or links."""
    text = re.sub(r"\[\[SPOILER\]\].*?\[\[/SPOILER\]\]", " ", text, flags=re.S)
    text = re.sub(r"\[img [^\]]*\]|<https?://[^>]+>", " ", text)
    for para in re.split(r"\n\s*\n", text):
        para = re.sub(r"\s+", " ", para).strip()
        if len(para) > 40:
            return para if len(para) <= limit else para[:limit].rsplit(" ", 1)[0] + " …"
    return ""


def auto_entries() -> list:
    """Entries for every LL file without a curated entry. Facts only, clearly marked as unverified."""
    curated = curated_ids()
    out = []
    for f in sorted(glob.glob(str(CURATOR / "raw" / "ll" / "[0-9]*.json"))):
        d = load(f)
        mid = f"ll-{d['id']}"
        if mid in curated:
            continue
        kind = "translation" if d.get("category") == "translations" else "assets" if d.get("category") == "models" else "units"
        summary = first_paragraph(d.get("description", ""))
        out.append({
            "id": mid, "name": d["title"], "authors": [d["author"]] if d.get("author") else [], "kind": kind,
            "summary": summary or "No description yet.",
            "description": f"{summary}\n\n*Automatic entry from the LoversLab page; not reviewed yet.*" if summary else "",
            "tags": d.get("tags", []),
            "sources": {
                "loverslab": {"fileId": d["id"], "url": d["url"], "version": d.get("version"), "updated": d.get("updated"),
                              "category": d.get("category")},
            },
            "packs": [],
            # Workshop items linked on the page: we cannot tell "required" from "nice to have" without reading it.
            "relations": [{"kind": "recommends", "target": {"steamId": s}, "note": "Linked on the mod page (not reviewed: may be required).",
                           "source": {"type": "loverslab", "url": d["url"]}} for s in d.get("steam_ids", [])],
            "curation": {"lastChecked": TODAY, "confidence": "low",
                         "openQuestions": ["Automatic entry: requirements, kind and description need review."]},
        })
    return out


def main() -> int:
    py = sys.executable
    before = load(ROOT / "catalog" / "catalog.json", {"mods": []})
    before_ll = {m["id"]: (m["sources"].get("loverslab") or {}).get("version") for m in before.get("mods", [])}

    subprocess.run([py, str(CURATOR / "crawl_ll.py")], check=True)
    run = load(CURATOR / "raw" / "ll" / "_last_run.json", {"changed": [], "removed": []})

    linked = set()
    for f in glob.glob(str(CURATOR / "raw" / "ll" / "[0-9]*.json")):
        linked |= set(load(f).get("steam_ids", []))
    st = refresh_steam(linked)

    auto = auto_entries()
    save(WORK / "auto-new.json", {"mods": auto, "external": [], "notes": []})

    subprocess.run([py, str(CURATOR / "build_catalog.py")], check=True)
    after = load(ROOT / "catalog" / "catalog.json")

    names = {m["id"]: m["name"] for m in after["mods"]}
    new = [m["id"] for m in after["mods"] if m["id"] not in before_ll]
    bumped = [m["id"] for m in after["mods"]
              if m["id"] in before_ll and (m["sources"].get("loverslab") or {}).get("version") != before_ll[m["id"]]]
    lines = [f"# Catalog update {TODAY}", ""]
    if not (new or bumped or run["removed"] or st["changed"]):
        lines.append("No changes.")
    if new:
        lines += ["## New mods (automatic entries, please review)", *[f"- {names[i]} (`{i}`)" for i in new], ""]
    if bumped:
        lines += ["## New versions on LoversLab", *[f"- {names[i]}: {before_ll[i]} → {(next(m for m in after['mods'] if m['id'] == i)['sources']['loverslab'] or {}).get('version')}" for i in bumped], ""]
    if st["changed"]:
        lines += ["## Updated on Steam", *[f"- {names.get('steam-' + s) or s}" for s in st["changed"]], ""]
    if run["removed"]:
        lines += ["## Removed from LoversLab", *[f"- `ll-{i}`" for i in run["removed"]], ""]
    (ROOT / "CHANGES.md").write_text("\n".join(lines) + "\n", "utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
