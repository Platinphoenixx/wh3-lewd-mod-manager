"""Merge curated parts into catalog/catalog.json and report what is still unresolved.

Inputs:
    curator/work/part-*.json        {"mods": [...], "external": [...], "notes": [...]} from curation
    curator/manual.json             optional hand-made entries/overrides (same shape), presetReplacements
    curator/raw/steam_items.json    Steam id -> title/public/filename/packs
    curator/raw/discord/twmods.json community mod lists (parse_twmods.py) -> presets
    curator/raw/steam_collection_*.json  Steam collections referenced by mods
Output:
    catalog/catalog.json
    curator/work/report.md          unresolved targets, low-confidence mods, duplicates

Steam items that are referenced but belong to no curated mod become stub mods
("steam-<id>", confidence low), so the app can still subscribe and order them.

Usage:
    curator/.venv/Scripts/python curator/build_catalog.py
"""

import glob
import html
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATOR = ROOT / "curator"
OUT = ROOT / "catalog" / "catalog.json"
REPORT = CURATOR / "work" / "report.md"
TODAY = date.today().isoformat()

TIERS = [
    {"id": "utility", "label": "Tools (console, MCT)", "note": "MCT goes at the very top per the Discord FAQ; others don't matter."},
    {"id": "translation", "label": "Translations", "note": "Above the mod they translate."},
    {"id": "reskin", "label": "Reskins", "note": "The topmost reskin of a character decides its campaign portrait."},
    {"id": "visual-submod", "label": "Visual submods", "note": "Above the reskins they modify (wiki)."},
    {"id": "submod", "label": "Submods / extensions", "note": "Below the progression stages (Discord FAQ)."},
    {"id": "progression", "label": "Progression stages", "note": "Above the reskins (wiki)."},
    {"id": "campaign", "label": "Campaigns"},
    {"id": "patch", "label": "Compatibility patches", "note": "Above every mod they patch."},
    {"id": "framework", "label": "Frameworks", "note": "!!li_progression_framework has the highest priority; only MCT goes above it (Discord FAQ)."},
]

WIKI = "https://lewdhammer.miraheze.org/wiki/"
WIKI_NOTES = [
    {"topic": "Load order", "text": "Higher in the list = loaded later and wins. Order per the wiki: !!li_progression_framework at the top, then the progression stages of individual characters, then the reskins. Visual submods that change reskins go above the reskins.", "source": {"type": "wiki", "url": WIKI + "Mod_Load_Order"}},
    {"topic": "Reskins", "text": "Every reskin stage ships its own campaign portrait; the game shows the one from the topmost reskin mod for that character.", "source": {"type": "wiki", "url": WIKI + "Mod_Load_Order"}},
    {"topic": "Installation", "text": "Subscribe to Steam mods; after updates, re-subscribing is sometimes the only fix because Steam handles frequent updates badly. LL downloads (.pack) go into the game's data folder.", "source": {"type": "wiki", "url": WIKI + "Installing_Mods"}},
    {"topic": "Troubleshooting", "text": "Remove the -dx11 launch option. Disable submods right after a game update. For help in Discord #help, post li_log.txt (mandatory) and script_log_*.txt from the game folder; script_log is only written with the Lua debug mod (Steam 2791799449).", "source": {"type": "wiki", "url": WIKI + "Debugging"}},
    {"topic": "Sources", "text": "Discord: live community, quick updates, niche submods. Steam collection 3472332568: the main downloads including framework, progression and reskins. LoversLab: some downloads, submods, preview images.", "source": {"type": "wiki", "url": WIKI + "Lewdhammer_Wiki"}},
]

DISCORD = "https://discord.com/channels/965342581745668136/"
MODLIST_CHANNEL = DISCORD + "1450264896716673085"
DISCORD_NOTES = [
    {"topic": "Load order", "text": "Steam's own launcher does not order mods. Use a mod manager and put MCT at the very top, then Lazy's progression framework, then the individual progression mods. Reskins may sit above the progression mods; submods go below the progression stages. Do not build a custom load order for ATB/AZR; follow the author's list.", "source": {"type": "discord", "url": DISCORD + "965347160889655327"}},
    {"topic": "Stale packs", "text": "Several mods moved from LoversLab to Steam (ATB, Azazel's Realm, Corrupted Landmarks, Corrupted Valkia, Corrupted Compendium, Corrupted Ascension). An old .pack with the same name left in the data folder takes priority over the Workshop copy and causes crashes or duplicate events. A Steam mod shown with a red name in the launcher is the usual sign.", "source": {"type": "discord", "url": DISCORD + "1239642838778511552"}},
    {"topic": "Updates", "text": "Steam delivers updates of these mods late. If something breaks, re-subscribe or delete the local copy of Corrupted Landmarks, Readman CCC/TTT, Kerberos mod assets and ATB, and keep ATB, AZR, Corrupted Landmarks and the asset pack on matching versions. Turn submods off right after a game patch.", "source": {"type": "discord", "url": DISCORD + "1239642838778511552"}},
    {"topic": "Compatibility", "text": "Incompatible with the progression framework: Zoat Elder - Generic Lord for Wood Elves (Steam 2855365665) and Preytons (Steam 2876531798). Legendary Lore does not work with Corrupted Compendium. Corrupted Ascension is incompatible with campaigns built on Lazy's framework; its Generic Framework, Corrupted Drycha and the Lin AllInOne translation do run alongside it.", "source": {"type": "discord", "url": DISCORD + "965347160889655327"}},
    {"topic": "Campaign phases", "text": "Readman's mod lists come in early-game and late-game versions. Always start a campaign with the early-game list and switch only at the stated corruption stage (Alarielle: stage 5, Miao Ying: stage 4); starting with a late-game list breaks buildings on turn 1. Major updates of ATB/AZR need a new campaign.", "source": {"type": "discord", "url": MODLIST_CHANNEL}},
]

# Readman's lists from #many-modlist-methods: file stem -> (id, name, playAs, phase, note)
PRESETS = {
    "Readman_ATB_Alar_Earlygame_2026Jan2": ("readman-alarielle-early", "Alarielle – early game", ["Alarielle"], "early",
                                            "Start the campaign with this list (corruption stages 1–4)."),
    "Readman_ATB_Alar_Lategame_2026Jan2": ("readman-alarielle-late", "Alarielle – late game", ["Alarielle"], "late",
                                           "Switch only from stage 5 on; starting a campaign with it breaks buildings on turn 1."),
    "Readman_ATB_Miao_Earlygame_2026Jan29": ("readman-miao-early", "Miao Ying – early game", ["Miao Ying"], "early",
                                             "Start the campaign with this list."),
    "Readman_ATB_Miao_Lategame_2026Jan29": ("readman-miao-late", "Miao Ying – late game", ["Miao Ying"], "late",
                                            "Switch from stage 4 on."),
    "Readman_ATB_Katarin_Earlygame_2026Jan2": ("readman-katarin-early", "Katarin – early game", ["Katarin"], "early", None),
    "Readman_ATB_Mora_2026Jan2": ("readman-morathi", "Morathi", ["Morathi"], "any", None),
    "Readman_ATB_Sigv_Earlygame_2026Jan2": ("readman-sigvald-early", "Sigvald – early game", ["Sigvald"], "early", None),
    "Readman_ATB_SlaaneshDe_Earlygame2026Jan3": ("readman-slaanesh-daemons-early", "N'Kari / Dechala / Masque – early game",
                                                 ["N'Kari", "Dechala", "Masque"], "early", None),
    "Readman_ATB_WoC_Earlygame_2026Jan2": ("readman-woc-early", "Archaon / Azazel / Be'lakor / Daemon Prince – early game",
                                           ["Archaon", "Azazel", "Be'lakor", "Daemon Prince"], "early", None),
}


# Load-order rank per kind when a list has to be ordered without a tested source (higher = loaded later,
# i.e. nearer the top). Mirrors TIERS: framework on top, tools at the bottom.
KIND_RANK = {"framework": 9, "patch": 8, "campaign": 7, "progression": 6, "submod": 5, "units": 4,
             "reskin": 3, "assets": 2, "translation": 8, "utility": 1, "collection": 0}
INACTIVE = ("superseded", "abandoned")


def preset_entry(mods: dict, external: dict, steam: dict, target: dict) -> dict | None:
    """A preset entry (pack + source) for a catalog target, or None if nothing installable is known."""
    (k, v), = target.items()
    if k == "external":
        e = external.get(v, {})
        sid = e.get("steamId")
        pack = (steam.get(sid, {}).get("packs") or [e.get("name", v)])[0] if sid else e.get("name", v)
        return {"pack": pack, "from": "steam" if sid else "download", **({"steamId": sid} if sid else {}), "target": target}
    if k != "mod" or v not in mods:
        return None
    m = mods[v]
    for p in m.get("packs") or []:
        if not p.get("optional") and not p.get("exclusiveGroup"):
            return {"pack": p["file"], "from": p.get("from", "download"),
                    **({"steamId": p["steamId"]} if p.get("steamId") else {}), "target": target}
    for s in m.get("sources", {}).get("steam") or []:
        packs = steam.get(s["id"], {}).get("packs") or [m["name"]]
        return {"pack": packs[0], "from": "steam", "steamId": s["id"], "target": target}
    return {"pack": m["name"], "from": "download", "target": target}


def guide_and_derived_presets(mods: dict, external: dict, presets: list, guides: list, steam: dict) -> list:
    """
    Presets that need no hand-made list: one per KPW guide, and one per campaign/progression mod whose
    characters no tested list covers (the mod plus everything it requires). They follow the catalog
    automatically, so updating the catalog updates them.
    """
    out = []
    for g in guides:
        entries = [e for e in g["entries"] if e.get("target") and not e.get("optional")]
        built = [x for x in (preset_entry(mods, external, steam, e["target"]) for e in entries) if x]
        if not built:
            continue
        character = re.sub(r"[“”’‘]", "'", g["character"])  # Google Docs smart quotes
        slug = re.sub(r"[^a-z0-9]+", "-", character.lower()).strip("-")[:40]
        out.append({"id": f"kpw-{slug}", "name": f"{character} – KPW's quick list", "origin": "guide",
                    "playAs": [c.strip() for c in re.split(r"[/,]", character) if c.strip()], "phase": "any",
                    "phaseNote": "Order as listed in KPW's guide; check the load order before playing.",
                    "source": {"type": "discord", "url": g["source"]["url"], "author": "KPW"},
                    "description": "KPW's per-character download list from the Discord: the mods the guide names as needed. "
                                   "Use it as a starting point and add options in the profile.",
                    "entries": built})

    covered = {c.lower().split()[0] for p in presets for c in p.get("playAs", [])}
    # The main mod of each tested list (first cover); other campaigns get their own derived preset.
    tested_mains = {p["coverMods"][0] for p in presets if p.get("origin") == "tested" and p.get("coverMods")}
    tested_mains |= {"ll-42028", "ll-27930", "ll-23878", "ll-23966", "ll-23925"}  # main mods of Readman's lists

    def requires_closure(mid: str) -> list:
        seen, order, queue = {f"mod:{mid}"}, [{"mod": mid}], [mid]
        while queue:
            cur = mods.get(queue.pop(0), {})
            for r in cur.get("relations", []):
                if r["kind"] != "requires" or r.get("condition"):
                    continue
                (k, v), = r["target"].items()
                key = f"{k}:{v}"
                if key in seen or (k == "mod" and mods.get(v, {}).get("status") in INACTIVE):
                    continue
                seen.add(key)
                order.append(r["target"])
                if k == "mod":
                    queue.append(v)
        return order

    for m in sorted(mods.values(), key=lambda m: m["name"].lower()):
        if m.get("kind") not in ("campaign", "progression") or m.get("status") in INACTIVE or not m.get("playAs"):
            continue
        chars = [p["character"] for p in m["playAs"] if not p["character"].lower().startswith("any ")]
        if not chars or m["id"] in tested_mains:
            continue
        # Progression mods only when their character has no list yet; every other campaign gets its own preset.
        if m["kind"] == "progression" and all(c.lower().split()[0] in covered for c in chars):
            continue
        targets = requires_closure(m["id"])

        def rank(t):
            (k, v), = t.items()
            return KIND_RANK.get(mods.get(v, {}).get("kind"), 1) if k == "mod" else 1

        built = [x for x in (preset_entry(mods, external, steam, t) for t in sorted(targets, key=rank, reverse=True)) if x]
        out.append({"id": f"derived-{m['id']}", "name": f"{m['name']}", "origin": "derived",
                    "playAs": chars, "phase": "any",
                    "phaseNote": "Built from the mod's own page: the mod and everything it requires, ordered by type. "
                                 "Not a tested list; check the mod page for extra steps.",
                    "source": {"type": "derived", "url": (m.get("sources", {}).get("loverslab") or {}).get("url")},
                    "description": m.get("summary", ""), "coverMods": [m["id"]], "entries": built})
    return out


def apply_community(mods: dict) -> None:
    """
    Apply accepted community contributions (curator/community.json, written by apply_contribution.py).
    Rules append relations/load-order constraints, feedback is counted, corrections become visible notes,
    new mods become unverified entries. Nothing here needs a human beyond the maintainer who accepted the issue.
    """
    path = CURATOR / "community.json"
    if not path.exists():
        return
    for c in load(path).get("accepted", []):
        src = {"type": "community", "url": c.get("url")}
        m = mods.get(c.get("modId") or "")
        if c["type"] == "rule" and m:
            (k, v) = c["other"].split(":", 1)
            target = {k: v}
            if c["kind"] in ("loadAbove", "loadBelow"):
                side = "above" if c["kind"] == "loadAbove" else "below"
                m.setdefault("loadOrder", {}).setdefault(side, []).append(target)
            else:
                m.setdefault("relations", []).append({"kind": c["kind"], "target": target, "note": c.get("note") or None, "source": src})
        elif c["type"] == "feedback" and m:
            rep = m.setdefault("communityReports", {"works": 0, "issues": 0, "broken": 0})
            rep[c.get("verdict", "works")] = rep.get(c.get("verdict", "works"), 0) + 1
            rep["lastReport"] = c.get("accepted")
            if c.get("verdict") in ("issues", "broken") and c.get("comment"):
                version = f" (game {c['gameVersion']})" if c.get("gameVersion") else ""
                m.setdefault("knownIssues", []).append(f"Community report{version}: {c['comment']}")
        elif c["type"] == "correction" and m:
            m.setdefault("communityNotes", []).append(
                {"text": f"{c.get('field', 'note')}: {c.get('suggestion', '')}", "url": c.get("url"), "date": c.get("accepted")})
        elif c["type"] == "new-mod":
            slug = re.sub(r"[^a-z0-9]+", "-", (c.get("name") or "mod").lower()).strip("-")[:50]
            links = c.get("links") or []
            ll = next((re.search(r"loverslab\.com/files/file/(\d+)", u) for u in links if "loverslab.com/files/file/" in u), None)
            if ll and f"ll-{ll.group(1)}" in mods:
                continue  # already in the catalog (the next crawl fills it in)
            steam_ids = [s for u in links for s in re.findall(r"filedetails/\?(?:[^ ]*&)?id=(\d+)", u)]
            mods.setdefault(f"community-{slug}", {
                "id": f"community-{slug}", "name": c.get("name") or slug, "authors": [], "kind": c.get("kind") or "units",
                "summary": c.get("description") or "Suggested by the community.", "description": c.get("description") or "",
                "tags": [], "packs": [], "relations": [],
                "sources": {"steam": [{"id": s} for s in steam_ids],
                            "downloads": [{"name": u, "url": u} for u in links if "steamcommunity.com" not in u]},
                "playAs": [{"character": x.strip()} for x in (c.get("characters") or "").split(",") if x.strip()],
                "installNotes": [c["requirements"]] if c.get("requirements") else [],
                "curation": {"lastChecked": c.get("accepted"), "confidence": "low",
                             "openQuestions": [f"Community suggestion, not reviewed in detail: {c.get('url')}"]},
            })


# Support links (Patreon, Ko-fi, …) as they appear on a mod's own pages. They are kept per mod, not per
# author: a page may also credit collaborators with their links.
SUPPORT_RE = re.compile(
    r"https?://(?:www\.)?((?:patreon\.com|ko-fi\.com|subscribestar\.(?:com|adult)|buymeacoffee\.com|paypal\.me|boosty\.to"
    r"|afdian\.(?:net|com))/[\w\-./@?=]+|[\w\-]+\.fanbox\.cc)", re.I)
SUPPORT_PLATFORM = [("patreon.com", "Patreon"), ("ko-fi.com", "Ko-fi"), ("subscribestar.", "SubscribeStar"),
                    ("buymeacoffee.com", "Buy Me a Coffee"), ("paypal.me", "PayPal"), ("boosty.to", "Boosty"),
                    ("afdian.", "Afdian"), ("fanbox.cc", "pixivFANBOX")]


def unescape(text: str) -> str:
    """HTML entities, also double-escaped ones (LoversLab names like "Calm&amp;amp;NormalTime")."""
    while (plain := html.unescape(text)) != text:
        text = plain
    return text


def support_links(*texts: str) -> list:
    out = []
    for text in texts:
        for raw in SUPPORT_RE.findall(text or ""):
            u = raw.split("?")[0].rstrip("/.)]")
            if re.search(r"patreon\.com/(?:posts|join|checkout)/", u, re.I):
                continue  # a single post or checkout page, not the creator's page
            u = re.sub(r"patreon\.com/c/", "patreon.com/", u, flags=re.I)
            u = re.sub(r"/posts$", "", u)
            url = "https://" + u
            if not any(x["url"].lower() == url.lower() for x in out):
                platform = next((p for k, p in SUPPORT_PLATFORM if k in u.lower()), "Support")
                out.append({"platform": platform, "url": url})
    return out


def load(path):
    return json.loads(Path(path).read_text("utf-8"))


def target_key(t: dict) -> tuple:
    (k, v), = t.items()
    return k, v


def main():
    # auto-new.json: entries generated by update.py for mods nobody has curated yet (lowest priority:
    # any curated part/followup/manual entry for the same id replaces it field by field).
    parts = [str(p) for p in [CURATOR / "work" / "auto-new.json"] if p.exists()]
    parts += sorted(glob.glob(str(CURATOR / "work" / "part-*.json")))
    # followup-*.json: field overrides from later curation passes (same shape as a part)
    # Later passes win: LL and Steam follow-ups first, then research, then community contributions.
    order = {"followup-ll.json": 0, "followup-steam.json": 1, "followup-research.json": 2, "followup-review.json": 3, "followup-archives.json": 4, "followup-community.json": 5}
    parts += sorted(glob.glob(str(CURATOR / "work" / "followup-*.json")), key=lambda p: (order.get(Path(p).name, 2), p))
    manual = CURATOR / "manual.json"
    if manual.exists():
        parts.append(str(manual))
    steam = load(CURATOR / "raw" / "steam_items.json")
    twmods_path = CURATOR / "raw" / "discord" / "twmods.json"
    twmods = load(twmods_path) if twmods_path.exists() else {}

    mods, external, notes, dupes, deferred = {}, {}, list(WIKI_NOTES) + DISCORD_NOTES, [], []
    for p in parts:
        d = load(p)
        for m in d.get("mods", []):
            if m["id"] in mods and not (p.endswith("manual.json") or Path(p).name.startswith("followup-")
                                        or Path(p).name == "auto-new.json"):
                dupes.append(f"{m['id']} in {Path(p).name}")
            m = {k: v for k, v in m.items() if not k.startswith("_")}  # "_fix" etc. are curator notes
            if m["id"] not in mods and "name" not in m:
                # Override for a Steam stub that only comes into existence later in this build.
                deferred.append(m)
                continue
            mods[m["id"]] = mods.get(m["id"], {}) | m
        for e in d.get("external", []):
            external.setdefault(e["id"], e)
        notes += d.get("notes", [])

    # Steam collections become mods whose items are requirements.
    for f in glob.glob(str(CURATOR / "raw" / "steam_collection_*.json")):
        c = load(f)["response"]["collectiondetails"][0]
        cid = c["publishedfileid"]
        mods.setdefault(f"steam-{cid}", {
            "id": f"steam-{cid}", "name": steam.get(cid, {}).get("title") or f"Steam collection {cid}",
            "authors": ["LazyIcarus"], "kind": "collection", "tags": [],
            "summary": "Steam collection with the framework, progressions, reskins and tools. Subscribing gets every part.",
            "sources": {"steam": [{"id": cid, "title": steam.get(cid, {}).get("title")}]},
            "packs": [], "relations": [
                {"kind": "requires", "target": {"steamId": ch["publishedfileid"]},
                 "source": {"type": "steam", "url": f"https://steamcommunity.com/sharedfiles/filedetails/?id={cid}"}}
                for ch in c.get("children", [])],
            "curation": {"lastChecked": TODAY, "confidence": "high"},
        })

    # Discord-only mods found by reading the server (discord_mods.json from the curation step).
    dc_path = CURATOR / "work" / "discord-mods.json"
    dc_mods = load(dc_path).get("mods", []) if dc_path.exists() else []
    ll_by_url = {}
    for m in mods.values():
        ll = m.get("sources", {}).get("loverslab")
        if ll:
            ll_by_url[ll["fileId"]] = m["id"]

    def ll_id(url: str):
        m = re.search(r"loverslab\.com/files/file/(\d+)", url or "")
        return m and ll_by_url.get(m.group(1))

    man = load(manual) if manual.exists() else {}
    merge_mods = man.get("mergeMods", {})          # duplicate dc entry -> canonical mod id
    ext_to_mod = man.get("externalToMod", {})      # external placeholder -> real catalog mod
    ref_aliases = sorted(man.get("refAliases", {}).items(), key=lambda kv: -len(kv[0]))

    dc_pending = []  # (mod id, kind, raw string) resolved after ownership is known
    for d in dc_mods:
        # Discord posts about mods that already have an LL page enrich that entry instead.
        existing = next((ll_id(u) for u in d.get("loversLab", []) if ll_id(u)), None)
        mid = existing or "dc-" + re.sub(r"[^a-z0-9]+", "-", d["name"].lower()).strip("-")[:60]
        if mid in merge_mods:
            mid = existing = merge_mods[mid]
        m = mods.setdefault(mid, {
            "id": mid, "name": d["name"], "authors": d.get("authors", []), "kind": "submod", "tags": [],
            "summary": d.get("notes") or "", "sources": {}, "packs": [], "relations": [],
            "curation": {"lastChecked": TODAY, "confidence": "medium"},
        })
        src = m.setdefault("sources", {})
        src.setdefault("discord", []).extend(
            {"channel": d.get("channel", ""), "messageUrl": u} for u in (d.get("messageUrls") or [None]))
        if d.get("downloads"):
            src.setdefault("downloads", []).extend(
                {"name": x["name"], "url": x.get("messageUrl") or ""} for x in d["downloads"])
            for x in d["downloads"]:
                if x["name"].lower().endswith(".pack") and not any(p["file"] == x["name"] for p in m["packs"]):
                    m["packs"].append({"file": x["name"], "from": "download"})
        for sid in d.get("steamIds", []):
            if not any(s["id"] == sid for s in src.get("steam", [])) and (not existing or mid in merge_mods.values()):
                src.setdefault("steam", []).append({"id": sid, "title": steam.get(sid, {}).get("title")})
        for kind, key in (("requires", "requires"), ("recommends", "recommends"), ("incompatible", "incompatible")):
            for raw in d.get(key, []):
                dc_pending.append((mid, kind, raw))
        if d.get("playAs") and not m.get("playAs"):
            m["playAs"] = [{"character": c} for c in d["playAs"]]
        if d.get("status") in ("abandoned", "deprecated", "superseded", "beta", "wip", "stable"):
            m["status"] = "superseded" if d["status"] == "deprecated" else d["status"]
        if d.get("knownIssues"):
            m["knownIssues"] = list(dict.fromkeys((m.get("knownIssues") or []) + d["knownIssues"]))
        if d.get("loadOrder"):
            lo = m.setdefault("loadOrder", {})
            lo["note"] = "; ".join(x for x in (lo.get("note"), "Discord: " + d["loadOrder"]) if x)

    # Pack analyses (analyze_pack.py → raw/packs/<mod>.json): pack names for mods whose pages do not
    # name them, and the packs each pack header declares as needed (resolved to mods further down).
    header_deps = {}
    for f in sorted(glob.glob(str(CURATOR / "raw" / "packs" / "*.json"))):
        a = load(f)
        m = mods.get(a["mod"])
        if not m:
            continue
        if not m.get("packs"):
            src = "steam" if m.get("sources", {}).get("steam") else "download"
            m["packs"] = [{"file": name, "from": src} for name in a["packs"]]
        # Which LoversLab download holds each pack: perPack keys are "<download without extension>/<path
        # inside>" for archives, or the pack name itself when the download is the .pack.
        if m.get("sources", {}).get("loverslab"):
            for p in m["packs"]:
                homes = sorted({k.split("/", 1)[0] if "/" in k else k.rsplit(".", 1)[0]
                                for k in (a.get("perPack") or {}) if k.rsplit("/", 1)[-1].lower() == p["file"].lower()})
                if len(homes) == 1:
                    p["archive"] = homes[0]
                elif homes:
                    p["note"] = "; ".join(x for x in (p.get("note"), "In several downloads: " + ", ".join(homes)) if x)
        own = {p.lower() for p in a["packs"]}
        header_deps[m["id"]] = [d for d in a.get("dependencies", []) if d.lower() not in own]
        # "Pack name not given" is answered now; keep the rest of such questions.
        cur = m.get("curation") or {}
        if cur.get("openQuestions"):
            kept = []
            for q in cur["openQuestions"]:
                parts = [c for c in re.split(r";\s*", q) if not (
                    re.search(r"pack (?:file )?names?|pack file", c, re.I)
                    and not re.search(r"framework|translation|variant|steam|load order|dependenc|version|campaign|original", c, re.I))]
                if parts:
                    s = "; ".join(parts)
                    kept.append(s[0].upper() + s[1:])
            cur["openQuestions"] = kept

    # Who owns which Steam id / pack.
    steam_owner, pack_owner = {}, {}
    for e in external.values():
        if e.get("steamId"):
            steam_owner.setdefault(e["steamId"], {"external": e["id"]})
    for m in mods.values():
        for s in m.get("sources", {}).get("steam", []) or []:
            if m.get("kind") != "collection":
                steam_owner.setdefault(s["id"], {"mod": m["id"]})
            if not s.get("title") and steam.get(s["id"], {}).get("title"):
                s["title"] = steam[s["id"]]["title"]
        for p in m.get("packs", []) or []:
            pack_owner.setdefault(p["file"].lower(), {"mod": m["id"]})
            if p.get("steamId"):
                steam_owner.setdefault(p["steamId"], {"mod": m["id"]})
    aliases = load(manual).get("packAliases", {}) if manual.exists() else {}
    for pack, a in aliases.items():
        t = a["target"]
        if "external" in t and t["external"] in ext_to_mod:
            t = {"mod": ext_to_mod[t["external"]]}
        pack_owner.setdefault(pack.lower(), steam_owner.get(t["steamId"], t) if "steamId" in t else t)
    pack_to_steam = {}
    for sid, info in steam.items():
        for p in info.get("packs", []) or ([info["filename"].rsplit("/", 1)[-1]] if info.get("filename") else []):
            pack_to_steam.setdefault(p.lower(), sid)

    stubs = {}

    def stub_for(sid: str) -> dict:
        """Create (once) a placeholder mod for a Steam item nobody curated yet."""
        if sid in steam_owner:
            return steam_owner[sid]
        info = steam.get(sid, {})
        mid = f"steam-{sid}"
        stubs[sid] = mods[mid] = {
            "id": mid, "name": info.get("title") or f"Steam mod {sid} (unlisted)", "authors": [],
            "kind": "units", "tags": info.get("tags") or [], "summary": "",
            "sources": {"steam": [{"id": sid, "title": info.get("title"), "unlisted": not info.get("public")}]},
            "packs": [{"file": p, "from": "steam", "steamId": sid} for p in info.get("packs", [])],
            "relations": [],
            "curation": {"lastChecked": TODAY, "confidence": "low",
                         "openQuestions": ["Known only from references; kind, dependencies and purpose unchecked."]},
        }
        steam_owner[sid] = {"mod": mid}
        return steam_owner[sid]

    unresolved, self_refs = [], []
    apply_community(mods)

    for m in deferred:
        if m["id"].startswith("steam-"):
            stub_for(m["id"].removeprefix("steam-"))
            mods[m["id"]] |= m
        else:
            unresolved.append(f"override for unknown mod {m['id']} ignored")

    def parse_ref(raw: str):
        """Turn a free-text reference from Discord notes into a ModTarget (or None)."""
        raw = raw.strip()
        if m := re.search(r"filedetails/\?(?:[^ ]*&)?id=(\d+)", raw) or re.search(r"\b(\d{9,11})\b", raw):
            return {"steamId": m.group(1)}
        if lid := ll_id(raw):
            return {"mod": lid}
        if (m := re.search(r"\bLL\s*(\d{4,6})\b", raw)) and m.group(1) in ll_by_url:
            return {"mod": ll_by_url[m.group(1)]}
        low = raw.lower()
        for alias, target in ref_aliases:
            if re.search(r"(?<![a-z])" + re.escape(alias) + r"(?![a-z])", low):
                return dict(target)
        if m := re.search(r"([\w@!.\-]+\.pack)\b", raw):
            return {"pack": m.group(1)}
        hits = [x["id"] for x in mods.values() if len(low) >= 5 and (low in x["name"].lower() or x["name"].lower() in low)]
        hits += [e["id"] for e in external.values() if len(low) >= 5 and low in e["name"].lower()]
        if len(hits) == 1:
            return {"external": hits[0]} if hits[0].startswith("ext-") else {"mod": hits[0]}
        return None

    for mid, kind, raw in dc_pending:
        t = parse_ref(raw)
        if t == {"mod": mid}:  # "Do not combine ATB and X" names the mod itself: it is a rule, not a link
            t = None
        if t is None:
            # Not a mod but a rule ("no custom load order", "delete old LL packs"): keep it visible.
            label = {"requires": "Requires", "recommends": "Recommended", "incompatible": "Avoid"}[kind]
            notes_ = mods[mid].setdefault("installNotes", [])
            if f"{label}: {raw}" not in notes_:
                notes_.append(f"{label}: {raw}")
            unresolved.append(f"{mid} {kind}: Freitext '{raw}' (als installNote übernommen)")
            continue
        mods[mid]["relations"].append({"kind": kind, "target": t, "note": raw,
                                       "source": {"type": "discord"}})

    kpw_path = CURATOR / "work" / "kpw.json"
    kpw = load(kpw_path) if kpw_path.exists() else {"docs": [], "steamNames": {}}
    for sid, name in kpw.get("steamNames", {}).items():
        if not steam.get(sid, {}).get("title"):
            steam.setdefault(sid, {"public": False})["title"] = name

    def resolve(owner_id: str, t: dict, where: str) -> dict:
        k, v = target_key(t)
        if k == "pack":
            if v.lower() in pack_owner:
                return pack_owner[v.lower()]
            if v.lower() in pack_to_steam:
                return stub_for(pack_to_steam[v.lower()])
            unresolved.append(f"{owner_id} {where}: nur Pack-Name {v}")
        elif k == "steamId":
            return stub_for(v)
        elif k == "external" and v in ext_to_mod:
            return {"mod": ext_to_mod[v]}
        elif k == "mod" and v not in mods:
            unresolved.append(f"{owner_id} {where}: unbekannter Mod {v}")
        elif k == "external" and v not in external:
            unresolved.append(f"{owner_id} {where}: unbekannter externer Mod {v}")
        return t

    for mid, deps in header_deps.items():
        for dep in deps:
            mods[mid]["relations"].append({"kind": "requires", "target": {"pack": dep},
                                           "note": f"Named as a dependency in the mod's pack ({dep})",
                                           "source": {"type": "inferred"}, "_header": True})

    for m in list(mods.values()):
        for r in m.get("relations", []):
            r["target"] = resolve(m["id"], r["target"], r["kind"])
        # A pack-header dependency adds nothing when a curated relation already names the same mod.
        curated = {json.dumps(r["target"], sort_keys=True) for r in m.get("relations", []) if not r.get("_header")}
        m["relations"] = [r for r in m.get("relations", []) if not r.get("_header") or json.dumps(r["target"], sort_keys=True) not in curated]
        for r in m["relations"]:
            r.pop("_header", None)
            if r["target"] == {"mod": m["id"]} and r.get("source", {}).get("type") != "discord":
                self_refs.append(m["id"])
        # A relation to one of the mod's own packs/items (e.g. ATB "requires" its asset pack) is no relation.
        m["relations"] = [r for r in m.get("relations", []) if r["target"] != {"mod": m["id"]}]
        lo = m.get("loadOrder") or {}
        for side in ("above", "below"):
            if lo.get(side):
                lo[side] = [resolve(m["id"], t, "loadOrder." + side) for t in lo[side]]

    # manual.json presetReplacements: packs of the tested lists that have a newer version since the list was
    # made (moved to Steam, merged packs, fixes) or must not be used any more ({"remove": true}). Matched by
    # pack name; every change is recorded in the preset's "modernized" list so the app can show it.
    replacements = {k.lower(): v for k, v in man.get("presetReplacements", {}).items() if not k.startswith("_")}

    def replacement_entry(rep: dict) -> dict:
        pe = {"pack": rep["pack"], "from": rep.get("from") or ("steam" if rep.get("steamId") else "download")}
        if rep.get("steamId"):
            pe["steamId"] = rep["steamId"]
        t = rep.get("target") or ({"steamId": rep["steamId"]} if rep.get("steamId") else {"pack": rep["pack"]})
        pe["target"] = resolve("presetReplacements", dict(t), rep["pack"])
        return pe

    def entry_key(pe: dict) -> tuple:
        return pe["pack"].lower(), pe.get("steamId"), pe["from"], json.dumps(pe.get("target"), sort_keys=True)

    presets = []
    for stem, entries in twmods.items():
        pid, name, play_as, phase, note = PRESETS.get(stem, (stem.lower(), stem, [], "any", None))
        out, modernized = [], []
        for e in entries:
            pe = {"pack": e["pack"], "from": "steam" if e["source"] == "steam" else "download"}
            if e.get("steamId"):
                pe["steamId"] = e["steamId"]
            rep = replacements.get(e["pack"].lower())
            if rep and rep.get("remove"):
                modernized.append({"from": e["pack"], "to": "removed", "note": rep.get("note")})
                continue
            if e.get("steamId"):
                pe["target"] = stub_for(e["steamId"])
            elif e["pack"].lower() in pack_owner:
                pe["target"] = pack_owner[e["pack"].lower()]
            elif not rep:
                unresolved.append(f"preset {pid}: lokales Pack {e['pack']} gehört zu keinem Katalog-Mod")
            if rep:
                new = replacement_entry(rep)
                if entry_key(new) != entry_key(pe):  # same file from a new source (Steam, Discord fix) counts as a change
                    modernized.append({"from": e["pack"], "to": new["pack"], "note": rep.get("note")})
                    pe = new
            # Merged packs replace several old ones: keep the first position only.
            if any(x["pack"].lower() == pe["pack"].lower() for x in out):
                continue
            out.append(pe)
        presets.append({"id": pid, "name": name, "origin": "tested", "playAs": play_as, "phase": phase, "phaseNote": note,
                        "source": {"type": "discord", "url": MODLIST_CHANNEL, "file": stem + ".twmods",
                                   "author": "Readman / Kerberos"},
                        "entries": out})
        if modernized:
            presets[-1]["modernized"] = [{k: v for k, v in x.items() if v} for x in modernized]

    guides = []
    for doc in kpw.get("docs", []):
        entries = []
        for e in sorted(doc.get("entries", []), key=lambda e: e.get("order", 0)):
            t = None
            if e.get("steamId"):
                t = stub_for(e["steamId"])
            elif e.get("loversLabId") and e["loversLabId"] in ll_by_url:
                t = {"mod": ll_by_url[e["loversLabId"]]}
            elif e.get("pack") and len(e["pack"]) > 3:
                # Guides name packs by prefix ("Seu_Miaoying" for seu_miaoying_submod_extension.pack).
                prefix = e["pack"].lower().removesuffix(".pack")
                t = pack_owner.get(prefix + ".pack") or next(
                    (o for p, o in pack_owner.items() if p.lstrip("!@") .startswith(prefix.lstrip("!@"))), None)
            entry = {"name": e["name"], "optional": bool(e.get("optional"))}
            if t:
                entry["target"] = t
            if e.get("otherUrl"):
                entry["url"] = e["otherUrl"]
            if e.get("note"):
                entry["note"] = e["note"]
            entries.append(entry)
        guides.append({"character": doc["character"], "campaigns": doc.get("campaigns") or [],
                       "dlc": doc.get("dlc", []), "notes": doc.get("generalNotes", []), "entries": entries,
                       "source": {"type": "discord", "url": doc.get("url", ""), "author": "KPW"}})

    presets += guide_and_derived_presets(mods, external, presets, guides, steam)

    # Mechanical facts always come fresh from the latest crawl, never from curation: LL version/date,
    # Steam update time. This keeps the catalog current without any manual or AI step.
    ll_index = load(CURATOR / "raw" / "ll" / "_index.json")
    for m in mods.values():
        ll = m.get("sources", {}).get("loverslab")
        if ll and ll["fileId"] in ll_index:
            ll["version"] = ll_index[ll["fileId"]].get("version") or ll.get("version")
            ll["updated"] = ll_index[ll["fileId"]].get("updated") or ll.get("updated")
            raw_ll = CURATOR / "raw" / "ll" / f"{ll['fileId']}.json"
            downloads = str((load(raw_ll) if raw_ll.exists() else {}).get("downloads") or "").replace(",", "")
            if downloads.isdigit():
                ll["downloads"] = int(downloads)
        elif ll and ll_index and m.get("status") not in ("superseded", "abandoned"):
            m["status"] = "abandoned"  # the LL page is gone
            m.setdefault("knownIssues", []).append("The LoversLab page was removed.")
        for s in m.get("sources", {}).get("steam") or []:
            info = steam.get(s["id"], {})
            if info.get("updated"):
                s["updated"] = datetime.fromtimestamp(info["updated"], timezone.utc).date().isoformat()
            if info.get("subscriptions") is not None:
                s["subscribers"] = info["subscriptions"]

    # LL download lists (read with the user's LL login): every file a mod offers, for the installer.
    ll_files_path = CURATOR / "raw" / "ll_files.json"
    ll_files = load(ll_files_path) if ll_files_path.exists() else {}
    for m in mods.values():
        ll = m.get("sources", {}).get("loverslab")
        info = ll_files.get(ll["fileId"]) if ll else None
        if not info:
            continue
        page = ll["url"].rstrip("/") + "/?do=download"
        dl = m["sources"].setdefault("downloads", [])
        known = {d["name"] for d in dl}
        if info["kind"] == "multi":
            for f in info["files"]:
                if f.get("external"):
                    ll["externalDownload"] = True
                elif not re.search(r"\.(png|jpe?g|gif|webp)$", f["name"], re.I) and f["name"] not in known:
                    dl.append({"name": f["name"], "url": page, "note": f.get("size")})
        elif info["kind"] == "single":
            ll["singleFile"] = info["archive"]
        else:
            ll["externalDownload"] = True
        if not dl:
            m["sources"].pop("downloads")

    # Images: LL cover/screenshots/inline images and Steam previews, then curator captions on top.
    hidden_path = CURATOR / "raw" / "steam_hidden.json"
    steam_hidden = load(hidden_path) if hidden_path.exists() else {}
    extra_images = load(CURATOR / "work" / "images-extra.json") if (CURATOR / "work" / "images-extra.json").exists() else {}
    desc = {}
    for f in sorted(glob.glob(str(CURATOR / "work" / "desc-*.json"))):
        desc |= load(f)
    creator_names = {k: unescape(v) for k, v in (load(CURATOR / "raw" / "steam_creators.json") if (CURATOR / "raw" / "steam_creators.json").exists() else {}).items()}
    # External mods (MCT, Variant Selector, …) get the same credits from their Workshop item.
    for e in external.values():
        if e.get("steamId") and (cid := (steam.get(e["steamId"]) or {}).get("creator")):
            if creator_names.get(cid):
                e.setdefault("authors", [creator_names[cid]])
            e["authorPages"] = [{k: v for k, v in {"site": "steam", "name": creator_names.get(cid),
                                 "url": f"https://steamcommunity.com/profiles/{cid}/myworkshopfiles/?appid=1142710"}.items() if v}]
            if links := support_links((steam.get(e["steamId"]) or {}).get("description", "")):
                e["support"] = links
    for m in mods.values():
        # Support links and author pages from the mod's own LoversLab and Workshop pages.
        ll = m.get("sources", {}).get("loverslab")
        ll_raw = load(CURATOR / "raw" / "ll" / f"{ll['fileId']}.json") if ll and (CURATOR / "raw" / "ll" / f"{ll['fileId']}.json").exists() else {}
        steam_ids = [s["id"] for s in m.get("sources", {}).get("steam", []) or []] if m.get("kind") != "collection" else []
        texts = [ll_raw.get("description", "")] + [(steam.get(i) or {}).get("description", "") for i in steam_ids] \
            + [(steam_hidden.get(i) or {}).get("description", "") for i in steam_ids]
        if links := support_links(*texts):
            m["support"] = links
        pages = []
        if ll_raw.get("author_url"):
            pages.append({"site": "loverslab", "name": unescape(ll_raw.get("author") or "") or None, "url": ll_raw["author_url"]})
        for i in steam_ids[:1]:
            if cid := (steam.get(i) or {}).get("creator"):
                pages.append({"site": "steam", "name": creator_names.get(cid),
                              "url": f"https://steamcommunity.com/profiles/{cid}/myworkshopfiles/?appid=1142710"})
                # Mods without a curated author are credited to their Workshop uploader.
                if not m.get("authors") and creator_names.get(cid):
                    m["authors"] = [creator_names[cid]]
        if pages:
            m["authorPages"] = [{k: v for k, v in p.items() if v} for p in pages]

        imgs = []
        raw_path = CURATOR / "raw" / "ll" / f"{ll['fileId']}.json" if ll else None
        if raw_path and raw_path.exists():
            ri = load(raw_path).get("images") or {}
            if ri.get("thumbnail"):
                imgs.append({"url": ri["thumbnail"], "kind": "cover", "source": "loverslab"})
            imgs += [{"url": s["full"], "thumb": s.get("thumb"), "kind": "screenshot", "source": "loverslab"}
                     for s in ri.get("screenshots", [])]
            imgs += [{"url": u, "kind": "other", "source": "loverslab"} for u in ri.get("inline", [])]
        for s in m.get("sources", {}).get("steam", []) or []:
            if steam.get(s["id"], {}).get("preview_url"):
                imgs.append({"url": steam[s["id"]]["preview_url"], "kind": "cover" if not imgs else "screenshot",
                             "source": "steam"})
            # Hidden/adult Workshop pages read with the user's login: preview + screenshots.
            for u in steam_hidden.get(s["id"], {}).get("images") or []:
                imgs.append({"url": u, "kind": "cover" if not imgs else "screenshot", "source": "steam"})
        # Images found by hand or by research (Nexus pages, Discord previews mirrored, …): {mod id: [ModImage]}.
        imgs += extra_images.get(m["id"], [])
        d = desc.get(m["id"], {})
        captions = d.get("images", {})
        seen, out = set(), []
        for img in imgs:
            # LL pages without a thumbnail report the bare folder ".../screenshots/" as og:image.
            if img["url"] in seen or not re.search(r"/[^/]+\.[a-z0-9]{3,4}(\?.*)?$|steamusercontent\.com/ugc/", img["url"], re.I):
                continue
            seen.add(img["url"])
            c = captions.get(img["url"], {})
            if c.get("drop"):
                continue
            img |= {k: v for k, v in c.items() if k in ("kind", "caption")}
            out.append(img)
        # LL serves "X.png.<hash>.png" and "X.thumb.png.<hash2>.png"; keep one entry per picture.
        def base(u):
            return re.sub(r"(\.thumb)?\.(png|jpe?g|gif|webp)\..*$", "", u, flags=re.I)
        fulls = {base(i["url"]): i for i in out if ".thumb." not in i["url"]}
        merged = []
        for i in out:
            if ".thumb." in i["url"] and base(i["url"]) in fulls:
                fulls[base(i["url"])].setdefault("thumb", i["url"])
                continue
            merged.append(i)
        if merged:
            m["images"] = merged
        for k in ("description", "features", "recommendedFor", "summary"):
            if d.get(k):
                m[k] = d[k]
        if m["id"].startswith("steam-"):  # stubs get their basic facts from the description pass
            for k in ("kind", "authors", "name"):
                if d.get(k):
                    m[k] = d[k]
            # Only raise placeholder confidence; keep curation a part/followup file already set.
            if d.get("description") and m.get("curation", {}).get("confidence", "low") == "low":
                m["curation"] = {"lastChecked": TODAY, "confidence": "medium",
                                 "openQuestions": ["Dependencies taken from the Steam description only."]}

    # Normal gameplay/UI/visual mods that the lewd lists use (manual.json "generalMods").
    for mid in man.get("generalMods", {}).get("ids", []):
        if mid in mods and "general" not in mods[mid]["tags"]:
            mods[mid]["tags"] = mods[mid]["tags"] + ["general"]

    # Script errors players sent from the app (counts only, see fetch_reports.py). One player's report is
    # not enough: an error becomes a known issue once 3 different players reported it, and only until the
    # mod gets an update after the last report.
    reports_path = CURATOR / "raw" / "error_reports.json"
    for e in load(reports_path) if reports_path.exists() else []:
        m = mods.get(e.get("modId") or "")
        if not m or e["players"] < 3:
            continue
        src = m.get("sources", {})
        dates = [s.get("updated") for s in src.get("steam") or [] if s.get("updated")] + [(src.get("loverslab") or {}).get("updated")]
        if any(d and d[:10] > e["last"][:10] for d in dates):
            continue
        message = e["signature"].split(" | ", 1)[-1]
        games = f", game {', '.join(e['games'])}" if e.get("games") else ""
        m.setdefault("knownIssues", []).append(f"Script error reported by {e['players']} players through the app{games}: {message}")

    # Support links often sit on other people's pages (a campaign page links its submodder's Patreon).
    # A link belongs to the author on whose mods it appears most, relative to how many mods they have;
    # on everyone else's mods it is marked with that owner.
    per_author, link_count = Counter(), defaultdict(Counter)
    for m in list(mods.values()) + list(external.values()):
        if m.get("authors"):
            m["authors"] = [unescape(a) for a in m["authors"]]  # LL pages give "Calm&amp;NormalTime"
    for m in list(mods.values()) + list(external.values()):
        if a := (m.get("authors") or [None])[0]:
            per_author[a] += 1
            for s in m.get("support", []):
                link_count[s["url"].lower()][a] += 1
    owner = {u: max(c, key=lambda a: (c[a] / per_author[a], c[a])) for u, c in link_count.items()}
    for m in list(mods.values()) + list(external.values()):
        a = (m.get("authors") or [None])[0]
        for s in m.get("support", []):
            if owner.get(s["url"].lower(), a) != a:
                s["owner"] = owner[s["url"].lower()]

    preset_desc = load(CURATOR / "work" / "preset-desc.json") if (CURATOR / "work" / "preset-desc.json").exists() else {}
    for p in presets:
        p |= {k: v for k, v in preset_desc.get(p["id"], {}).items() if k in ("description", "highlights", "coverMods")}

    catalog = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": [
            {"source": "loverslab",
             "fetchedAt": datetime.fromtimestamp((CURATOR / "raw" / "ll" / "_index.json").stat().st_mtime,
                                                 timezone.utc).isoformat(timespec="seconds"),
             "detail": "Club 208 Warhammer 3: Mods, Models, Textures, Translations"},
            {"source": "wiki", "fetchedAt": "2026-10-31", "detail": "Lewdhammer Wiki: Installing Mods, Mod Load Order, Debugging"},
            {"source": "discord", "fetchedAt": "2026-10-31", "detail": "LazyIcarus's Hub: rules-and-links, faq, many-modlist-methods (+ .twmods)"},
        ],
        "mods": sorted(mods.values(), key=lambda m: m["name"].lower()),
        "external": sorted((e for e in external.values() if e["id"] not in ext_to_mod), key=lambda e: e["id"]),
        "tiers": TIERS,
        "notes": notes,
        "presets": presets,
        "campaignGuides": guides,
        # Major game updates (update.py reads them from the game's Steam announcements).
        "gameUpdates": load(CURATOR / "raw" / "game_updates.json") if (CURATOR / "raw" / "game_updates.json").exists() else [],
    }
    # Only a real content change gets a new timestamp: otherwise every scheduled build would commit a
    # "new" catalog and every app would download it again.
    previous = load(OUT) if OUT.exists() else None
    strip = lambda c: {k: v for k, v in c.items() if k not in ("generatedAt", "sources")}
    if previous and strip(previous) == strip(catalog):
        catalog["generatedAt"], catalog["sources"] = previous["generatedAt"], previous["sources"]
    else:
        OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), "utf-8")

    low = [m for m in mods.values() if m.get("curation", {}).get("confidence") == "low" and not m["id"].startswith("steam-")]
    lines = [f"# Katalog-Report ({catalog['generatedAt']})", "",
             f"- Mods: {len(mods)} (davon {len(stubs)} Steam-Platzhalter), externe Mods: {len(external)}, "
             f"Notizen: {len(notes)}, Vorlagen: {len(presets)}",
             f"- Unaufgelöste Verweise: {len(set(unresolved))}", f"- Unsichere kuratierte Einträge: {len(low)}", ""]
    if dupes:
        lines += ["## Doppelte Einträge", *[f"- {d}" for d in dupes], ""]
    if self_refs:
        lines += ["## Verweise auf sich selbst", *[f"- {d}" for d in sorted(set(self_refs))], ""]
    lines += ["## Unaufgelöste Verweise", *[f"- {u}" for u in sorted(set(unresolved))], ""]
    lines += ["## Steam-Platzhalter (noch zu kuratieren)"]
    lines += [f"- steam-{sid}: {m['name']}" for sid, m in sorted(stubs.items())]
    lines += ["", "## Unsichere kuratierte Einträge"]
    for m in low:
        qs = "; ".join(m["curation"].get("openQuestions") or [])
        lines.append(f"- {m['id']} {m['name']}: {qs}")
    REPORT.write_text("\n".join(lines) + "\n", "utf-8")
    print(f"{len(mods)} mods ({len(stubs)} steam stubs), {len(presets)} presets, "
          f"{len(set(unresolved))} unresolved, {len(low)} low confidence -> {OUT}")


if __name__ == "__main__":
    main()
