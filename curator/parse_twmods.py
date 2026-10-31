"""Parse CA launcher mod profiles (.twmods) into JSON.

A .twmods file is "# TW Mod Profile" followed by one line per active mod, in load order:
    mod_lookup_key://<hash>@steam_workshop:1142710/<workshop id>@<unix time>/<pack file>
    mod_lookup_key://<hash>@<other source>/<pack file>          (local data-folder mods)

Usage:
    curator/.venv/Scripts/python curator/parse_twmods.py curator/raw/discord/twmods
Writes <dir>/../twmods.json: {profile name: [{"pack", "steamId", "version", "source", "hash"}...]}
"""

import json
import re
import sys
from pathlib import Path

LINE_RE = re.compile(r"^mod_lookup_key://(?P<hash>[0-9a-f]+)@(?P<rest>.+)$")
STEAM_RE = re.compile(r"^steam_workshop:\d+/(?P<id>\d+)@(?P<ts>\d+)/(?P<pack>.+)$")


def parse(path: Path) -> list[dict]:
    mods = []
    for line in path.read_text("utf-8", errors="replace").splitlines():
        m = LINE_RE.match(line.strip())
        if not m:
            continue
        rest = m.group("rest")
        s = STEAM_RE.match(rest)
        if s:
            mods.append({"pack": s.group("pack"), "steamId": s.group("id"), "version": int(s.group("ts")),
                         "source": "steam", "hash": m.group("hash")})
        else:
            source, _, pack = rest.partition("/")
            mods.append({"pack": pack.rsplit("/", 1)[-1] or rest, "source": source, "raw": rest, "hash": m.group("hash")})
    return mods


def main():
    d = Path(sys.argv[1])
    out = {p.stem: parse(p) for p in sorted(d.glob("*.twmods"))}
    (d.parent / "twmods.json").write_text(json.dumps(out, indent=1), "utf-8")
    for name, mods in out.items():
        local = sum(m["source"] != "steam" for m in mods)
        print(f"{name}: {len(mods)} mods ({local} local)")


if __name__ == "__main__":
    main()
