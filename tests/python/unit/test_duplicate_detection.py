"""
Unit tests for duplicate_detection.group_near_duplicates.

The reference implementation below is the original pure-Python all-pairs algorithm (it took ~4.6 minutes
for 30,000 photos and blocked the AI backend). The production version is vectorised; these tests prove
it returns exactly the same groups.
"""

import os
import random
import sys
import time

import pytest

_here = os.path.dirname(os.path.abspath(__file__))
_src_python = os.path.normpath(os.path.join(_here, '..', '..', '..', 'src', 'python'))
if _src_python not in sys.path:
    sys.path.insert(0, _src_python)

from duplicate_detection import group_near_duplicates, hamming_distance  # noqa: E402


def reference_group_near_duplicates(entries, threshold=10):
    """The original algorithm: union-find over every pair, one Python call per pair."""
    valid = [(e['id'], e['phash']) for e in entries if e.get('phash')]
    if len(valid) < 2:
        return []
    parent = list(range(len(valid)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(valid)):
        for j in range(i + 1, len(valid)):
            if hamming_distance(valid[i][1], valid[j][1]) <= threshold:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[ri] = rj

    groups = {}
    for idx, (photo_id, _) in enumerate(valid):
        groups.setdefault(find(idx), []).append(photo_id)
    return [ids for ids in groups.values() if len(ids) >= 2]


def as_comparable(groups):
    """Order of groups and of ids inside a group is not meaningful; the membership is."""
    return sorted(sorted(g) for g in groups)


def flip_bits(value: int, count: int, rng: random.Random) -> int:
    for bit in rng.sample(range(64), count):
        value ^= 1 << bit
    return value


def make_entries(n: int, seed: int, near_fraction: float = 0.3):
    """Random 64-bit pHashes where a fraction are noisy copies (0-12 flipped bits) of an earlier photo."""
    rng = random.Random(seed)
    values = []
    for _ in range(n):
        if values and rng.random() < near_fraction:
            values.append(flip_bits(rng.choice(values), rng.randint(0, 12), rng))
        else:
            values.append(rng.getrandbits(64))
    return [{'id': 1000 + i, 'phash': f'{v:016x}'} for i, v in enumerate(values)]


class TestMatchesReference:
    @pytest.mark.parametrize('threshold', [0, 3, 10, 20])
    @pytest.mark.parametrize('seed', [1, 2, 3])
    def test_same_groups_as_original_algorithm(self, seed, threshold):
        entries = make_entries(400, seed)

        assert as_comparable(group_near_duplicates(entries, threshold)) == as_comparable(
            reference_group_near_duplicates(entries, threshold)
        )

    def test_chains_of_near_hashes_form_one_group(self):
        # a~b and b~c but a is not within the threshold of c: union-find must still join all three.
        a = 0
        b = (1 << 8) - 1          # 8 bits from a
        c = b ^ (((1 << 8) - 1) << 8)  # 8 bits from b, 16 from a
        far = (1 << 64) - 1       # 64 bits from a, 56 from b, 48 from c
        entries = [{'id': i, 'phash': f'{v:016x}'} for i, v in enumerate([a, b, c, far])]

        groups = group_near_duplicates(entries, 10)

        assert as_comparable(groups) == [[0, 1, 2]]

    def test_identical_hashes_group_together(self):
        entries = [{'id': i, 'phash': 'ffffffffffffffff'} for i in range(5)]

        assert as_comparable(group_near_duplicates(entries, 0)) == [[0, 1, 2, 3, 4]]

    def test_works_across_block_boundaries(self):
        # More entries than fit in one comparison block, with a duplicate pair split across blocks.
        entries = make_entries(3000, seed=7, near_fraction=0.0)
        entries[5]['phash'] = entries[2990]['phash']

        assert as_comparable(group_near_duplicates(entries, 10)) == as_comparable(
            reference_group_near_duplicates(entries, 10)
        )


class TestInputHandling:
    def test_fewer_than_two_valid_entries_returns_nothing(self):
        assert group_near_duplicates([], 10) == []
        assert group_near_duplicates([{'id': 1, 'phash': 'a' * 16}], 10) == []

    def test_entries_without_a_hash_are_skipped(self):
        entries = [
            {'id': 1, 'phash': 'a' * 16},
            {'id': 2, 'phash': None},
            {'id': 3, 'phash': ''},
            {'id': 4},
            {'id': 5, 'phash': 'a' * 16},
        ]

        assert as_comparable(group_near_duplicates(entries, 10)) == [[1, 5]]

    def test_hashes_of_different_lengths_are_never_near(self):
        # The original treats different-length hashes as maximally different (distance 64).
        entries = [
            {'id': 1, 'phash': 'a' * 16},
            {'id': 2, 'phash': 'a' * 8},
            {'id': 3, 'phash': 'a' * 16},
            {'id': 4, 'phash': 'a' * 8},
        ]

        assert as_comparable(group_near_duplicates(entries, 10)) == as_comparable(
            reference_group_near_duplicates(entries, 10)
        )
        assert as_comparable(group_near_duplicates(entries, 10)) == [[1, 3], [2, 4]]

    def test_threshold_of_64_or_more_groups_everything_like_the_original(self):
        entries = make_entries(30, seed=11)

        assert as_comparable(group_near_duplicates(entries, 64)) == as_comparable(
            reference_group_near_duplicates(entries, 64)
        )


class TestSpeed:
    def test_ten_thousand_hashes_finish_in_seconds(self):
        # The original needs about 30 s for 10,000 photos (and 4.6 minutes for 30,000).
        entries = make_entries(10_000, seed=5, near_fraction=0.05)

        start = time.perf_counter()
        group_near_duplicates(entries, 10)
        elapsed = time.perf_counter() - start

        assert elapsed < 10, f'took {elapsed:.1f}s'
