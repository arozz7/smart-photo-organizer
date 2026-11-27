"""
Review Needed splits a cluster of more than `max_size` faces into smaller ones. The first version used Ward linkage, whose cost grows with the
square of the cluster size: one chain-linked cluster of about 23,000 faces took about 2 minutes and over 2 GB, while the whole page waited. The
split now uses k-means, which takes about 10 seconds for the same cluster. These tests pin what the split must keep: every face lands in exactly
one piece, no piece is over the size limit, and well separated groups are not mixed.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../src/python")))

from facelib.faces import split_oversized_cluster  # noqa: E402

DIM = 32


def unit(vectors: np.ndarray) -> np.ndarray:
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def groups_of_faces(group_count: int, size: int, noise: float = 0.02):
    """`group_count` well separated groups of `size` faces: ids, unit vectors, id -> row, and which group each id came from."""
    rng = np.random.default_rng(1)
    centres = unit(rng.normal(size=(group_count, DIM)))
    rows, ids, origin = [], [], {}
    for group, centre in enumerate(centres):
        for member in range(size):
            face_id = group * 10_000 + member
            rows.append(centre + noise * rng.normal(size=DIM))
            ids.append(face_id)
            origin[face_id] = group
    matrix = unit(np.array(rows))
    return ids, matrix, {face_id: row for row, face_id in enumerate(ids)}, origin


def test_a_cluster_within_the_limit_is_left_alone():
    ids, matrix, id_to_idx, _ = groups_of_faces(1, 30)

    assert split_oversized_cluster(ids, matrix, id_to_idx, max_size=50) == [ids]


def test_every_face_lands_in_exactly_one_piece_and_no_piece_is_too_big():
    ids, matrix, id_to_idx, _ = groups_of_faces(4, 300)

    pieces = split_oversized_cluster(ids, matrix, id_to_idx, max_size=200)

    flat = [face_id for piece in pieces for face_id in piece]
    assert sorted(flat) == sorted(ids)
    assert all(0 < len(piece) <= 200 for piece in pieces)


def test_well_separated_groups_are_not_mixed_in_one_piece():
    ids, matrix, id_to_idx, origin = groups_of_faces(3, 400)

    pieces = split_oversized_cluster(ids, matrix, id_to_idx, max_size=200)

    assert all(len({origin[face_id] for face_id in piece}) == 1 for piece in pieces)


def test_the_same_faces_give_the_same_pieces_each_time():
    ids, matrix, id_to_idx, _ = groups_of_faces(3, 250)

    first = split_oversized_cluster(ids, matrix, id_to_idx, max_size=100)
    second = split_oversized_cluster(ids, matrix, id_to_idx, max_size=100)

    assert first == second


def test_identical_faces_that_cannot_be_told_apart_are_still_cut_down_to_size_without_losing_any():
    ids = list(range(1, 451))
    matrix = unit(np.tile(np.ones((1, DIM)), (len(ids), 1)))
    id_to_idx = {face_id: row for row, face_id in enumerate(ids)}

    pieces = split_oversized_cluster(ids, matrix, id_to_idx, max_size=200)

    assert sorted(face_id for piece in pieces for face_id in piece) == ids
    assert all(0 < len(piece) <= 200 for piece in pieces)
