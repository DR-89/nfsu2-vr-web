import struct
import tempfile
import unittest
from pathlib import Path

from prepare_vr_data import entries, game_entries, prepare


class ArchiveTests(unittest.TestCase):
    def archive(self, directory, name='speech/nisaudio.idx', payload=b'data'):
        index = struct.pack('>II', 128, len(payload)) + name.encode() + b'\0'
        blob = b'BIG4' + struct.pack('>III', 128 + len(payload), 1, 16 + len(index)) + index
        p = Path(directory) / 'sdat.viv'
        p.write_bytes(blob.ljust(128, b'\0') + payload)
        return p

    def test_valid_index_is_bounded_and_payload_is_exact(self):
        with tempfile.TemporaryDirectory() as d:
            p = self.archive(d)
            name, at, size = entries(p)[0]
            self.assertEqual(str(name), 'speech/nisaudio.idx')
            self.assertEqual(p.read_bytes()[at:at + size], b'data')
            p.write_bytes(p.read_bytes()[:-1])
            with self.assertRaises(ValueError):
                entries(p)

    def test_paths_cannot_escape_the_private_game_data(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ['../outside', '/speech/a', 'speech/../../outside', 'speech/C:/outside', 'speech//a', 'scripts/plugin.asi']:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    entries(self.archive(d, name))

    def test_source_installation_is_never_a_destination(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            for target in (p, p / 'nested', p.parent):
                with self.assertRaises(ValueError):
                    prepare(p, target)
            self.assertEqual(list(p.iterdir()), [])

    def test_only_server_served_entries_are_copied(self):
        allowed = game_entries()
        self.assertIn('speech', allowed)
        self.assertIn('speed2.exe', allowed)
        self.assertNotIn('scripts', allowed)
        self.assertNotIn('save', allowed)
        self.assertEqual(len(allowed), 21)


if __name__ == '__main__':
    unittest.main()
