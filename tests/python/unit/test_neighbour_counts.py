"""
Phase 0 of the parked-faces plan: count, for each unassigned face, how many other faces are its "twins" (within a distance),
and how far it is from the nearest named person. The result only informs a read-only summary; nothing is changed.

Descriptors are compared as unit vectors, so L2 distance d and dot product s are related by d^2 = 2 - 2s.
"""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../src/python")))

from commands.neighbour_counts import (  # noqa: E402
    count_twins,
    face_neighbour_counts,
    nearest_centroid_distances,
    normalise_rows,
)

DIM = 16


def unit(vector):
    vector = np.asarray(vector, dtype=np.float32)
    return vector / np.linalg.norm(vector)


def at_distance(base, distance, axis):
    """A unit vector exactly `distance` (L2) away from the unit vector `base`, rotated towards basis vector `axis`."""
    other = np.zeros(DIM, dtype=np.float32)
    other[axis] = 1.0
    other -= base * np.dot(other, base)
    other = unit(other)
    # Angle from chord length: d = 2 sin(theta / 2)
    theta = 2 * np.arcsin(distance / 2)
    return unit(np.cos(theta) * base + np.sin(theta) * other)


def base_vector():
    return unit(np.arange(1, DIM + 1))


def test_normalise_rows_gives_unit_length_and_leaves_zero_rows_alone():
    rows = np.array([[3.0, 4.0] + [0.0] * (DIM - 2), [0.0] * DIM], dtype=np.float32)

    result = normalise_rows(rows)

    assert np.linalg.norm(result[0]) == pytest.approx(1.0)
    assert not np.isnan(result).any()
    assert np.all(result[1] == 0)


def test_counts_only_faces_within_each_distance():
    base = base_vector()
    vectors = np.stack([base, at_distance(base, 0.30, 3), at_distance(base, 0.45, 5), at_distance(base, 0.54, 7), at_distance(base, 1.0, 9)])

    counts, excluded = count_twins(vectors, 0, 1, [0.4, 0.5, 0.58], duplicate_distance=0.001)

    assert [c[0] for c in counts] == [1, 2, 3]
    assert excluded == [0]


def test_a_face_is_not_its_own_twin():
    vectors = np.stack([base_vector(), at_distance(base_vector(), 1.0, 3)])

    counts, _ = count_twins(vectors, 0, 2, [0.5], duplicate_distance=0.001)

    assert counts[0] == [0, 0]


def test_exact_duplicates_are_reported_apart_and_not_counted_as_twins():
    """Copies of one photo give identical descriptors: that is one appearance, not a recurring person."""
    base = base_vector()
    vectors = np.stack([base, base.copy(), base.copy(), at_distance(base, 0.4, 2)])

    counts, excluded = count_twins(vectors, 0, 4, [0.5], duplicate_distance=0.001)

    assert counts[0] == [1, 1, 1, 3]  # each copy sees the one genuinely different neighbour; it sees the three others
    assert excluded == [2, 2, 2, 0]


def test_only_the_requested_row_range_is_returned():
    base = base_vector()
    vectors = np.stack([base, at_distance(base, 0.3, 2), at_distance(base, 0.9, 4), at_distance(base, 1.2, 6)])

    counts, excluded = count_twins(vectors, 1, 3, [0.5], duplicate_distance=0.001)

    assert len(counts[0]) == 2 and len(excluded) == 2
    assert counts[0] == [1, 0]


def test_results_do_not_depend_on_the_internal_block_size():
    rng = np.random.default_rng(1)
    vectors = normalise_rows(rng.normal(size=(60, DIM)).astype(np.float32) + 3.0)

    shots = np.arange(60) // 3
    small, ex_small = count_twins(vectors, 0, 60, [1.0], duplicate_distance=0.001, block_rows=7, shot_ids=shots)
    large, ex_large = count_twins(vectors, 0, 60, [1.0], duplicate_distance=0.001, block_rows=1000, shot_ids=shots)

    assert small == large and ex_small == ex_large


def test_faces_of_the_same_shot_are_not_twins_even_when_they_differ_a_little():
    """A RAW file and its exported JPG, or frames of one burst, give close but not identical descriptors."""
    base = base_vector()
    vectors = np.stack([base, at_distance(base, 0.2, 3), at_distance(base, 0.4, 5)])
    shot_ids = np.array([7, 7, 8])   # the first two are the same shot

    counts, excluded = count_twins(vectors, 0, 3, [0.5], duplicate_distance=0.001, shot_ids=shot_ids)

    assert counts[0] == [1, 1, 2]    # the first sees only the third; the third sees both
    assert excluded == [1, 1, 0]     # the first two excluded each other


def test_without_shot_ids_only_exact_copies_are_excluded():
    base = base_vector()
    vectors = np.stack([base, at_distance(base, 0.2, 3)])

    counts, excluded = count_twins(vectors, 0, 2, [0.5], duplicate_distance=0.001)

    assert counts[0] == [1, 1] and excluded == [0, 0]


def test_nearest_centroid_distance_is_the_smallest_over_all_centroids():
    base = base_vector()
    far = at_distance(base, 0.9, 3)
    vectors = np.stack([base, far])
    centroids = np.stack([at_distance(base, 0.2, 5), far.copy()])

    nearest = nearest_centroid_distances(vectors, centroids)

    assert nearest[0] == pytest.approx(0.2, abs=1e-3)   # the first centroid is nearer than the second
    assert nearest[1] == pytest.approx(0.0, abs=1e-3)   # the second centroid is the face itself


def test_no_centroids_means_no_distance():
    assert nearest_centroid_distances(np.stack([base_vector()]), np.zeros((0, DIM), dtype=np.float32)) is None


def write_vectors(path, vectors):
    np.asarray(vectors, dtype=np.float32).tofile(path)


def test_command_reads_the_binary_file_and_answers_for_the_row_range(tmp_path):
    base = base_vector()
    vectors = np.stack([base, at_distance(base, 0.3, 3), at_distance(base, 1.0, 5)])
    data = tmp_path / "descriptors.f32"
    write_vectors(data, vectors * 5.0)  # not unit length on purpose: the command normalises

    response = face_neighbour_counts(
        {"dataPath": str(data), "dim": DIM, "rowStart": 0, "rowEnd": 3, "distances": [0.5, 1.2], "duplicateDistance": 0.001,
         "centroids": [base.tolist()]},
        req_id="r1",
    )

    assert response["reqId"] == "r1"
    assert response["counts"] == [[1, 1, 0], [2, 2, 2]]
    assert response["excluded"] == [0, 0, 0]
    assert response["nearestCentroid"][0] == pytest.approx(0.0, abs=1e-3)
    assert response["total"] == 3


def test_command_reads_shot_ids_from_a_second_file(tmp_path):
    base = base_vector()
    vectors = np.stack([base, at_distance(base, 0.2, 3), at_distance(base, 0.4, 5)])
    data = tmp_path / "descriptors.f32"
    shots = tmp_path / "shots.i32"
    write_vectors(data, vectors)
    np.array([7, 7, 8], dtype=np.int32).tofile(shots)

    response = face_neighbour_counts(
        {"dataPath": str(data), "shotsPath": str(shots), "dim": DIM, "rowStart": 0, "rowEnd": 3, "distances": [0.5]}, req_id="s1")

    assert response["counts"] == [[1, 1, 2]]
    assert response["excluded"] == [1, 1, 0]


def test_command_refuses_shot_ids_that_do_not_match_the_rows(tmp_path):
    data = tmp_path / "descriptors.f32"
    shots = tmp_path / "shots.i32"
    write_vectors(data, np.stack([base_vector(), unit(np.ones(DIM))]))
    np.array([1, 2, 3], dtype=np.int32).tofile(shots)

    response = face_neighbour_counts(
        {"dataPath": str(data), "shotsPath": str(shots), "dim": DIM, "rowStart": 0, "rowEnd": 1, "distances": [0.5]}, req_id="s2")

    assert "error" in response


def test_command_refuses_a_missing_shot_file(tmp_path):
    data = tmp_path / "descriptors.f32"
    write_vectors(data, np.stack([base_vector()]))

    response = face_neighbour_counts(
        {"dataPath": str(data), "shotsPath": str(tmp_path / "gone.i32"), "dim": DIM, "rowStart": 0, "rowEnd": 1, "distances": [0.5]}, req_id="s3")

    assert "error" in response


def test_command_without_centroids_leaves_nearest_centroid_empty(tmp_path):
    data = tmp_path / "descriptors.f32"
    write_vectors(data, np.stack([base_vector(), unit(np.ones(DIM))]))

    response = face_neighbour_counts({"dataPath": str(data), "dim": DIM, "rowStart": 0, "rowEnd": 2, "distances": [0.5]}, req_id=None)

    assert response["nearestCentroid"] is None


VALID = {"dim": DIM, "rowStart": 0, "rowEnd": 1, "distances": [0.5]}


@pytest.mark.parametrize(
    "overrides",
    [
        {"dataPath": None},                          # no file named
        {"dataPath": "does-not-exist.f32"},
        {"dim": 0},
        {"rowStart": 2, "rowEnd": 1},                # reversed range
        {"rowEnd": 99},                              # beyond the data
        {"distances": []},                           # nothing to count
    ],
)
def test_command_refuses_bad_input_without_raising(tmp_path, overrides):
    data = tmp_path / "descriptors.f32"
    write_vectors(data, np.stack([base_vector(), unit(np.ones(DIM))]))
    payload = {**VALID, "dataPath": str(data), **overrides}
    if payload["dataPath"] is None:
        del payload["dataPath"]

    response = face_neighbour_counts(payload, req_id="r2")

    assert "error" in response and response["reqId"] == "r2"


def test_command_refuses_a_file_that_is_not_a_whole_number_of_rows(tmp_path):
    data = tmp_path / "descriptors.f32"
    np.arange(DIM * 2 + 3, dtype=np.float32).tofile(data)

    response = face_neighbour_counts({"dataPath": str(data), "dim": DIM, "rowStart": 0, "rowEnd": 1, "distances": [0.5]}, req_id="r3")

    assert "error" in response
