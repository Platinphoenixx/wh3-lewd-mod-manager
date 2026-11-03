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
import hashlib
import heapq
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
    entries = preset_entries(mods, external, steam, target)
    return entries[0] if entries else None


def preset_entries(mods: dict, external: dict, steam: dict, target: dict) -> list:
    """Preset entries for a catalog target: one per pack the mod needs (the app loads exactly the packs a template
    names, so a mod with a main and an asset pack needs both). Of a pick-one group the first is the default; a mod made
    only of pick-one packs gets one entry without an exact pack, so the player's choice in the app applies."""
    (k, v), = target.items()
    if k == "external":
        return [preset_entry(mods, external, steam, target)]
    if k != "mod" or v not in mods:
        return []
    m = mods[v]
    sids = [s["id"] for s in m.get("sources", {}).get("steam") or [] if not s.get("removed")]
    if m.get("kind") == "collection" or any(s in steam_collections() for s in sids):
        return []  # a Steam collection is no installable item; its members come in through their own relations
    def entry(p):
        return {"pack": p["file"], "from": p.get("from", "download"), **({"steamId": p["steamId"]} if p.get("steamId") else {}), "target": target}
    needed = [p for p in m.get("packs") or [] if not p.get("optional")]
    plain = [p for p in needed if not p.get("exclusiveGroup")]
    if plain:
        groups, out = set(), [entry(p) for p in plain]
        for p in needed:
            if p.get("exclusiveGroup") and p["exclusiveGroup"] not in groups:
                groups.add(p["exclusiveGroup"])
                out.append(entry(p))
        return out
    if needed and not sids:
        return [{"pack": m["name"], "from": needed[0].get("from", "download"), "target": target}]
    for s in sids:
        packs = steam.get(s, {}).get("packs") or [m["name"]]
        return [{"pack": p, "from": "steam", "steamId": s, "target": target} for p in packs]
    return [{"pack": m["name"], "from": "download", "target": target}]


_collections = None


def steam_collections() -> set:
    """Workshop items that are Steam collections (raw/steam_required.json)."""
    global _collections
    if _collections is None:
        p = CURATOR / "raw" / "steam_required.json"
        _collections = set(load(p).get("collections", [])) if p.exists() else set()
    return _collections


def guide_and_derived_presets(mods: dict, external: dict, presets: list, guides: list, steam: dict) -> list:
    """
    Presets that need no hand-made list: one per KPW guide, and one per campaign/progression mod whose
    characters no tested list covers (the mod plus everything it requires). They follow the catalog
    automatically, so updating the catalog updates them.
    """
    out = []
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())

    def guide_entries(e: dict) -> list:
        """A guide that names a pack of the mod (e.g. Soil's Kislev units) means that pack, not the mod's default."""
        mod = mods.get((e["target"] or {}).get("mod")) or {}
        tok = norm(re.sub(r"\.pack$", "", e.get("pack") or "", flags=re.I))
        packs = (mod.get("packs") or []) if len(tok) >= 5 else []
        stem = lambda p: norm(re.sub(r"\.pack$", "", p["file"], flags=re.I))
        # The exact pack, else the only one it starts, else the only one that contains it ("Non slaanesh").
        hits = [p for p in packs if stem(p) == tok] or [p for p in packs if stem(p).startswith(tok)]
        if len(hits) != 1:
            hits = [p for p in packs if tok in stem(p)]
        if len(hits) == 1:
            p = hits[0]
            return [{"pack": p["file"], "from": p.get("from", "download"), **({"steamId": p["steamId"]} if p.get("steamId") else {}),
                     "target": e["target"]}]
        return preset_entries(mods, external, steam, e["target"])

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

    for g in guides:
        entries = [e for e in g["entries"] if e.get("target") and not e.get("optional")]
        built = [x for e in entries for x in guide_entries(e) if x]
        if not built:
            continue
        # A guide lists what its author downloads; what those mods strictly need (e.g. MCT for Lazy's framework)
        # comes in too, since the app loads exactly the template's packs.
        have = {json.dumps(x["target"], sort_keys=True) for x in built}
        for e in entries:
            if "mod" not in e["target"]:
                continue
            for dep in requires_closure(e["target"]["mod"])[1:]:
                if json.dumps(dep, sort_keys=True) not in have:
                    have.add(json.dumps(dep, sort_keys=True))
                    built += preset_entries(mods, external, steam, dep) if "mod" in dep else [x for x in [preset_entry(mods, external, steam, dep)] if x]
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

        built = [x for t in sorted(targets, key=rank, reverse=True) for x in preset_entries(mods, external, steam, t) if x]
        out.append({"id": f"derived-{m['id']}", "name": f"{m['name']}", "origin": "derived",
                    "playAs": chars, "phase": "any",
                    "phaseNote": "Built from the mod's own page: the mod and everything it requires, ordered by type. "
                                 "Not a tested list; check the mod page for extra steps.",
                    "source": {"type": "derived", "url": (m.get("sources", {}).get("loverslab") or {}).get("url")},
                    "description": m.get("summary", ""), "coverMods": [m["id"]], "entries": built})
    return out


def community_presets(presets: list, mods: dict, external: dict, pack_owner: dict, unresolved: list) -> list:
    """
    Setups players shared from the app (curator/raw/community_setups.json, from fetch_community.py) as templates with
    origin "community". A list made only of catalog mods is shown right away; one with own or unknown packs only after
    a maintainer accepted its issue (community.json, type "setup"). Entries are matched to the catalog again, so a mod
    id that changed since still finds its mod; a pack nobody knows keeps no target.
    """
    path = CURATOR / "raw" / "community_setups.json"
    if not path.exists():
        return []
    cpath = CURATOR / "community.json"
    accepted = {c.get("setupId") for c in (load(cpath).get("accepted", []) if cpath.exists() else []) if c.get("type") == "setup"}
    by_id = {p["id"]: p for p in presets}
    out = []
    for s in load(path):
        ok = not s.get("review") or s["id"] in accepted
        entries = []
        for e in s.get("entries", []):
            t = {"mod": e["mod"]} if e.get("mod") in mods else {"external": e["mod"]} if e.get("mod") in external \
                else pack_owner.get(e["pack"].lower())
            if not t and not ok:
                break
            entries.append({"pack": e["pack"], "from": "steam" if e.get("steamId") or (t and "steamId" in t) else "download",
                            **({"steamId": e["steamId"]} if e.get("steamId") else {}), **({"target": t} if t else {})})
        else:
            if not ok:
                continue
            base = by_id.get(s.get("base") or "")
            out.append({
                "id": f"community-{s['id']}", "name": s["name"],
                "playAs": s.get("playAs") or (base or {}).get("playAs", []),
                **({"theme": s.get("theme") or base.get("theme")} if s.get("theme") or (base or {}).get("theme") else {}),
                "phase": "any", "origin": "community",
                "source": {"type": "community", "author": s.get("shownAs") or "anonymous", "date": s["at"][:10]},
                **({"description": s["notes"]} if s.get("notes") else {}),
                "entries": entries,
                "community": {k: v for k, v in {"base": s.get("base"), "far": s.get("far"), "game": s.get("game"),
                                                "own": s.get("own")}.items() if v},
            })
            continue
        unresolved.append(f"shared setup {s['id']}: packs the catalog does not know, waits for a maintainer")
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


def merge_entry(base: dict, m: dict) -> dict:
    """A layer entry replaces fields whole; "field+" appends to a list field and "field-" drops the items that
    contain one of the given texts (strings) or point at one of the given targets (relations: mod id)."""
    out = base | {k: v for k, v in m.items() if not k.endswith(("+", "-"))}
    for k, v in m.items():
        if k.endswith("-"):
            f = k[:-1]
            def hit(x):
                if isinstance(x, str):
                    return any(s in x for s in v)
                t = x.get("target") or {}
                return any(s in (t.get("mod"), t.get("external"), t.get("pack"), t.get("steamId"), x.get("file")) for s in v)
            out[f] = [x for x in out.get(f) or [] if not hit(x)]
    for k, v in m.items():
        if k.endswith("+"):
            f = k[:-1]
            out[f] = list(out.get(f) or []) + [x for x in v if x not in (out.get(f) or [])]
    return out


def main():
    # auto-new.json: entries generated by update.py for mods nobody has curated yet (lowest priority:
    # any curated part/followup/manual entry for the same id replaces it field by field).
    parts = [str(p) for p in [CURATOR / "work" / "auto-new.json"] if p.exists()]
    parts += sorted(glob.glob(str(CURATOR / "work" / "part-*.json")))
    # followup-*.json: field overrides from later curation passes (same shape as a part)
    # Later passes win: LL and Steam follow-ups first, then research, then community contributions.
    order = {"followup-ll.json": 0, "followup-steam.json": 1, "followup-research.json": 2, "followup-review.json": 3, "followup-archives.json": 4, "followup-discord.json": 4.5, "followup-community.json": 5}
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
            mods[m["id"]] = merge_entry(mods.get(m["id"], {}), m)
        for e in d.get("external", []):
            external.setdefault(e["id"], e)
        notes += d.get("notes", [])

    # Nexus Mods finds (read by hand on nexusmods.com, raw/nexus/list-*.txt; curated in work/nexus-curation.json).
    # Mods that are mirrors of catalog entries only get their Nexus page added.
    nexus_cur_path = CURATOR / "work" / "nexus-curation.json"
    nexus_cur = load(nexus_cur_path) if nexus_cur_path.exists() else {"same": {}, "mods": {}}

    def count(v: str) -> int:
        v = v.strip().lower().replace(",", "")
        return int(float(v[:-1]) * 1000) if v.endswith("k") else int(float(v)) if v.replace(".", "").isdigit() else 0

    def nexus_date(v: str):
        try:
            return datetime.strptime(v.replace("Sept", "Sep"), "%d %b %Y").date().isoformat()
        except ValueError:
            return None

    def apply_nexus_details(m: dict, det: dict, source: dict):
        """What the mod page itself says (work/nexus-curation.json "details") replaces the list-page guesses."""
        page = {"type": "nexus", "url": source["url"]}
        target = lambda t: t if isinstance(t, dict) else {"mod": t}
        source.update({k: det[k] for k in ("version", "updated") if det.get(k)})
        if det.get("packs"):
            m["packs"] = [{"file": p["file"], "from": "download", **{k: p[k] for k in ("optional", "exclusiveGroup", "note") if k in p}}
                          for p in det["packs"]]
        if "requires" in det:
            m["relations"] = [r for r in m["relations"] if r["kind"] != "requires"]
            m["relations"] += [{"kind": "requires", "target": target(t), "note": det.get("requiresNote") or "Stated on the Nexus page.", "source": page}
                               for t in det["requires"]]
        m["relations"] += [{"kind": "incompatible", "target": target(c["target"]), "note": c["note"], "source": page}
                           for c in det.get("incompatible", [])]
        m["relations"] += [{"kind": "supersedes", "target": target(t), "note": "The author's newer version.", "source": page}
                           for t in det.get("supersedes", [])]
        m["relations"] += [{"kind": "recommends", "target": target(r["target"]), "note": r["note"], "source": page}
                           for r in det.get("recommends", [])]
        if det.get("requiresDlc"):
            m["requiresDlc"] = det["requiresDlc"]
        if det.get("loadOrder"):
            m["loadOrder"] = {"note": det["loadOrder"]}
        for k in ("knownIssues", "support"):
            if det.get(k):
                m[k] = det[k]
        if det.get("notes"):
            m["installNotes"] = det["notes"]
        if det.get("status"):
            m["status"] = det["status"]
        m["curation"] = {"lastChecked": "2026-11-01", "confidence": "medium",
                         "openQuestions": det.get("openQuestions", []) + ["Read on the Nexus mod page; not checked in game."]}

    for f in sorted(glob.glob(str(CURATOR / "raw" / "nexus" / "list-*.txt"))):
        for line in open(f, encoding="utf-8"):
            p = [x.strip() for x in line.split(" | ")]
            if len(p) < 10:
                continue
            nid, title, author, adult, uploaded, _updated, endorse, downloads, image, summary = p[:10]
            source = {"modId": nid, "url": f"https://www.nexusmods.com/totalwarwarhammer3/mods/{nid}",
                      "uploaded": nexus_date(uploaded), "endorsements": count(endorse), "downloads": count(downloads),
                      "adult": adult == "A"}
            source = {k: v for k, v in source.items() if v not in (None, "")}
            if (same := nexus_cur["same"].get(nid)) and same in mods:
                mods[same].setdefault("sources", {})["nexus"] = source
                continue
            cur = nexus_cur["mods"].get(nid)
            if not cur:
                continue  # not part of the lewd scene (game-wide tools, translations, savegames)
            kind, tags, play_as, text, needs = cur[:5]
            extra_tags = cur[5:]
            mid = f"nx-{nid}"
            mods.setdefault(mid, {
                "id": mid, "name": title, "authors": [author], "kind": kind,
                "summary": text,
                "tags": [t for t in tags.split(",") if t] + [t for t in extra_tags if t],
                "playAs": [{"character": c} for c in play_as.split(",") if c] or None,
                "images": [{"url": f"https://staticdelivery.nexusmods.com/mods/4717/images/{nid}/{image}",
                            "thumb": f"https://staticdelivery.nexusmods.com/mods/4717/images/thumbnails/{nid}/{image}",
                            "kind": "cover", "source": "nexus"}] if image else [],
                "sources": {"nexus": source},
                "packs": [{"file": f, "from": "download"} for f in nexus_cur.get("packs", {}).get(nid, [])],
                "relations": [{"kind": "requires", "target": {"mod": n}, "note": "Stated on the Nexus page.",
                               "source": {"type": "nexus", "url": source["url"]}} for n in needs],
                "curation": {"lastChecked": "2026-11-01", "confidence": "low",
                             "openQuestions": ["From the Nexus list page only: requirements, pack names and conflicts not checked on the mod page."]},
            })
            if (det := nexus_cur.get("details", {}).get(nid)):
                apply_nexus_details(mods[mid], det, source)
            if not mods[mid]["playAs"]:
                del mods[mid]["playAs"]
            # Characters reskinned here are not playable characters of a campaign: playAs is for campaigns.
            if kind != "campaign":
                chars = [c["character"] for c in mods[mid].pop("playAs", [])]
                mods[mid]["tags"] += [c.lower() for c in chars]

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
    # Mods that a Discord post calls active: posts about features merged into them ("deprecated") do not demote them.
    active_on_discord = {i for d in dc_mods if d.get("status") == "active"
                         for i in [next((ll_id(u) for u in d.get("loversLab", []) if ll_id(u)), None)] if i}
    for d in dc_mods:
        # Discord posts about mods that already have an LL page enrich that entry instead.
        existing = next((ll_id(u) for u in d.get("loversLab", []) if ll_id(u)), None)
        mid = existing or "dc-" + re.sub(r"[^a-z0-9]+", "-", d["name"].lower()).strip("-")[:60]
        if mid in merge_mods:
            mid = existing = merge_mods[mid]
        m = mods.setdefault(mid, {
            "id": mid, "name": d["name"], "authors": d.get("authors", []), "kind": d.get("kind", "submod"), "tags": [],
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
        # A post about a feature that was merged into a mod links that mod's page; when another post calls the mod
        # active, the feature's "deprecated" is not about the mod it lives in now.
        if d.get("status") in ("abandoned", "deprecated", "superseded", "beta", "wip", "stable") and not (
                mid in active_on_discord and d["status"] in ("abandoned", "deprecated", "superseded")):
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
            # A pack the mod's Workshop items contain comes from Steam; one from a LoversLab analysis is a download.
            src_ = m.get("sources", {})
            on_steam = {p.lower() for s in src_.get("steam") or [] for p in steam.get(s["id"], {}).get("packs") or []}
            m["packs"] = [{"file": name, "from": "steam" if name.lower() in on_steam or (src_.get("steam") and not src_.get("loverslab"))
                           else "download"} for name in a["packs"]]
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
        # Per pack: a dependency of an optional or pick-one pack (or of a pack the entry does not list) only
        # holds with that pack, so it becomes a condition instead of a requirement of the whole mod.
        deps = {}
        for key, info in (a.get("perPack") or {}).items():
            name = key.rsplit("/", 1)[-1]
            ref = next((p for p in m["packs"] if p["file"].lower() == name.lower()), None)
            cond = None if ref and not ref.get("optional") and not ref.get("exclusiveGroup") else f"only with {name}"
            for d in info.get("dependencies") or []:
                if d.lower() not in own and (d not in deps or cond is None):
                    deps[d] = cond
        for d in a.get("dependencies", []):
            if d.lower() not in own and d not in deps:
                deps[d] = None
        header_deps[m["id"]] = deps
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

    # Steam mods whose pages name no pack: the packs their Workshop items really contain (raw/steam_items.json
    # "packs", read from the downloaded Workshop folders).
    for m in mods.values():
        if m.get("packs") or m.get("kind") == "collection":
            continue
        m["packs"] = [{"file": p, "from": "steam", "steamId": s["id"]}
                      for s in m.get("sources", {}).get("steam") or [] for p in steam.get(s["id"], {}).get("packs") or []]

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
        if m["id"] in mods:
            # A Discord-only entry (dc-…) exists only from the Discord step on.
            mods[m["id"]] = merge_entry(mods[m["id"]], m)
        elif m["id"].startswith("steam-"):
            stub_for(m["id"].removeprefix("steam-"))
            mods[m["id"]] = merge_entry(mods[m["id"]], m)
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
        # {"ref": "...", "condition": "..."}: a requirement that only holds in a case (e.g. one campaign).
        cond = raw.get("condition") if isinstance(raw, dict) else None
        raw = raw["ref"] if isinstance(raw, dict) else raw
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
        mods[mid]["relations"].append({"kind": kind, "target": t, "note": raw, **({"condition": cond} if cond else {}),
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
        for dep, cond in deps.items():
            mods[mid]["relations"].append({"kind": "requires", "target": {"pack": dep},
                                           "note": f"Named as a dependency in the mod's pack ({dep})",
                                           **({"condition": cond} if cond else {}),
                                           "source": {"type": "inferred"}, "_header": True})

    # Required items the Workshop pages list (raw/steam_required.json, Steam Web API): the author's own declaration.
    # A collection's children are its members; a translation lists the mods it translates (it extends them).
    req_path = CURATOR / "raw" / "steam_required.json"
    req_data = load(req_path) if req_path.exists() else {}
    steam_req, collections = req_data.get("items", {}), set(req_data.get("collections", []))
    only_recommended = req_data.get("recommendationsOnly", {})

    def add_steam_required(m: dict) -> None:
        if m.get("kind") == "collection":
            return
        own = {s["id"] for s in m.get("sources", {}).get("steam") or []}
        for s in m.get("sources", {}).get("steam") or []:
            if s.get("removed") or s["id"] in collections:
                continue
            for child in (steam_req.get(s["id"]) or {}).get("required", []):
                if child not in own:
                    if m.get("kind") == "translation":
                        kind, note = "extends", "Translated mod (listed as a required item on the Workshop page)"
                    elif s["id"] in only_recommended:
                        kind, note = "recommends", "Listed on the Workshop page, which says its required items are only recommendations"
                    else:
                        kind, note = "requires", "Listed as a required item on the Workshop page"
                    m["relations"].append({"kind": kind, "target": {"steamId": child}, "note": note,
                                           "source": {"type": "steam"}, "_steamreq": True})

    def finish_relations(m: dict) -> None:
        for r in m.get("relations", []):
            r["target"] = resolve(m["id"], r["target"], r["kind"])
        # Generated relations add nothing when a curated one already names the same mod (the curated one may
        # deliberately say otherwise, e.g. "optional" for a listed item the page says is no longer needed);
        # a pack-header dependency also gives way to a Workshop requirement.
        key = lambda r: json.dumps(r["target"], sort_keys=True)
        curated = {key(r) for r in m.get("relations", []) if not r.get("_header") and not r.get("_steamreq")}
        listed = {key(r) for r in m.get("relations", []) if r.get("_steamreq")}
        kept, seen_gen = [], set()
        for r in m.get("relations", []):
            if r.get("_steamreq") or r.get("_header"):
                k = key(r)
                if k in curated or (r.get("_header") and k in listed) or (k, r.get("condition")) in seen_gen:
                    continue
                seen_gen.add((k, r.get("condition")))
            kept.append(r)
        m["relations"] = kept
        for r in m["relations"]:
            r.pop("_header", None)
            r.pop("_steamreq", None)
            if r["target"] == {"mod": m["id"]} and r.get("source", {}).get("type") != "discord":
                self_refs.append(m["id"])
        # A relation to one of the mod's own packs/items (e.g. ATB "requires" its asset pack) is no relation; the same
        # relation from two sources is listed once (the first, which keeps its note).
        same, unique = set(), []
        for r in m.get("relations", []):
            k = (r["kind"], json.dumps(r["target"], sort_keys=True), r.get("condition"))
            if r["target"] != {"mod": m["id"]} and k not in same:
                same.add(k)
                unique.append(r)
        m["relations"] = unique
        lo = m.get("loadOrder") or {}
        for side in ("above", "below"):
            if lo.get(side):
                lo[side] = [resolve(m["id"], t, "loadOrder." + side) for t in lo[side]]

    # Resolving creates Steam stubs for referenced items; those get their own required items too (which may
    # create further stubs), until no new mod appears.
    finished = set()
    while todo := [m for m in list(mods.values()) if m["id"] not in finished]:
        for m in todo:
            add_steam_required(m)
            finish_relations(m)
            finished.add(m["id"])

    # A requirement of an outdated mod that another mod supersedes (a fixed re-upload, e.g. Nymeria 9.0.3) means the
    # successor: the old one is what breaks. Unless the successor is the requiring mod itself. ("Supersedes" alone is
    # not enough: a mod can include another one's look while that one stays a mod of its own.)
    successor = {r["target"]["mod"]: m["id"] for m in mods.values() for r in m.get("relations", [])
                 if r["kind"] == "supersedes" and "mod" in r["target"] and mods.get(r["target"]["mod"], {}).get("status") in INACTIVE}
    for m in mods.values():
        # A Steam collection only bundles items; pages that link one name its members one by one as well.
        def collection(mid):
            t = mods.get(mid) or {}
            return t.get("kind") == "collection" or any(s["id"] in steam_collections() for s in t.get("sources", {}).get("steam") or [])
        m["relations"] = [r for r in m.get("relations", []) if not collection(r["target"].get("mod"))]
        for r in m["relations"]:
            old = r["target"].get("mod")
            if r["kind"] == "requires" and old in successor and successor[old] != m["id"]:
                r["target"] = {"mod": successor[old]}
                r["note"] = (r.get("note") or "") + f" – now its update {mods[successor[old]]['name']}"

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
                # The shortest pack with that prefix is the mod itself, not a translation or patch of it
                # ("seu_miaoying_submod_extension_v0.7.0_cn0930.pack" is a Chinese text pack for it).
                prefix = e["pack"].lower().removesuffix(".pack")
                t = pack_owner.get(prefix + ".pack") or next(
                    (o for p, o in sorted(pack_owner.items(), key=lambda x: len(x[0]))
                     if p.lstrip("!@").startswith(prefix.lstrip("!@"))), None)
            entry = {"name": e["name"], "optional": bool(e.get("optional"))}
            if t:
                entry["target"] = t
            if e.get("pack"):
                entry["pack"] = e["pack"]
            if e.get("otherUrl"):
                entry["url"] = e["otherUrl"]
            if e.get("note"):
                entry["note"] = e["note"]
            entries.append(entry)
        guides.append({"character": doc["character"], "campaigns": doc.get("campaigns") or [],
                       "dlc": doc.get("dlc", []), "notes": doc.get("generalNotes", []), "entries": entries,
                       "source": {"type": "discord", "url": doc.get("url", ""), "author": "KPW"}})

    presets += guide_and_derived_presets(mods, external, presets, guides, steam)

    # The same replacements for guide and derived templates. An entry that names its mod instead of a pack (a mod made
    # of pick-one packs) is replaced when the mod's first needed pack has a replacement. manual.json "noTemplate":
    # mods that get no derived template (e.g. they stop the game at launch).
    no_template = {k for k in man.get("noTemplate", {}) if not k.startswith("_")}
    presets[:] = [p for p in presets if not (p.get("origin") == "derived" and set(p.get("coverMods") or []) & no_template)]
    for p in presets:
        if p.get("origin") not in ("guide", "derived"):
            continue
        out, modernized = [], []
        for pe in p["entries"]:
            key = pe["pack"].lower()
            if key not in replacements:
                mod = mods.get((pe.get("target") or {}).get("mod")) or {}
                needed = [x["file"] for x in mod.get("packs") or [] if not x.get("optional")]
                if not key.endswith(".pack") and needed and needed[0].lower() in replacements:
                    key = needed[0].lower()
            rep = replacements.get(key)
            if rep and rep.get("remove"):
                modernized.append({"from": pe["pack"], "to": "removed", "note": rep.get("note")})
                continue
            if rep:
                new = replacement_entry(rep)
                if entry_key(new) != entry_key(pe):
                    modernized.append({"from": pe["pack"], "to": new["pack"], "note": rep.get("note")})
                    pe = new
            if not any(x["pack"].lower() == pe["pack"].lower() for x in out):
                out.append(pe)
        p["entries"] = out
        if modernized:
            p["modernized"] = (p.get("modernized") or []) + [{k: v for k, v in x.items() if v} for x in modernized]

    # A guide lists mods and a derived template orders them by type; neither is a tested load order, so the
    # catalog's load-order rules apply (first = highest priority). Tested lists keep the order they were played with.
    def rule_order(entries: list) -> list:
        """Stable topological order: every "above"/"below" rule between two entries holds, otherwise the old order."""
        tkey = lambda t: json.dumps(t, sort_keys=True)
        # A guide may list the same pack in several sections; the app keeps only the first, so does the order.
        seen_entries = set()
        entries = [e for e in entries if not ((tkey(e["target"]), e.get("pack")) in seen_entries
                                              or seen_entries.add((tkey(e["target"]), e.get("pack"))))]
        keys = [tkey(e["target"]) for e in entries]
        after = {i: set() for i in range(len(entries))}  # i -> entries that must come after i
        for i, e in enumerate(entries):
            lo = (mods.get(e["target"].get("mod")) or {}).get("loadOrder") or {}
            for t in lo.get("above") or []:
                after[i] |= {j for j, k in enumerate(keys) if k == tkey(t) and j != i}
            for t in lo.get("below") or []:
                for j, k in enumerate(keys):
                    if k == tkey(t) and j != i:
                        after[j].add(i)
        indeg = {i: 0 for i in after}
        for i in after:
            for j in after[i]:
                indeg[j] += 1
        ready = [i for i in after if indeg[i] == 0]
        heapq.heapify(ready)
        out = []
        while ready:
            i = heapq.heappop(ready)
            out.append(i)
            for j in after[i]:
                indeg[j] -= 1
                if indeg[j] == 0:
                    heapq.heappush(ready, j)
        out += [i for i in range(len(entries)) if i not in out]  # rules that contradict each other: keep old order
        return [entries[i] for i in out]

    for p in presets:
        if p.get("origin") in ("guide", "derived"):
            p["entries"] = rule_order(p["entries"])

    # Mechanical facts always come fresh from the latest crawl, never from curation: LL version/date,
    # Steam update time. This keeps the catalog current without any manual or AI step.
    ll_index = load(CURATOR / "raw" / "ll" / "_index.json")
    steam_gone = load(CURATOR / "raw" / "steam_hidden.json") if (CURATOR / "raw" / "steam_hidden.json").exists() else {}
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
            # Gone from the Workshop (the public API knows nothing and even the logged-in page fails): the app
            # must not try to subscribe, it uses the mod's other source.
            if not info.get("public") and "removed" in ((steam_gone.get(s["id"]) or {}).get("error") or ""):
                s["removed"] = True
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

    # The same pack of the same Workshop item from two layers is one pack (the later one adds its note).
    for m in mods.values():
        seen = {}
        for p in m.get("packs", []):
            k = (p["file"].lower(), p.get("steamId"))
            if k in seen:
                seen[k] |= {f: v for f, v in p.items() if f not in seen[k]}
            else:
                seen[k] = p
        m["packs"] = list(seen.values())

    preset_desc = load(CURATOR / "work" / "preset-desc.json") if (CURATOR / "work" / "preset-desc.json").exists() else {}
    for p in presets:
        p |= {k: v for k, v in preset_desc.get(p["id"], {}).items() if k in ("description", "highlights", "coverMods", "theme")}
    presets += community_presets(presets, mods, external, pack_owner, unresolved)

    # Launch test results (curator/launch_test.py) count while the template still has exactly the tested packs;
    # "it worked / it didn't" votes from players (curator/fetch_community.py) belong to every template.
    launch = load(CURATOR / "raw" / "launch_results.json") if (CURATOR / "raw" / "launch_results.json").exists() else {}
    votes = load(CURATOR / "raw" / "votes.json") if (CURATOR / "raw" / "votes.json").exists() else {}
    for p in presets:
        if (v := votes.get(p["id"])) and v["up"] + v["down"]:
            p["votes"] = {"up": v["up"], "down": v["down"]}
        fp = hashlib.sha1("\n".join(sorted(e["pack"].lower() for e in p["entries"])).encode()).hexdigest()[:12]
        if (r := launch.get(p["id"])) and r.get("fingerprint") == fp:
            p["launchTest"] = {"result": r["result"], "game": r["game"], "date": r["date"]}

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
