"""Pack the mod's authored NCPK/NGHV meshes for the browser (no retail data).

Usage: pack_vr_assets.py <native-mod-root> <web-root>
Requires Pillow. Geometry stays in metres; textures are reduced for remote cars.
"""
import json
import re
import struct
import sys
from pathlib import Path
from PIL import Image


def pack(source, target):
    source, target = Path(source), Path(target)
    assets = source / 'assets/cockpits/runtime/cockpits'
    out = target / 'web/src/static'
    out.mkdir(parents=True, exist_ok=True)
    font_header = (source / 'android/runtime/quest_bitmap_font.h').read_text(encoding='utf-8')
    font = {c: [int(rows[i:i + 2], 16) for i in range(0, 14, 2)]
            for c, rows in re.findall(r"\{'(.)',\"([0-9A-F]{14})\"\}", font_header)}
    font["'"] = [4, 4, 0, 0, 0, 0, 0]
    (target / 'web/src/vr/bitmap-font.ts').write_text('// Native 5x7 cockpit font; tools/pack_vr_assets.py.\n'
        + 'export const bitmapFont: Readonly<Record<string, readonly number[]>> = ' + json.dumps(font) + ';\n', encoding='utf-8')

    def save(name, vertices, indices, rgba, w, h, opened=b''):
        assert len(vertices) % 32 == 0 and len(indices) % 4 == 0
        assert not opened or len(opened) == len(vertices)
        header = struct.pack('<4sIII', b'NVWM', 2 if opened else 1, len(vertices) // 32, len(indices) // 4)
        (out / f'vr-{name}.nvwm').write_bytes(header + vertices + indices + opened)
        pic = Image.frombytes('RGBA', (w, h), rgba)
        pic.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        pic.save(out / f'vr-{name}.png', optimize=True)

    b = (assets / 'shared.ncpk').read_bytes()
    magic, ver, nv, ni, w, h = struct.unpack_from('<4s5I', b)
    assert magic == b'NCPK' and ver == 4
    end = 128 + nv * 32 + ni * 4
    assert len(b) == end + w * h * 4
    save('cabin', b[128:128 + nv * 32], b[128 + nv * 32:end], b[end:], w, h)
    first, count = struct.unpack_from('<2I', b, 24)
    indices = struct.unpack_from(f'<{ni}I', b, 128 + nv * 32)
    vertices = set(indices[first:first + count])
    assert vertices == set(range(min(vertices), max(vertices) + 1))
    wheel = {'first': min(vertices), 'end': max(vertices) + 1, 'indexFirst': first, 'indexCount': count,
             'pivot': list(struct.unpack_from('<3f', b, 32)), 'axis': list(struct.unpack_from('<3f', b, 44))}
    first, count = struct.unpack_from('<2I', b, 56)
    shifter = {'first': first, 'end': first + count}
    pedals = []
    for i in range(3):
        first, count, x, y, z = struct.unpack_from('<2I3f', b, 64 + i * 20)
        pedals.append({'first': first, 'end': first + count, 'hinge': [x, y, z]})
    (target / 'web/src/vr/cabin-parts.ts').write_text('// Authored moving parts from shared.ncpk; tools/pack_vr_assets.py.\n'
        + '\n'.join('export const ' + name + ' = ' + json.dumps(value) + ';' for name, value in [('wheel',wheel),('shifter',shifter),('pedals',pedals)]) + '\n', encoding='utf-8')
    b = (assets / 'driver-gloves.nghv').read_bytes()
    magic, ver, nv, w, h = struct.unpack_from('<4s4I', b)
    assert magic == b'NGHV' and ver == 1
    end = 32 + nv * 64
    assert len(b) == end + w * h * 4
    save('glove', b[32 + nv * 32:end], struct.pack(f'<{nv}I', *range(nv)), b[end:], w, h, b[32:32 + nv * 32])
    # quest_glove_point_pose: the open index pad is also the physical hit point.
    tip = [0., 0., 0.]
    for i in range(nv):
        x, y, z = struct.unpack_from('<3f', b, 32 + i * 32)
        weight = max(0, min(1, (x + .065) / .011, (-.009 - x) / .008))
        if weight == 1 and y > tip[1]:
            tip = [x, y, z]
    assert .05 < tip[1] < .25
    (target / 'web/src/vr/glove-tip.ts').write_text('// Authored index pad from driver-gloves.nghv; tools/pack_vr_assets.py.\n'
        + 'export const gloveTip = ' + json.dumps(tip) + ';\n', encoding='utf-8')

    fits = {}
    header = (source / 'android/runtime/quest_cockpit_vehicle.h').read_text(encoding='utf-8')
    for name, seat, rest in re.findall(r'\{"([A-Z0-9]+)",\{([^}]+)\},([^}]+)\}', header):
        nums = lambda s: [float(x.strip().removesuffix('f')) for x in s.split(',')]
        fits[name] = nums(seat) + nums(rest)[:7]
    assert len(fits) >= 25
    (target / 'web/src/vr/vehicle-fits.ts').write_text('// Authored cabin fits; car-local metres. See tools/pack_vr_assets.py.\nexport const vehicleFits: Readonly<Record<string, readonly number[]>> = ' + json.dumps(fits, indent=2) + ';\n', encoding='utf-8')


    rows = ['/* Generated from the authored cabin fits by tools/pack_vr_assets.py. */',
            '#ifndef VR_SEATS_H', '#define VR_SEATS_H', '#include <string.h>',
            'static const struct { const char *name; float seat[3]; } vr_seats[] = {']
    for name, values in fits.items():
        rows.append('    {"' + name + '", {' + ', '.join(str(float(x)) + 'f' for x in values[:3]) + '}},')
    rows += ['};', 'static inline const float *vr_seat(const char *name){',
             '    for (unsigned i = 0; i < sizeof vr_seats / sizeof *vr_seats; i++) if (!strcmp(name, vr_seats[i].name)) return vr_seats[i].seat;',
             '    return vr_seats[0].seat;', '}', '#endif', '']
    (target / 'runtime/web/vr_seats.h').write_text('\n'.join(rows), encoding='utf-8')


if __name__ == '__main__':
    pack(*sys.argv[1:])
