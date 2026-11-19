"""
Neighbour counts for unassigned faces (parked-faces plan, Phase 0).

For every face in a requested row range, counts how many other faces are "twins" (within an L2 distance, on unit-length
descriptors) and, optionally, how far the face is from the nearest named-person centroid. The caller uses this to tell
faces that recur (worth reviewing) from faces that appear once. Nothing is changed or stored here.

Descriptors arrive as one raw float32 file (rows x dim) written by the main process; a whole-library JSON payload
would exceed what can be sent as one message. The caller asks for row ranges one after another so that other requests
(the Python backend handles one at a time) are not blocked for long.
"""

import logging
from pathlib import Path
from typing import Any, Optional

import numpy as np

logger = logging.getLogger('ai_engine.neighbour_counts')

DEFAULT_BLOCK_ROWS = 512
DEFAULT_DUPLICATE_DISTANCE = 0.001


def normalise_rows(rows: np.ndarray) -> np.ndarray:
    """Return the rows scaled to unit length as float32; all-zero rows stay zero."""
    rows = np.asarray(rows, dtype=np.float32)
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return rows / norms


def count_twins(
    vectors: np.ndarray,
    row_start: int,
    row_end: int,
    distances: list[float],
    duplicate_distance: float = DEFAULT_DUPLICATE_DISTANCE,
    block_rows: int = DEFAULT_BLOCK_ROWS,
    shot_ids: Optional[np.ndarray] = None,
) -> tuple[list[list[int]], list[int]]:
    """Count twins for rows ``row_start`` up to ``row_end`` against every row of ``vectors``.

    A face is never its own twin. Two kinds of close faces are not twins, because they are one appearance and not a
    recurring person: exact copies (at or below ``duplicate_distance``) and faces of the same shot (equal ``shot_ids``).
    Those are counted separately.

    Args:
        vectors: Unit-length descriptors, shape (n, dim).
        row_start: First row to answer for.
        row_end: One past the last row to answer for.
        distances: L2 distances; one count list is returned per distance.
        duplicate_distance: L2 distance at or below which another face counts as an exact copy.
        block_rows: Rows processed per matrix product (bounds memory use).
        shot_ids: Optional shot label per row of ``vectors``; faces with the same label are the same shot.

    Returns:
        ``(counts, excluded)``: ``counts[k][i]`` is the twin count of row ``row_start + i`` within ``distances[k]``;
        ``excluded[i]`` is how many faces within ``distances[0]`` were left out as copies or same-shot faces.
    """
    squared_limits = [distance * distance for distance in distances]
    duplicate_limit = duplicate_distance * duplicate_distance
    counts: list[list[int]] = [[] for _ in distances]
    excluded: list[int] = []

    for block_start in range(row_start, row_end, block_rows):
        block_end = min(block_start + block_rows, row_end)
        squared = vectors[block_start:block_end] @ vectors.T
        squared *= -2.0
        squared += 2.0  # squared L2 distance between unit vectors: 2 - 2 * dot

        own_rows = np.arange(block_end - block_start)
        squared[own_rows, block_start + own_rows] = np.inf

        not_a_twin = squared <= duplicate_limit
        if shot_ids is not None:
            not_a_twin |= shot_ids[block_start:block_end, None] == shot_ids[None, :]
        excluded.extend(((squared <= squared_limits[0]) & not_a_twin).sum(axis=1).tolist())
        for index, limit in enumerate(squared_limits):
            counts[index].extend(((squared <= limit) & ~not_a_twin).sum(axis=1).tolist())

    return counts, excluded


def nearest_centroid_distances(vectors: np.ndarray, centroids: np.ndarray) -> Optional[np.ndarray]:
    """Return each vector's L2 distance to its nearest centroid, or None when there are no centroids.

    Vectors are unit length; centroids are used as stored (the app compares them the same way).
    """
    if centroids.shape[0] == 0:
        return None
    centroid_norms = np.sum(centroids * centroids, axis=1)
    squared = 1.0 + centroid_norms[None, :] - 2.0 * (vectors @ centroids.T)
    return np.sqrt(np.maximum(squared.min(axis=1), 0.0))


def _error(message: str, req_id: Optional[str]) -> dict[str, Any]:
    return {"type": "neighbour_counts_result", "error": message, "reqId": req_id}


def face_neighbour_counts(payload: dict[str, Any], req_id: Optional[str] = None) -> dict[str, Any]:
    """Command: twin counts (and nearest named centroid) for a range of rows of a descriptor file.

    Payload:
        dataPath: Raw float32 file, rows x ``dim`` (not necessarily unit length).
        shotsPath: Optional raw int32 file, one shot id per row; faces with the same id are one shot.
        dim: Descriptor length.
        rowStart, rowEnd: Rows to answer for (end exclusive).
        distances: L2 distances to count twins within.
        duplicateDistance: Optional; distance at or below which a face is an exact copy.
        centroids: Optional list of named-person centroid vectors.

    Returns:
        ``counts`` (one list per distance), ``excluded``, ``nearestCentroid`` (list, or None without centroids) and
        ``total`` (rows in the file), or an ``error`` message.
    """
    try:
        data_path = payload.get('dataPath')
        dim = int(payload.get('dim', 0))
        row_start = int(payload.get('rowStart', 0))
        row_end = int(payload.get('rowEnd', 0))
        distances = [float(d) for d in payload.get('distances', [])]
        duplicate_distance = float(payload.get('duplicateDistance', DEFAULT_DUPLICATE_DISTANCE))
        centroid_rows = payload.get('centroids') or []

        if not data_path or not Path(data_path).is_file():
            return _error("descriptor file not found", req_id)
        if dim <= 0:
            return _error("dim must be positive", req_id)
        if not distances:
            return _error("no distances to count", req_id)

        flat = np.fromfile(data_path, dtype=np.float32)
        if flat.size == 0 or flat.size % dim != 0:
            return _error("descriptor file is not a whole number of rows", req_id)
        total = flat.size // dim
        if not 0 <= row_start < row_end <= total:
            return _error(f"row range {row_start}-{row_end} is outside 0-{total}", req_id)

        shot_ids = None
        shots_path = payload.get('shotsPath')
        if shots_path:
            if not Path(shots_path).is_file():
                return _error("shot id file not found", req_id)
            shot_ids = np.fromfile(shots_path, dtype=np.int32)
            if shot_ids.size != total:
                return _error("shot id file does not have one id per descriptor row", req_id)

        vectors = normalise_rows(flat.reshape(total, dim))
        counts, excluded = count_twins(vectors, row_start, row_end, distances, duplicate_distance, shot_ids=shot_ids)

        centroids = np.asarray(centroid_rows, dtype=np.float32).reshape(-1, dim) if centroid_rows else np.zeros((0, dim), dtype=np.float32)
        nearest = nearest_centroid_distances(vectors[row_start:row_end], centroids)

        return {
            "type": "neighbour_counts_result",
            "counts": counts,
            "excluded": excluded,
            "nearestCentroid": None if nearest is None else nearest.tolist(),
            "total": total,
            "reqId": req_id,
        }
    except (ValueError, TypeError, OSError) as e:
        logger.error(f"Neighbour count failed: {e}")
        return _error(str(e), req_id)
