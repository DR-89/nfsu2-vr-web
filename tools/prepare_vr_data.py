#!/usr/bin/env python3
"""Prepare a private browser data folder from the user's PC installation.

The browser runtime opens speech/pfdata files directly; retail installations
keep them in SDATA/sdat.viv. Copy only the HTTP server's game-data allowlist,
then extract that archive into the copy. Never change the supplied installation.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import struct

ROOT = Path(__file__).resolve().parents[1]
EXE_HASH = 'f9dd86c054878ce6276beb07c1fd61874f7a1e4bf1f241b084c65b73e24168a7'
MARKER = '.vr-data-source.json'
MOD_MARKER = '.vr-mod-source.json'


def game_entries():
    # Keep the preparation boundary identical to the server's serving boundary.
    source = (ROOT / 'web/server-rs/src/app/manifest.rs').read_text(encoding='utf-8')
    array = re.search(r'pub const GAME_ENTRIES:.*?=\s*\[(.*?)\];', source, re.S)
    if not array:
        raise ValueError('Cannot read the server game-data allowlist')
    return set(re.findall(r'^\s*"([a-z0-9.]+)"', array[1], re.M))


def entries(archive):
    """Validate the entire BIG4/BIGF index before writing any archive payload."""
    size = archive.stat().st_size
    with archive.open('rb') as f:
        h = f.read(16)
        if len(h) != 16 or h[:4] not in (b'BIG4', b'BIGF'):
            raise ValueError('Invalid SDATA archive header')
        count, end = struct.unpack('>II', h[8:])
        if not 0 < count <= 4096 or not 16 <= end <= min(size, 1 << 20):
            raise ValueError('Invalid SDATA archive index size')
        index = f.read(end - 16)
    result, seen, at = [], set(), 0
    for _ in range(count):
        if at + 8 > len(index):
            raise ValueError('Truncated SDATA archive index')
        offset, length = struct.unpack_from('>II', index, at)
        at += 8
        stop = index.find(b'\0', at)
        if stop < at:
            raise ValueError('Unterminated SDATA archive filename')
        name = index[at:stop].decode('ascii').replace('\\', '/')
        at = stop + 1
        parts = name.split('/')
        if (len(parts) < 2 or parts[0].lower() not in ('speech', 'pfdata')
                or any(p in ('', '.', '..') or ':' in p or any(ord(c) < 32 for c in p) for p in parts)
                or name.lower() in seen or offset < end or length == 0 or offset + length > size):
            raise ValueError(f'Unsafe or invalid SDATA archive entry: {name!r}')
        seen.add(name.lower())
        result.append((PurePosixPath(*parts), offset, length))
    return result


def find(root, name):
    return next((p for p in root.iterdir() if p.name.lower() == name.lower()), None)


def preserved_music(target):
    """A routine launch must keep the separately imported PC soundtrack."""
    marker = target / MOD_MARKER
    if not marker.is_file():
        return set()
    owned = json.loads(marker.read_text(encoding='utf-8')).get('files', {})
    keep = set()
    for name in ('MusicSFx.mpf', 'MusicSFx.mus'):
        record = owned.get('pfdata/' + name)
        folder = find(target, 'pfdata')
        path = find(folder, name) if folder else None
        if record and path:
            with path.open('rb') as f:
                if hashlib.file_digest(f, 'sha256').hexdigest() != record['sha256']:
                    raise ValueError(f'Imported soundtrack changed: {name}; no data overwritten')
            keep.add(path.resolve())
    return keep


def copy_data(source, target, allowed, preserve=()):
    count = 0
    for child in source.iterdir():
        if child.name.lower() not in allowed or child.is_symlink():
            continue
        files = child.rglob('*') if child.is_dir() else [child]
        for item in files:
            if item.is_symlink() or not item.is_file():
                continue
            # rglob does not follow directory symlinks; also exclude external files.
            item.resolve().relative_to(source)
            dest = target / item.relative_to(source)
            dest.resolve().relative_to(target)
            if dest.resolve() in preserve:
                continue
            stat = item.stat()
            if dest.exists() and dest.stat().st_size == stat.st_size and dest.stat().st_mtime_ns == stat.st_mtime_ns:
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, dest)
            count += 1
    return count


def prepare(source, target):
    source, target = source.resolve(strict=True), target.resolve()
    if target == source or target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError('The prepared data folder must be separate from the installation')
    exe = find(source, 'SPEED2.EXE')
    if not exe or hashlib.sha256(exe.read_bytes()).hexdigest() != EXE_HASH:
        raise ValueError('SPEED2.EXE does not match supported PC v1.2 North America')
    marker = target / MARKER
    if target.exists() and any(target.iterdir()):
        if not marker.is_file() or json.loads(marker.read_text(encoding='utf-8'))['source'] != str(source):
            raise ValueError('Destination is not this installation\'s private prepared data folder')
    sdata = find(source, 'sdata')
    archive = find(sdata, 'sdat.viv') if sdata else None
    table = entries(archive) if archive else []
    target.mkdir(parents=True, exist_ok=True)
    keep = preserved_music(target)
    # The marker owns only the private copy. No game data enters the source tree.
    marker.write_text(json.dumps({'source': str(source)}), encoding='utf-8')
    copied = copy_data(source, target, game_entries(), keep)
    extracted = 0
    if archive:
        with archive.open('rb') as f:
            for name, offset, size in table:
                dest = target
                for part in name.parts:
                    dest = (find(dest, part) if dest.is_dir() else None) or (dest / part)
                dest.resolve().relative_to(target)
                if dest.resolve() in keep:
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                # Loose installation files take precedence over the packed originals.
                original = source
                for part in name.parts:
                    original = find(original, part) if original and original.is_dir() else None
                if original and original.is_file():
                    continue
                # Re-read even an equal-sized entry: a user may have changed the archive.
                f.seek(offset)
                with dest.open('wb') as out:
                    remaining = size
                    while remaining:
                        block = f.read(min(remaining, 1 << 20))
                        if not block:
                            raise ValueError(f'Truncated archive entry: {name}')
                        out.write(block)
                        remaining -= len(block)
                extracted += 1
    for name in ('UG2_Speech.big', 'nisaudio.idx'):
        speech = find(target, 'speech')
        if not speech or not find(speech, name):
            raise ValueError(f'Missing speech/{name}; supply a complete PC installation with SDATA/sdat.viv')
    print(f'Browser data ready: {copied} files copied, {extracted} archive entries extracted.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    try:
        prepare(args.source, args.target)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f'Game data preparation failed: {error}\n')
