"""Record an accepted community contribution (a GitHub issue created by the app) in curator/community.json.

The app puts a ```json block into every issue: {"type": "rule"|"feedback"|"correction"|"new-mod"|"fix"|"flag", "modId": ..., ...}.
A maintainer reviews the issue and adds the label "accepted"; the GitHub Action then runs:

    python curator/apply_contribution.py --issue-file event_issue.json
or, for local use:
    python curator/apply_contribution.py --body-file body.md --url https://github.com/o/r/issues/12

Without a maintainer:
    --auto-ok        exit 0 when the issue may be accepted without review: a suggested mod whose links all point at
                     Steam, LoversLab or Nexus Mods (the build reads the facts from there, marked as not reviewed)
    --rejected       a shared setup a maintainer rejected (closed as not planned): it is no longer shown
    --refresh-steam  public Workshop data (title, picture, creator) for the Workshop items of suggested mods

build_catalog.py applies community.json on every build (no AI involved).
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

COMMUNITY = Path(__file__).resolve().parent / "community.json"
TYPES = {"rule", "feedback", "correction", "new-mod", "setup", "fix", "flag"}
# Hosts a suggested mod may link to and still be taken without review: the build reads its facts from them.
TRUSTED_HOSTS = ("steamcommunity.com", "loverslab.com", "nexusmods.com")


def auto_ok(data: dict) -> bool:
    """A suggested mod that only links to Steam, LoversLab or Nexus Mods needs no maintainer."""
    links = [u for u in data.get("links") or [] if isinstance(u, str)]
    host = lambda u: (re.match(r"https?://([^/]+)", u) or [None, ""])[1].lower()
    return data.get("type") == "new-mod" and bool(links) and all(
        any(host(u) == h or host(u).endswith("." + h) for h in TRUSTED_HOSTS) for u in links)
DECISIONS = {"retire", "change", "keep"}


def parse_block(body: str) -> dict:
    m = re.search(r"```json\s*(\{.*?\})\s*```", body or "", re.S)
    if not m:
        raise ValueError("no ```json block found in the issue body")
    data = json.loads(m.group(1))
    if data.get("type") not in TYPES:
        raise ValueError(f"unknown contribution type: {data.get('type')!r}")
    if data["type"] == "setup" and not data.get("setupId"):
        raise ValueError("setupId is missing")
    if data["type"] == "flag":
        # A flagged rule: the app wrote the maintainer's decision into the block before labelling the issue.
        if not data.get("rule") or data.get("decision") not in DECISIONS:
            raise ValueError("a flag needs its rule and the maintainer's decision")
        if data["decision"] in ("change", "keep") and not data.get("answer"):
            raise ValueError(f"the decision {data['decision']} needs the maintainer's text")
    elif data["type"] not in ("new-mod", "setup") and not data.get("modId"):
        raise ValueError("modId is missing")
    return data


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--issue-file", help="GitHub event 'issue' object as JSON")
    ap.add_argument("--body-file")
    ap.add_argument("--url", default="")
    ap.add_argument("--auto-ok", action="store_true")
    ap.add_argument("--rejected", action="store_true")
    ap.add_argument("--refresh-steam", action="store_true")
    args = ap.parse_args()

    if args.refresh_steam:
        return refresh_steam()

    if args.issue_file:
        issue = json.loads(Path(args.issue_file).read_text("utf-8"))
        body, url, number = issue.get("body") or "", issue.get("html_url", ""), issue.get("number")
    else:
        body, url, number = Path(args.body_file).read_text("utf-8"), args.url, None

    if args.auto_ok:
        try:
            return 0 if auto_ok(parse_block(body)) else 1
        except ValueError:
            return 1
    if args.rejected:
        return record_rejected(body, url, number)

    entry = parse_block(body) | {"url": url, "issue": number, "accepted": date.today().isoformat()}
    entry.pop("setup", None)  # a shared setup's list stays with the relay (fetch_community.py); only its id is recorded
    entry.pop("reports", None)  # what players wrote stays in the issue; the catalog needs the rule and the decision
    store = json.loads(COMMUNITY.read_text("utf-8")) if COMMUNITY.exists() else {"accepted": []}
    if any(e.get("url") == url and url for e in store["accepted"]):
        print("already recorded")
        return 0
    if entry["type"] == "flag":  # a later decision on a rule replaces the earlier one
        store["accepted"] = [e for e in store["accepted"] if not (e.get("type") == "flag" and e.get("rule") == entry["rule"])]
    store["accepted"].append(entry)
    COMMUNITY.write_text(json.dumps(store, ensure_ascii=False, indent=2), "utf-8")
    print(f"recorded {entry['type']} for {entry.get('modId') or entry.get('name') or entry.get('rule')}")
    return 0


def record_rejected(body: str, url: str, number) -> int:
    """A shared setup a maintainer closed as not planned: the build leaves it out."""
    data = parse_block(body)
    if data["type"] != "setup":
        print("only a shared setup is hidden on rejection")
        return 0
    store = json.loads(COMMUNITY.read_text("utf-8")) if COMMUNITY.exists() else {"accepted": []}
    rejected = store.setdefault("rejected", [])
    if any(r.get("setupId") == data["setupId"] for r in rejected):
        print("already rejected")
        return 0
    rejected.append({"type": "setup", "setupId": data["setupId"], "url": url, "issue": number, "date": date.today().isoformat()})
    store["accepted"] = [e for e in store["accepted"] if not (e.get("type") == "setup" and e.get("setupId") == data["setupId"])]
    COMMUNITY.write_text(json.dumps(store, ensure_ascii=False, indent=2), "utf-8")
    print(f"rejected setup {data['setupId']}")
    return 0


def refresh_steam() -> int:
    """Public Workshop data for the Workshop items of accepted mod suggestions (title, picture, creator)."""
    store = json.loads(COMMUNITY.read_text("utf-8")) if COMMUNITY.exists() else {"accepted": []}
    ids = {s for c in store["accepted"] if c.get("type") == "new-mod"
           for u in c.get("links") or [] for s in re.findall(r"filedetails/\?(?:[^ ]*&)?id=(\d+)", u)}
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import update  # noqa: E402 (only needed here)
    known = update.load(update.CURATOR / "raw" / "steam_items.json", {})
    new = ids - set(known)
    if not new:
        print("no new Workshop items")
        return 0
    st = update.refresh_steam(new)
    update.refresh_creators(st["steam"])
    print(f"Workshop data for {len(new)} suggested items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
