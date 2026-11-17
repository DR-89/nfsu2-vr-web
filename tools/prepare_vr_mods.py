#!/usr/bin/env python3
"""Import the native project's private PC source packs into prepared web data.

The Xbox NHQ, regional geometry and sound-bank conversions are not PC assets.
Validate the original PC packs before copying. Keep the retail soundtrack in
pfdata/original so the website's Original choice always remains available.
No network requests, source-game changes or source-tree assets are made.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import tempfile

import musicpack
import packcheck
from prepare_vr_data import EXE_HASH, MARKER, MOD_MARKER, find


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def destination(root, relative):
    parts = PurePosixPath(relative).parts
    if not parts or any(p in ('', '.', '..') or ':' in p or '\\' in p for p in parts):
        raise ValueError('Invalid pack destination')
    result = root
    for part in parts:
        result = (find(result, part) if result.is_dir() else None) or (result / part)
    result.resolve().relative_to(root)
    return result


def atomic_copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.vr-mod-', delete=False) as f:
        temporary = Path(f.name)
    try:
        shutil.copyfile(source, temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def soundtrack(original, source):
    """Only sample offsets may differ from the retail PC event graph."""
    old, new = original.read_bytes(), source.read_bytes()
    table, count = musicpack.samples_table(old)
    if len(new) != len(old) or musicpack.samples_table(new) != (table, count):
        raise ValueError('Restored soundtrack uses a different PC event graph')
    a, b = bytearray(old), bytearray(new)
    for i in range(count):
        at = table + i * 8
        a[at:at+4] = b[at:at+4] = bytes(4)
    if a != b:
        raise ValueError('Restored soundtrack changes more than song offsets')
    if count < 2:
        raise ValueError('Soundtrack has no buffer-sizing pair')
    def gap(m):
        last = table + (count - 1) * 8
        return (struct.unpack_from('<I', m, last)[0] - struct.unpack_from('<I', m, last-8)[0]) & 0xffffffff
    if gap(old) != gap(new):
        raise ValueError('Restored soundtrack changes the original stream buffer size')
    mus = find(source.parent, 'MusicSFx.mus')
    if not mus:
        raise ValueError('Restored soundtrack has no music stream')
    data = mus.read_bytes()
    offsets = {struct.unpack_from('<I', new, table+i*8)[0]*128 for i in range(count)}
    for offset in offsets:
        chunks = musicpack.chunks(data, offset)
        if any(at + size > len(data) for _, at, size in chunks):
            raise ValueError('Restored soundtrack has a truncated stream')
        if not musicpack.is_ealayer3(data, offset):
            raise ValueError('Expected the compressed PC soundtrack source')
    return mus, count


def prepare(native, game, check_only=False):
    native, game = native.resolve(strict=True), game.resolve(strict=True)
    if not (game / MARKER).is_file():
        raise ValueError('Use the private data folder made by prepare_vr_data.py')
    exe = find(game, 'SPEED2.EXE')
    if not exe or digest(exe) != EXE_HASH:
        raise ValueError('Unsupported PC executable')
    pc = native / 'build/xyz-lan-qa/live-mod-assets'
    mods = native / 'build/mod-assets'
    files = packcheck.walk([str(pc)])
    for path in (mods / 'MODPACKS/WHINE').glob('*.wav'):
        files['MODPACKS/WHINE/' + path.name] = str(path)
    scratch = mods / 'TEXPACKS/crash-scratches.tpk'
    if scratch.is_file():
        files['MODPACKS/DAMAGE/SCRATCHES.TPK'] = str(scratch)
    if not files:
        raise ValueError('No prepared PC source packs in the native project')
    problems = packcheck.check(str(game), files)
    if problems:
        raise ValueError('Invalid PC packs: ' + repr(problems[:10]))
    marker = game / MOD_MARKER
    previous = json.loads(marker.read_text(encoding='utf-8')) if marker.exists() else {}
    prior = previous.get('files', {})
    planned = []
    records = {}

    def plan(relative, source):
        source = Path(source).resolve(strict=True)
        target = destination(game, relative)
        if source.is_relative_to(game):
            raise ValueError('Source packs must be outside the prepared game')
        sha = digest(source)
        if target.exists():
            old = digest(target)
            if old != sha and old != prior.get(relative, {}).get('sha256'):
                raise ValueError('Refusing to replace an unowned file: ' + relative)
            if old != sha:
                planned.append((source, target))
        else:
            planned.append((source, target))
        records[relative] = {'sha256': sha, 'bytes': source.stat().st_size}
        return target

    for relative, source in files.items():
        plan(relative, source)

    # The original files are copied before either restored file is replaced.
    # A later import always validates against those retained originals.
    pf = find(game, 'pfdata')
    if not pf:
        raise ValueError('Prepared data has no pfdata folder')
    original_mpf = destination(game, 'pfdata/original/MusicSFx.mpf')
    old_mpf = original_mpf if original_mpf.is_file() else find(pf, 'MusicSFx.mpf')
    new_mpf = find(pc / 'pfdata', 'MusicSFx.mpf')
    if not old_mpf or not new_mpf:
        raise ValueError('Missing original or restored PC soundtrack map')
    new_mus, songs = soundtrack(old_mpf, new_mpf)
    backups = []
    for name in ('MusicSFx.mpf', 'MusicSFx.mus'):
        old = find(pf, name)
        if not old:
            raise ValueError('Missing original PC soundtrack: ' + name)
        backup = destination(game, 'pfdata/original/' + name)
        known = prior.get('pfdata/original/' + name)
        if backup.exists() and known and digest(backup) != known['sha256']:
            raise ValueError('The retained original soundtrack was edited')
        if not backup.exists():
            # Never back up an already imported file as the retail original.
            if 'pfdata/' + name in prior:
                raise ValueError('The retained original soundtrack is missing')
            backups.append((old, backup))
        records['pfdata/original/' + name] = {
            'sha256': digest(backup if backup.exists() else old),
            'bytes': (backup if backup.exists() else old).stat().st_size}
    # Retail originals are intentionally replaced here, after their backups.
    for name, source in [('MusicSFx.mpf', new_mpf), ('MusicSFx.mus', new_mus)]:
        rel = 'pfdata/' + name
        target = destination(game, rel)
        sha = digest(source)
        if digest(target) != sha:
            if rel in prior and digest(target) not in (prior[rel]['sha256'], records['pfdata/original/' + name]['sha256']):
                raise ValueError('The installed soundtrack was edited; refusing to overwrite it')
            planned.append((source, target))
        records[rel] = {'sha256': sha, 'bytes': source.stat().st_size}
    report = {'version': 1, 'packs': len(files), 'songs': songs, 'files': records,
              'copied': 0 if check_only else len(backups) + len(planned)}
    if check_only:
        return report
    for source, target in backups + planned:
        atomic_copy(source, target)
    # The record contains no source paths and is outside the HTTP allowlist.
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=game, prefix='.vr-mod-', delete=False) as f:
        temporary = Path(f.name)
        json.dump(report, f, indent=2)
    try:
        os.replace(temporary, marker)
    finally:
        temporary.unlink(missing_ok=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('native', type=Path)
    parser.add_argument('game', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    report = prepare(args.native, args.game, args.check)
    print(f"PC mods: {report['packs']} pack files and {report['songs']} music entries verified; {report['copied']} files copied")


if __name__ == '__main__':
    main()
