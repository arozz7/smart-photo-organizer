"""
IVF indexes only visit `nprobe` of their lists per search. FAISS defaults to 1 and does not store the setting in the file,
so a search after every app start missed neighbours that sit near a list's edge (86% of true nearest neighbours found on a
real 3,407-face library; 100% at 10). The store sets it after building and after loading.
"""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../src/python")))

faiss = pytest.importorskip("faiss")

from facelib import vector_store  # noqa: E402

IVF_THRESHOLD_FACES = 2000  # vector_store switches to an IVF index from this many faces


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(vector_store, "index_file", str(tmp_path / "vectors.index"))
    monkeypatch.setattr(vector_store, "id_map_file", str(tmp_path / "id_map.pkl"))
    monkeypatch.setattr(vector_store, "index", None)
    monkeypatch.setattr(vector_store, "id_map", {})
    return vector_store


def faces(count, seed=0):
    """Descriptors in loose groups, like real faces of the same people."""
    rng = np.random.default_rng(seed)
    centres = rng.normal(size=(60, 512))
    vectors = centres[rng.integers(0, 60, size=count)] + 0.35 * rng.normal(size=(count, 512))
    return vectors.astype("float32")


def test_a_rebuilt_ivf_index_visits_more_than_one_list(store):
    vectors = faces(IVF_THRESHOLD_FACES + 100)

    store.rebuild_index(vectors.tolist(), list(range(len(vectors))))

    assert isinstance(store.index, faiss.IndexIVF)
    assert store.index.nprobe >= 8


def test_an_ivf_index_loaded_from_disk_visits_more_than_one_list(store):
    vectors = faces(IVF_THRESHOLD_FACES + 100)
    store.rebuild_index(vectors.tolist(), list(range(len(vectors))))
    store.index = None                      # what a fresh app start looks like

    store.init_faiss()

    assert store.index.nprobe >= 8


def test_a_small_exact_index_is_left_alone(store):
    vectors = faces(50)

    store.rebuild_index(vectors.tolist(), list(range(50)))

    assert not isinstance(store.index, faiss.IndexIVF)
    assert store.index.ntotal == 50


def test_searches_find_the_true_nearest_face(store):
    vectors = faces(IVF_THRESHOLD_FACES + 100, seed=1)
    ids = list(range(1000, 1000 + len(vectors)))
    store.rebuild_index(vectors.tolist(), ids)
    store.index = None
    store.init_faiss()

    rng = np.random.default_rng(2)
    picks = rng.choice(len(vectors), 150, replace=False)
    queries = vectors[picks] + 0.05 * rng.normal(size=(150, 512)).astype("float32")

    # Ground truth by brute force on normalised vectors.
    unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
    q = queries / np.linalg.norm(queries, axis=1, keepdims=True)
    truth = (q @ unit.T).argmax(axis=1)

    results = store.search_index_batch(queries.tolist(), k=3, threshold=4.0)
    found = sum(1 for k, matches in enumerate(results) if ids[truth[k]] in [m["id"] for m in matches])

    assert found / len(queries) >= 0.98, f"found {found} of {len(queries)}"
