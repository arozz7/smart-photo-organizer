"""
The People page asks for clustering of the whole library, which can mean thousands of groups. Writing one INFO line per
group (about 3,500 lines per page open, each also forwarded into main.log) made the 5 MB logs rotate within an hour and
pushed older history out. Per-group details are DEBUG; INFO keeps one summary.
"""
import logging
import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../src/python")))

from commands.clustering import cluster_faces  # noqa: E402

LOGGER_NAME = "ai_engine.clustering"


def three_tight_groups():
    """Three groups of four near-identical faces."""
    rng = np.random.default_rng(0)
    payload_faces = []
    for group in range(3):
        centre = rng.normal(size=512)
        for member in range(4):
            vector = centre + 0.01 * rng.normal(size=512)
            payload_faces.append({"id": group * 10 + member, "descriptor": vector.tolist()})
    return payload_faces


def run(caplog, level):
    payload = {"faces": three_tight_groups(), "eps": 0.45, "min_samples": 2, "max_spread": 0.75}
    with caplog.at_level(level, logger=LOGGER_NAME):
        return cluster_faces(payload)


def messages(caplog, level):
    return [r.getMessage() for r in caplog.records if r.name == LOGGER_NAME and r.levelno == level]


def test_the_result_is_unchanged(caplog):
    result = run(caplog, logging.INFO)

    assert len(result["clusters"]) == 3
    assert sorted(len(c) for c in result["clusters"]) == [4, 4, 4]


def test_per_group_lines_are_not_written_at_info(caplog):
    run(caplog, logging.INFO)

    info = messages(caplog, logging.INFO)
    assert not any(m.lstrip().startswith("Cluster ") and "size=" in m for m in info)
    assert not any("DEMOTED" in m for m in info)


def test_info_keeps_one_summary_of_the_quality_filter(caplog):
    run(caplog, logging.INFO)

    summaries = [m for m in messages(caplog, logging.INFO) if "kept" in m and "clusters" in m]
    assert len(summaries) == 1
    assert "kept 3 of 3" in summaries[0]


def test_per_group_details_are_still_available_at_debug(caplog):
    run(caplog, logging.DEBUG)

    debug = messages(caplog, logging.DEBUG)
    assert sum(1 for m in debug if m.lstrip().startswith("Cluster ") and "size=" in m) == 3
