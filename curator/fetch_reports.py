"""Problem reports from the relay → counts per error (curator/raw/error_reports.json).

The relay (relay/worker.js) keeps the reports players sent from the app privately. This script reads
them with the export token and writes only counts to the repository: per error signature the number
of different players, the game versions and when it was last reported – never the report texts.
build_catalog.py turns errors that 3 or more players reported into known issues of the mod.

Usage (the weekly update calls it when the secrets are set):
    RELAY_URL=https://… RELAY_EXPORT_TOKEN=… python curator/fetch_reports.py [--dump reports.json]
--dump writes the full reports to a local file for a maintainer to read (keep it out of the repository).
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent / "raw" / "error_reports.json"
DAYS = 90


def fetch_all(base: str, token: str) -> list:
    reports, cursor = [], None
    while True:
        url = base.rstrip("/") + "/reports" + (f"?cursor={urllib.parse.quote(cursor)}" if cursor else "")
        req = urllib.request.Request(url, headers={"authorization": f"Bearer {token}", "user-agent": "wh3lmm-catalog-update"})
        page = json.load(urllib.request.urlopen(req, timeout=60))
        reports += page.get("reports", [])
        cursor = page.get("cursor")
        if not cursor:
            return reports


def aggregate(reports: list, now: datetime) -> list:
    since = (now - timedelta(days=DAYS)).isoformat()
    groups = {}
    for r in reports:
        if r.get("at", "") < since or not r.get("signature"):
            continue
        g = groups.setdefault(r["signature"], {"signature": r["signature"], "modId": r.get("modId"), "modName": r.get("modName"),
                                               "players": set(), "reports": 0, "games": set(), "first": r["at"], "last": r["at"]})
        g["players"].add(r.get("installId"))
        g["reports"] += 1
        if r.get("game"):
            g["games"].add(r["game"])
        g["first"], g["last"] = min(g["first"], r["at"]), max(g["last"], r["at"])
    out = [{**g, "players": len(g["players"]), "games": sorted(g["games"])} for g in groups.values()]
    return sorted(out, key=lambda g: (-g["players"], g["signature"]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", help="also write the full reports to this local file")
    args = ap.parse_args()
    base, token = os.environ.get("RELAY_URL"), os.environ.get("RELAY_EXPORT_TOKEN")
    if not base or not token:
        print("RELAY_URL / RELAY_EXPORT_TOKEN not set – no problem reports fetched.")
        return 0
    reports = fetch_all(base, token)
    if args.dump:
        Path(args.dump).write_text(json.dumps(reports, ensure_ascii=False, indent=1), "utf-8")
    counts = aggregate(reports, datetime.now(timezone.utc))
    OUT.write_text(json.dumps(counts, ensure_ascii=False, indent=1), "utf-8")
    print(f"{len(reports)} reports → {len(counts)} distinct errors ({sum(1 for c in counts if c['players'] >= 3)} reported by 3+ players)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
