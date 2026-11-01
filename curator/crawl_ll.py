"""Crawl the LoversLab "Warhammer 3 - Total War" club into raw JSON files.

Output: curator/raw/ll/<file_id>.json, one per LL file, plus curator/raw/ll/_index.json.
The raw files keep the description as readable text (spoilers marked, links inline)
so the curation step can read it without HTML noise.
Files outside the club listing that belong to the scene (curator/extra_ll.json) are fetched on
every run too, with category "other".

Usage:
    curator/.venv/Scripts/python curator/crawl_ll.py            # only new/updated files
    curator/.venv/Scripts/python curator/crawl_ll.py --force    # refetch everything
    curator/.venv/Scripts/python curator/crawl_ll.py --only 43293,24077   # just these ids (index is kept)
"""

import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

BASE = "https://www.loverslab.com"
CATEGORIES = {
    311: "mods",
    312: "models",
    313: "textures",
    314: "translations",
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
DELAY_S = 1.5
OUT = Path(__file__).parent / "raw" / "ll"
EXTRA = Path(__file__).parent / "extra_ll.json"

FILE_URL_RE = re.compile(r"^https://www\.loverslab\.com/files/file/(\d+)-[^/?#]+/?$")
STEAM_ID_RE = re.compile(r"steamcommunity\.com/(?:sharedfiles|workshop)/filedetails/\?(?:[^\"'\s]*&)?id=(\d+)")


def fetch(url: str) -> str:
    return fetch_final(url)[0]


def fetch_final(url: str) -> tuple[str, str]:
    """Body plus the URL after redirects (LL redirects /files/file/<id>/ to the slugged page)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode("utf-8", errors="replace")
        final = r.geturl()
    time.sleep(DELAY_S)
    return body, final


def extra_entries() -> list[dict]:
    """LL files outside the club (curator/extra_ll.json), e.g. older mods linked from Discord.

    A bare /files/file/<id>/ is a 404; any slug redirects to the real page.
    """
    ids = json.loads(EXTRA.read_text("utf-8")).get("files", []) if EXTRA.exists() else []
    return [{"id": str(i), "url": f"{BASE}/files/file/{i}-x/", "category": "other", "extra": True} for i in ids]


def list_category(cat_id: int, slug: str) -> list[dict]:
    items, page = {}, 1
    while True:
        url = f"{BASE}/files/category/{cat_id}-{slug}/page/{page}/?sortby=file_updated&sortdirection=desc"
        soup = BeautifulSoup(fetch(url), "html.parser")
        # Only the main listing; the sidebar ("New Files" etc.) links files from other games.
        listing = soup.select_one("[data-role='tableRows']")
        if listing is None:
            # Empty categories render no table at all; a blocked request has no login form either.
            if soup.select_one("[data-role='loginForm'], form[action*='login']") is None:
                raise RuntimeError(f"no listing found on {url} (blocked or layout changed?)")
            print(f"  {slug} page {page}: empty", file=sys.stderr)
            break
        found = 0
        for a in listing.select("a[href]"):
            href = a["href"].split("?")[0]
            m = FILE_URL_RE.match(href)
            if m and m.group(1) not in items:
                items[m.group(1)] = {"id": m.group(1), "url": href, "category": slug}
                found += 1
        print(f"  {slug} page {page}: {found} files", file=sys.stderr)
        nxt = soup.select_one("li.ipsPagination_next")
        if found == 0 or nxt is None or "ipsPagination_inactive" in (nxt.get("class") or []):
            break
        page += 1
    return list(items.values())


def to_text(node) -> str:
    """Render rich-text HTML as plain text, keeping links and marking spoilers."""
    out: list[str] = []

    def walk(n):
        if isinstance(n, NavigableString):
            out.append(str(n))
            return
        if not isinstance(n, Tag):
            return
        name = n.name
        classes = n.get("class") or []
        if name in ("script", "style", "noscript"):
            return
        if "ipsSpoiler_header" in classes:
            return
        if "ipsSpoiler" in classes:
            out.append("\n[[SPOILER]]\n")
            for c in n.children:
                walk(c)
            out.append("\n[[/SPOILER]]\n")
            return
        if name == "img":
            src = n.get("data-src") or n.get("src") or ""
            if "ipsEmoji" in classes or src.startswith("data:") or "/emoticons/" in src:
                return
            alt = n.get("alt") or ""
            label = "" if alt.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")) else f" {alt}"
            out.append(f"[img {src}{label}]")
            return
        if name == "a":
            href = n.get("href") or ""
            label = n.get_text(" ", strip=True)
            if href and not href.startswith("#"):
                out.append(f"{label} <{href}>" if label and label != href else f"<{href}>")
            else:
                out.append(label)
            return
        block = name in ("p", "div", "li", "h1", "h2", "h3", "h4", "tr", "blockquote", "br", "hr", "ul", "ol")
        if name == "li":
            out.append("\n- ")
        elif block:
            out.append("\n")
        for c in n.children:
            walk(c)
        if block:
            out.append("\n")

    walk(node)
    text = "".join(out).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_file_page(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    title_full = soup.select_one("h1.ipsType_pageTitle").get_text(" ", strip=True)

    version = None
    vt = soup.select_one("[data-role='versionTitle']")
    if vt:
        version = vt.get_text(strip=True)
    title = title_full
    if version and title_full.endswith(" " + version):
        title = title_full[: -len(version) - 1]

    info = {}
    for li in soup.select("li.ipsDataItem"):
        label = li.select_one("strong")
        value = li.select_one(".cFileInfoData")
        if not label or not value:
            continue
        t = value.select_one("time")
        info[label.get_text(strip=True).lower()] = t["datetime"] if t else value.get_text(" ", strip=True)

    author = author_url = None
    for p in soup.select("p.ipsType_large"):
        a = p.select_one("a[href*='/profile/']")
        if a and p.get_text(" ", strip=True).startswith("By "):
            author = a.get_text(strip=True)
            author_url = a.get("href", "").split("?")[0] or None
            break

    tags = [t.get_text(strip=True) for t in soup.select(".ipsTags a.ipsTag span, .ipsTags .ipsTag span")]
    tags = list(dict.fromkeys(t for t in tags if t))

    desc_node = None
    for h in soup.select("h2"):
        if h.get_text(strip=True) == "About This File":
            desc_node = h.find_next(class_="ipsType_richText")
            break
    if desc_node is None:
        desc_node = soup.select_one("section .ipsType_richText")
    description = to_text(desc_node) if desc_node else ""

    changelog = None
    cl = soup.select_one("section[data-controller='downloads.front.view.changeLog']")
    if cl:
        body = cl.select_one(".ipsType_richText")
        changelog = to_text(body) if body else None

    steam_ids = list(dict.fromkeys(STEAM_ID_RE.findall(html_desc_only(desc_node, cl))))
    ll_links = list(dict.fromkeys(
        m.group(1) for m in (FILE_URL_RE.match(x.get("href", "").split("?")[0])
                             for x in (desc_node.select("a[href]") if desc_node else []))
        if m and m.group(1) not in url
    ))

    og = soup.select_one('meta[property="og:image"]')
    screenshots = []
    for el in soup.select("[data-fullurl]"):
        thumb = el.select_one("img")
        shot = {"full": el["data-fullurl"], "thumb": (thumb.get("data-src") or thumb.get("src")) if thumb else None}
        if shot not in screenshots:
            screenshots.append(shot)
    inline = []
    for img in (desc_node.select("img") if desc_node else []):
        src = img.get("data-src") or img.get("src") or ""
        if src and "ipsEmoji" not in (img.get("class") or []) and not src.startswith("data:") and src not in inline:
            inline.append(src)

    return {
        "url": url,
        "title": title,
        "images": {"thumbnail": og["content"] if og else None, "screenshots": screenshots, "inline": inline},
        "version": version,
        "author": author,
        "author_url": author_url,
        "tags": tags,
        "submitted": info.get("submitted"),
        "updated": info.get("updated") or info.get("published") or info.get("submitted"),
        "downloads": info.get("downloads"),
        "steam_ids": steam_ids,
        "ll_file_links": ll_links,
        "description": description,
        "changelog_latest": changelog,
        "download_url": url.rstrip("/") + "/?do=download",
    }


def html_desc_only(*nodes) -> str:
    return " ".join(str(n) for n in nodes if n is not None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="refetch files even if unchanged")
    ap.add_argument("--only", help="comma-separated LL file ids to fetch")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    index_path = OUT / "_index.json"
    old_index = json.loads(index_path.read_text("utf-8")) if index_path.exists() else {}

    wanted = set(args.only.split(",")) if args.only else None
    extras = extra_entries()
    entries: list[dict] = []
    # With --only, known ids need no listing: their URL is in the index (or extra_ll.json).
    known = {i: {"id": i, "url": v["url"], "category": v.get("category")} for i, v in old_index.items() if v.get("url")}
    known |= {e["id"]: e for e in extras}
    if wanted and wanted <= set(known):
        entries = [known[i] for i in sorted(wanted)]
    else:
        for cat_id, slug in CATEGORIES.items():
            print(f"listing {slug}", file=sys.stderr)
            entries += list_category(cat_id, slug)
        listed = {e["id"] for e in entries}
        entries += [e for e in extras if e["id"] not in listed]
        if wanted:
            entries = [e for e in entries if e["id"] in wanted]

    index, changed = {}, []
    for i, e in enumerate(entries, 1):
        path = OUT / f"{e['id']}.json"
        print(f"[{i}/{len(entries)}] {e['url']}", file=sys.stderr)
        try:
            if e.get("extra"):
                body, final = fetch_final(e["url"])
                url = final.split("?")[0] if FILE_URL_RE.match(final.split("?")[0]) else e["url"]
                data = parse_file_page(body, url)
            else:
                data = parse_file_page(fetch(e["url"]), e["url"])
        except Exception as ex:  # keep going, report at the end
            print(f"  FAILED: {ex}", file=sys.stderr)
            index[e["id"]] = old_index.get(e["id"], {}) | {"error": str(ex)}
            continue
        data["id"] = e["id"]
        data["category"] = e["category"]
        data["fetched"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        prev = old_index.get(e["id"])
        is_changed = args.force or not prev or prev.get("updated") != data["updated"] or not path.exists()
        if is_changed:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
            changed.append(e["id"])
        index[e["id"]] = {k: data[k] for k in ("title", "version", "author", "category", "updated", "url")}

    if wanted:  # partial run: keep everything else in the index
        index = old_index | index
    removed = sorted(set(old_index) - set(index))
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), "utf-8")
    summary = {"total": len(index), "changed": changed, "removed": removed}
    (OUT / "_last_run.json").write_text(json.dumps(summary, indent=2), "utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
