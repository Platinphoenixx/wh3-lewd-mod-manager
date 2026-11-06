"""Shared setups, "it worked / it didn't" votes and flagged rules from the relay → curator/raw/community_setups.json, votes.json, flags.json.

Players share their mod lists from the app and vote on the setups they played (relay/worker.js). This script reads
both with the export token. Into the repository go only the setups (mod list, the template they build on, the
name/notes/how far the sharer wrote – public by design, shown in the app) and per setup the number of up and down
votes. No install ids. build_catalog.py turns the setups into community templates: those made only of catalog mods
right away, the others once a maintainer accepted their issue (community.json, type "setup").

The daily workflow (.github/workflows/community-daily.yml) calls it and rebuilds the catalog; update.py calls it too.
    RELAY_URL=https://… RELAY_EXPORT_TOKEN=… python curator/fetch_community.py
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent / "raw"
KEEP = ("id", "at", "name", "shownAs", "far", "notes", "base", "playAs", "theme", "game", "app", "catalog", "entries", "own", "review")


def get(base: str, token: str, path: str) -> dict:
    req = urllib.request.Request(base.rstrip("/") + path, headers={"authorization": f"Bearer {token}", "user-agent": "wh3lmm-catalog-update"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def write(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8", newline="\n")


def main() -> int:
    base, token = os.environ.get("RELAY_URL"), os.environ.get("RELAY_EXPORT_TOKEN")
    if not base or not token:
        print("RELAY_URL / RELAY_EXPORT_TOKEN not set; nothing fetched")
        return 0
    setups = [{k: s[k] for k in KEEP if s.get(k) not in (None, "", [])} for s in get(base, token, "/setups").get("setups", [])]
    votes = {k: {"up": v["up"], "down": v["down"], **({"reasons": v["reasons"]} if v.get("reasons") else {})}
             for k, v in get(base, token, "/votes").get("votes", {}).items()}
    write(RAW / "community_setups.json", sorted(setups, key=lambda s: s["at"]))
    write(RAW / "votes.json", votes)
    # Rules players flagged as wrong, as counts per rule (the texts are in the rule's GitHub issue).
    try:
        write(RAW / "flags.json", get(base, token, "/flags").get("flags", {}))
    except urllib.error.HTTPError as e:
        print(f"no flags from the relay ({e.code})")
    print(f"{len(setups)} shared setups, votes for {len(votes)} setups")
    return 0


if __name__ == "__main__":
    sys.exit(main())
