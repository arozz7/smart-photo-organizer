"""
Duplicate photo detection utilities.

Provides:
- compute_phash: Compute perceptual hash (pHash) for an image file.
- group_near_duplicates: Cluster pre-computed pHashes by Hamming distance.
"""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger('ai_engine.duplicate_detection')


def compute_phash(file_path: str) -> Optional[str]:
    """
    Compute the perceptual hash (pHash) of an image.

    Args:
        file_path: Absolute path to the image file.

    Returns:
        16-character hex string representing the 64-bit pHash,
        or None if the image cannot be opened.
    """
    try:
        import imagehash
        from PIL import Image, ImageFile
        ImageFile.LOAD_TRUNCATED_IMAGES = True

        with Image.open(file_path) as img:
            # Convert to RGB to handle palette/CMYK images
            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
            h = imagehash.phash(img, hash_size=8)  # 64-bit hash → 16 hex chars
            return str(h)
    except Exception as e:
        logger.warning(f"[duplicate_detection] pHash failed for {Path(file_path).name}: {e}")
        return None


def compute_phash_batch(entries: list[dict]) -> list[dict]:
    """
    Compute pHash for a batch of images.

    Args:
        entries: List of dicts with keys ``id`` (int) and ``file_path`` (str).
                 ``preview_cache_path`` is used as fallback for RAW files.

    Returns:
        List of dicts ``{id, phash}`` for entries that succeeded.
        Failures are silently skipped so one bad file doesn't abort the batch.
    """
    results = []
    for entry in entries:
        photo_id = entry.get('id')
        file_path = entry.get('file_path', '')
        preview_path = entry.get('preview_cache_path')

        # Prefer preview for RAW files (they open faster)
        ext = Path(file_path).suffix.lower()
        is_raw = ext in {'.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.kdc', '.mrw'}
        path_to_use = preview_path if (is_raw and preview_path) else file_path

        if not path_to_use:
            continue

        h = compute_phash(path_to_use)
        if h is not None:
            results.append({'id': photo_id, 'phash': h})

    return results


def hamming_distance(hash_a: str, hash_b: str) -> int:
    """
    Compute Hamming distance between two hex pHash strings.

    Args:
        hash_a: First 16-char hex pHash string.
        hash_b: Second 16-char hex pHash string.

    Returns:
        Number of differing bits (0 = identical, 64 = completely different).
    """
    if len(hash_a) != len(hash_b):
        return 64  # Incompatible lengths — treat as maximally different
    int_a = int(hash_a, 16)
    int_b = int(hash_b, 16)
    return bin(int_a ^ int_b).count('1')


def group_near_duplicates(
    entries: list[dict],
    threshold: int = 10
) -> list[list[int]]:
    """
    Group photo IDs whose pHashes are within `threshold` Hamming distance.

    Uses a greedy union-find approach: O(n²) but operates on integers, so
    it handles 100 K entries comfortably in memory.

    Args:
        entries: List of dicts with keys ``id`` (int) and ``phash`` (str).
                 Entries with a null/empty phash are skipped.
        threshold: Maximum Hamming distance to consider two photos near-duplicates.
                   Default 10 (~15 % of 64 bits) is a safe default for
                   resized/compressed copies of the same image.

    Returns:
        List of groups (each group is a list of photo IDs with ≥ 2 members).
        Single photos are omitted.
    """
    valid = [(e['id'], e['phash']) for e in entries if e.get('phash')]

    if len(valid) < 2:
        return []

    n = len(valid)
    parent = list(range(n))  # Union-Find parent array

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]  # Path compression
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(n):
        for j in range(i + 1, n):
            if hamming_distance(valid[i][1], valid[j][1]) <= threshold:
                union(i, j)

    # Collect groups
    from collections import defaultdict
    groups: dict[int, list[int]] = defaultdict(list)
    for idx, (photo_id, _) in enumerate(valid):
        groups[find(idx)].append(photo_id)

    return [ids for ids in groups.values() if len(ids) >= 2]
