"""Analyse a mod's .pack files without the game: file list, declared dependencies, database tables,
and which packs provide the models, materials and textures it refers to.

    python analyze_pack.py --mod ll-52195 <pack> [<pack> …] [--with <pack> …] [--vanilla <data folder>]

--with     packs of other mods to check as providers (e.g. suspected requirements)
--vanilla  the game's data folder; its packs listed in manifest.txt count as the base game

Writes curator/raw/packs/<mod>.json. Only reads pack indexes and the small text files that hold
references (.variantmeshdefinition, .wsmodel, .material); never extracts anything to disk.
Pack layout: see app/src/main/pack.ts.
"""
import argparse
import json
import lzma
import re
import struct
from collections import Counter
from pathlib import Path

try:
    from compression import zstd  # Python 3.14+
except ImportError:  # pragma: no cover
    zstd = None

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "raw" / "packs"

HAS_EXTENDED_HEADER = 0x100
HAS_INDEX_WITH_TIMESTAMPS = 0x40
BOOKKEEPING = re.compile(r"\.rpfm_reserved$|^settings\.|^notes\.")
REFERRING = (".variantmeshdefinition", ".wsmodel", ".material")
# Paths inside reference files: anything ending in a model/material/texture extension.
REF = re.compile(r"[A-Za-z0-9_\-./\\ ]+?\.(?:wsmodel|rigid_model_v2|xml\.material|material|dds|png|tga)", re.I)


def norm(p: str) -> str:
    return p.replace("\\", "/").strip().strip("/").lower()


class Pack:
    def __init__(self, path: Path):
        self.path = path
        self.name = path.name
        with path.open("rb") as f:
            head = f.read(28)
            magic = head[:4].decode("ascii", "replace")
            if magic not in ("PFH5", "PFH6"):
                raise ValueError(f"{path.name}: unsupported pack format {magic!r}")
            flags, dep_n, dep_size, file_n, file_size, _ts = struct.unpack("<6I", head[4:28])
            ext = 20 if flags & HAS_EXTENDED_HEADER else 0
            f.seek(28 + ext)
            deps = f.read(dep_size)
            idx = f.read(file_size)
        self.dependencies = [d.decode("utf-8", "replace") for d in deps.split(b"\0") if d][:dep_n]
        self.files: dict[str, tuple[int, int, bool]] = {}  # path -> (offset, size, compressed)
        pos, off = 0, 28 + ext + dep_size + file_size
        for _ in range(file_n):
            size = struct.unpack_from("<I", idx, pos)[0]
            pos += 4
            if flags & HAS_INDEX_WITH_TIMESTAMPS:
                pos += 4
            compressed = bool(idx[pos])
            pos += 1
            end = idx.index(b"\0", pos)
            self.files[norm(idx[pos:end].decode("utf-8", "replace"))] = (off, size, compressed)
            pos = end + 1
            off += size

    def read(self, path: str) -> bytes | None:
        off, size, compressed = self.files[path]
        with self.path.open("rb") as f:
            f.seek(off)
            data = f.read(size)
        if not compressed:
            return data
        body = data[4:]  # u32 uncompressed size, then the compressed stream
        if body[:4] == b"\x28\xb5\x2f\xfd" and zstd:
            return zstd.decompress(body)
        if len(body) > 5 and body[0] == 0x5D:  # LZMA1 properties byte; needs the size the "alone" format expects
            usize = struct.unpack_from("<I", data)[0]
            return lzma.decompress(body[:5] + struct.pack("<Q", usize) + body[5:], format=lzma.FORMAT_ALONE)
        return None  # LZ4 and others: not needed so far


def references(packs: list[Pack]) -> dict[str, set[str]]:
    """Paths referred to by the packs' mesh definitions, models and materials -> referring files."""
    refs: dict[str, set[str]] = {}
    for p in packs:
        for path in p.files:
            if not path.endswith(REFERRING):
                continue
            raw = p.read(path)
            if raw is None:
                continue
            text = raw.decode("utf-8", "replace") if raw[:1] in (b"<", b"\xef", b" ", b"\t", b"\r", b"\n") else raw.decode("latin-1")
            for m in REF.findall(text):
                ref = norm(m)
                if "/" in ref:
                    refs.setdefault(ref, set()).add(path)
    return refs


def vanilla_packs(data: Path) -> list[Pack]:
    manifest = data / "manifest.txt"
    names = [line.split("\t")[0].strip() for line in manifest.read_text("utf-8", "replace").splitlines()] if manifest.exists() else []
    return [Pack(data / n) for n in names if n.lower().endswith(".pack") and (data / n).exists()]


def analyse(mod_packs: list[Pack], others: list[Pack], vanilla: list[Pack]) -> dict:
    own = {p for pk in mod_packs for p in pk.files}
    vanilla_files = {p for pk in vanilla for p in pk.files}

    # Follow references through the mod's own files and through providers' models/materials.
    providers: dict[str, list[str]] = {}
    refs = references(mod_packs)
    seen: set[str] = set()
    queue = list(refs)
    while queue:
        ref = queue.pop()
        if ref in seen:
            continue
        seen.add(ref)
        if ref in own:
            continue
        hits = [o.name for o in others if ref in o.files]
        if hits:
            providers[ref] = hits
            for o in others:
                if ref in o.files and ref.endswith(REFERRING):
                    for sub in references_in(o, ref):
                        refs.setdefault(sub, set()).add(ref)
                        queue.append(sub)
    unresolved = sorted(r for r in seen if r not in own and r not in providers and r not in vanilla_files)
    in_vanilla = sorted(r for r in seen if r not in own and r not in providers and r in vanilla_files)
    only_other = {}
    for ref, hits in providers.items():
        if ref in vanilla_files:
            continue  # the base game has it too; the other mod only replaces it
        for h in hits:
            only_other.setdefault(h, []).append(ref)

    files = sorted({(p, sz, pk.name) for pk in mod_packs for p, (_o, sz, _c) in pk.files.items() if not BOOKKEEPING.search(p)})
    tables = sorted({m.group(1) for p, _, _ in files if (m := re.match(r"db/([^/]+)/", p))})
    # Keys and other strings in the mod's database rows (read without table schemas): they show what
    # a mod refers to (units, factions, buildings of other mods) and which rows two mods both change.
    db_strings: dict[str, list[str]] = {}
    for pk in mod_packs:
        for p in pk.files:
            if m := re.match(r"db/([^/]+)/", p):
                raw = pk.read(p)
                if raw:
                    db_strings.setdefault(m.group(1), [])
                    db_strings[m.group(1)] += [s for s in db_text(raw) if s not in db_strings[m.group(1)]][:MAX_DB_STRINGS]
    return {
        "packs": [pk.name for pk in mod_packs],
        "dependencies": sorted({d for pk in mod_packs for d in pk.dependencies}),
        "perPack": {pk.name: {"files": sum(1 for p in pk.files if not BOOKKEEPING.search(p)), "dependencies": pk.dependencies}
                    for pk in mod_packs},
        "fileCount": len({p for p, _, _ in files}),
        "byTopFolder": dict(Counter(p.split("/")[0] for p in {p for p, _, _ in files}).most_common()),
        "tables": tables,
        "references": {
            "total": len(seen),
            "inMod": sum(1 for r in seen if r in own),
            "inBaseGame": len(in_vanilla),
            "onlyInOtherMods": {k: sorted(v) for k, v in sorted(only_other.items())},
            "unresolved": unresolved,
        },
        "comparedWith": [o.name for o in others],
        "dbStrings": {t: v[:MAX_DB_STRINGS] for t, v in sorted(db_strings.items())},
        "files": [{"path": p, "size": s, "pack": n} for p, s, n in files],
    }


MAX_DB_STRINGS = 400
KEYLIKE = re.compile(r"^[\w.\-:/ ]{3,120}$")


def db_text(raw: bytes) -> list[str]:
    """Strings stored in a WH3 database table file: u16 length + UTF-8 bytes, read without the schema."""
    out, i = [], 0
    while i + 2 < len(raw):
        n = struct.unpack_from("<H", raw, i)[0]
        if 3 <= n <= 120 and i + 2 + n <= len(raw):
            chunk = raw[i + 2:i + 2 + n]
            try:
                s = chunk.decode("utf-8")
            except UnicodeDecodeError:
                s = ""
            if s and KEYLIKE.match(s) and any(c.isalpha() for c in s):
                if s not in out:
                    out.append(s)
                i += 2 + n
                continue
        i += 1
    return out


def references_in(pack: Pack, path: str) -> set[str]:
    raw = pack.read(path)
    if raw is None:
        return set()
    text = raw.decode("utf-8", "replace")
    return {norm(m) for m in REF.findall(text) if "/" in m.replace("\\", "/")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mod", required=True, help="catalog id, e.g. ll-52195")
    ap.add_argument("packs", nargs="+", type=Path)
    ap.add_argument("--with", dest="others", nargs="*", type=Path, default=[])
    ap.add_argument("--vanilla", type=Path)
    a = ap.parse_args()
    result = analyse([Pack(p) for p in a.packs], [Pack(p) for p in a.others], vanilla_packs(a.vanilla) if a.vanilla else [])
    result = {"mod": a.mod, **result}
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{a.mod}.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", "utf-8")
    r = result["references"]
    print(f"{a.mod}: {result['fileCount']} files, deps {result['dependencies']}, refs {r['total']} "
          f"(mod {r['inMod']}, base game {r['inBaseGame']}, unresolved {len(r['unresolved'])}), "
          f"only in other mods: { {k: len(v) for k, v in r['onlyInOtherMods'].items()} } -> {out}")


if __name__ == "__main__":
    main()
