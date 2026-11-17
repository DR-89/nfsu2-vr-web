"""Small synthetic pack/event-graph fixtures; no retail bytes in this test."""
import hashlib
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import prepare_vr_mods as mods
from prepare_vr_data import copy_data, preserved_music


def graph(first):
    b = bytearray(0x84)
    b[:5] = b'xDFP\x04'
    b[0xf] = 1
    struct.pack_into('<H', b, 0x12, 1)
    struct.pack_into('<h', b, 0x20, 0x30//4)
    struct.pack_into('<h', b, 0x40, 0x50//4)
    struct.pack_into('<I', b, 0x60, 0x70//4)
    struct.pack_into('<I', b, 0x70, 0x84//4)
    struct.pack_into('<4I', b, 0x74, first, 1000, first+1, 2000)
    return bytes(b)


def streams(first):
    stream = b'SCHl' + struct.pack('<I', 16) + b'PT\0\0\xa0\x01\x17\xff' + b'SCEl' + struct.pack('<I', 8)
    return bytes(first*128) + stream.ljust(128, b'\0') + stream


def texture(pixel=b'\x01\x02\x03\xff'):
    return struct.pack('<4sIII', b'NTXP', 1, 1, 0) + struct.pack('<IIHHIHHIIIII', 1, 2, 1, 1, 21, 1, 1, 21, 1, 58, 4, 56) + b'a\0' + pixel


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.native, self.game = root/'native', root/'prepared'
        self.pc = self.native/'build/xyz-lan-qa/live-mod-assets'
        for p in (self.pc/'TEXPACKS', self.pc/'pfdata', self.game/'PFDATA'):
            p.mkdir(parents=True)
        (self.game/mods.MARKER).write_text('{}')
        (self.game/'SPEED2.EXE').write_bytes(b'test executable identity')
        expected = hashlib.sha256(b'test executable identity').hexdigest()
        self.identity = patch.object(mods, 'EXE_HASH', expected)
        self.identity.start()
        self.addCleanup(self.identity.stop)
        (self.pc/'TEXPACKS/test.pak').write_bytes(texture())
        for path, first in ((self.game/'PFDATA', 0), (self.pc/'pfdata', 1)):
            (path/'MusicSFx.mpf').write_bytes(graph(first))
            (path/'MusicSFx.mus').write_bytes(streams(first))

    def test_verify_then_import_keeps_originals_and_is_idempotent(self):
        self.assertEqual(mods.prepare(self.native, self.game, True)['copied'], 0)
        self.assertFalse((self.game/'TEXPACKS').exists())
        self.assertEqual(mods.prepare(self.native, self.game)['copied'], 5)
        for ext, make in (('mpf', graph), ('mus', streams)):
            self.assertEqual((self.game/f'PFDATA/original/MusicSFx.{ext}').read_bytes(), make(0))
            self.assertEqual((self.game/f'PFDATA/MusicSFx.{ext}').read_bytes(), make(1))
        self.assertEqual(mods.prepare(self.native, self.game)['copied'], 0)
        self.assertNotIn('pfdata', [p.name for p in self.game.iterdir()], 'preserve existing folder case')
        source = Path(self.tmp.name)/'retail'
        (source/'PFDATA').mkdir(parents=True)
        (source/'PFDATA/MusicSFx.mus').write_bytes(streams(0))
        copy_data(source, self.game, {'pfdata'}, preserved_music(self.game))
        self.assertEqual((self.game/'PFDATA/MusicSFx.mus').read_bytes(), streams(1))
        (self.game/'PFDATA/MusicSFx.mus').write_bytes(b'edited')
        with self.assertRaisesRegex(ValueError, 'no data overwritten'):
            preserved_music(self.game)

    def test_bad_source_and_edited_targets_never_replace_original_data(self):
        source = self.pc/'TEXPACKS/test.pak'
        source.write_bytes(b'broken')
        with self.assertRaises(ValueError):
            mods.prepare(self.native, self.game)
        self.assertEqual((self.game/'PFDATA/MusicSFx.mpf').read_bytes(), graph(0))
        source.write_bytes(texture())
        mods.prepare(self.native, self.game)
        target = self.game/'TEXPACKS/test.pak'
        target.write_bytes(texture(b'abcd'))
        with self.assertRaises(ValueError):
            mods.prepare(self.native, self.game)
        self.assertEqual(target.read_bytes(), texture(b'abcd'))

    def test_music_event_graph_and_stream_buffer_remain_retail(self):
        mpf = self.pc/'pfdata/MusicSFx.mpf'
        b = bytearray(graph(1))
        b[0x78] ^= 1  # a duration, not a relocated stream
        mpf.write_bytes(b)
        with self.assertRaisesRegex(ValueError, 'more than song offsets'):
            mods.prepare(self.native, self.game)
        b = bytearray(graph(1))
        b[0x7c] = 3  # moves the stream-buffer sizing pair apart
        mpf.write_bytes(b)
        with self.assertRaisesRegex(ValueError, 'buffer size'):
            mods.prepare(self.native, self.game)
        self.assertFalse((self.game/'TEXPACKS').exists())

    def test_destination_cannot_leave_private_game_folder(self):
        for name in ('../other', '/other', 'TEXPACKS/../../other', 'TEXPACKS/C:/other', 'TEXPACKS/..\\other'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                mods.destination(self.game, name)


if __name__ == '__main__':
    unittest.main()
