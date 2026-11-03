"""Record an accepted community contribution (a GitHub issue created by the app) in curator/community.json.

The app puts a ```json block into every issue: {"type": "rule"|"feedback"|"correction"|"new-mod", "modId": ..., ...}.
A maintainer reviews the issue and adds the label "accepted"; the GitHub Action then runs:

    python curator/apply_contribution.py --issue-file event_issue.json
or, for local use:
    python curator/apply_contribution.py --body-file body.md --url https://github.com/o/r/issues/12

build_catalog.py applies community.json on every build (no AI involved).
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

COMMUNITY = Path(__file__).resolve().parent / "community.json"
TYPES = {"rule", "feedback", "correction", "new-mod", "setup"}


def parse_block(body: str) -> dict:
    m = re.search(r"```json\s*(\{.*?\})\s*```", body or "", re.S)
    if not m:
        raise ValueError("no ```json block found in the issue body")
    data = json.loads(m.group(1))
    if data.get("type") not in TYPES:
        raise ValueError(f"unknown contribution type: {data.get('type')!r}")
    if data["type"] == "setup" and not data.get("setupId"):
        raise ValueError("setupId is missing")
    if data["type"] not in ("new-mod", "setup") and not data.get("modId"):
        raise ValueError("modId is missing")
    return data


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--issue-file", help="GitHub event 'issue' object as JSON")
    ap.add_argument("--body-file")
    ap.add_argument("--url", default="")
    args = ap.parse_args()

    if args.issue_file:
        issue = json.loads(Path(args.issue_file).read_text("utf-8"))
        body, url, number = issue.get("body") or "", issue.get("html_url", ""), issue.get("number")
    else:
        body, url, number = Path(args.body_file).read_text("utf-8"), args.url, None

    entry = parse_block(body) | {"url": url, "issue": number, "accepted": date.today().isoformat()}
    entry.pop("setup", None)  # a shared setup's list stays with the relay (fetch_community.py); only its id is recorded
    store = json.loads(COMMUNITY.read_text("utf-8")) if COMMUNITY.exists() else {"accepted": []}
    if any(e.get("url") == url and url for e in store["accepted"]):
        print("already recorded")
        return 0
    store["accepted"].append(entry)
    COMMUNITY.write_text(json.dumps(store, ensure_ascii=False, indent=2), "utf-8")
    print(f"recorded {entry['type']} for {entry.get('modId') or entry.get('name')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
