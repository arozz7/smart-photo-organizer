"""
Unit tests for SAM 3 segmentation API endpoints.

All tests inject MockSegmentationProvider via FastAPI dependency_overrides —
no real SAM 3 model is loaded.
"""

import base64
import io
import sys
import os
import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))


# ---------------------------------------------------------------------------
# Mock provider
# ---------------------------------------------------------------------------

class MockSegmentationProvider:
    """
    In-memory mock that satisfies the SegmentationProvider interface.
    Stores PIL Images per session; returns deterministic fake masks.
    """

    def __init__(self) -> None:
        self._sessions: dict = {}

    def initialize(self) -> None:
        pass

    def set_image(self, image_path: str) -> str:
        image = Image.open(image_path).convert("RGB")
        session_id = "test-session-id"
        self._sessions[session_id] = image
        return session_id

    def get_session_image(self, session_id: str):
        if session_id not in self._sessions:
            raise KeyError(session_id)
        return self._sessions[session_id]

    def _mock_result(self, session_id: str) -> dict:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        image = self._sessions[session_id]
        mask_b64 = _make_mask_b64(image.width, image.height)
        return {"masks": [{"mask_b64": mask_b64, "score": 0.95, "area": 1000}]}

    def predict_from_text(self, session_id: str, text: str) -> dict:
        return self._mock_result(session_id)

    def predict_from_box(self, session_id: str, box: list) -> dict:
        return self._mock_result(session_id)

    def predict_from_points(self, session_id: str, points: list, labels: list) -> dict:
        return self._mock_result(session_id)

    def get_capabilities(self) -> dict:
        return {
            "provider": "mock",
            "model_ready": True,
            "text_prompts": True,
            "video": False,
            "checkpoint": "mock/path",
        }

    def cleanup(self) -> None:
        self._sessions.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mask_b64(width: int = 100, height: int = 100, fill: int = 128) -> str:
    """Create a grayscale PNG and return as base64 string."""
    img = Image.new("L", (width, height), color=fill)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_provider():
    return MockSegmentationProvider()


@pytest.fixture
def client(mock_provider):
    """TestClient with MockSegmentationProvider injected."""
    from api.server import create_app
    from api.routes.segment import get_provider

    app = create_app()
    app.dependency_overrides[get_provider] = lambda: mock_provider
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def test_image(tmp_path) -> str:
    """Write a small real JPEG to a temp dir and return the file path."""
    img = Image.new("RGB", (200, 200), color=(100, 150, 200))
    path = tmp_path / "test.jpg"
    img.save(str(path))
    return str(path)


@pytest.fixture
def loaded_session(client, test_image):
    """Return (client, session_id) after loading the test image."""
    response = client.post("/api/v1/segment/set-image", json={"imagePath": test_image})
    assert response.status_code == 200
    session_id = response.json()["session_id"]
    return client, session_id


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------

class TestCapabilitiesEndpoint:
    def test_capabilities_returns_model_info(self, client):
        """GET /capabilities must return provider name and feature flags."""
        response = client.get("/api/v1/segment/capabilities")
        assert response.status_code == 200
        data = response.json()
        assert "provider" in data
        assert "model_ready" in data
        assert data["text_prompts"] is True


class TestSetImageEndpoint:
    def test_set_image_returns_session_id(self, client, test_image):
        """Valid image path must return a session_id."""
        response = client.post("/api/v1/segment/set-image", json={"imagePath": test_image})
        assert response.status_code == 200
        assert "session_id" in response.json()
        assert response.json()["session_id"] == "test-session-id"

    def test_set_image_nonexistent_path_returns_404(self, client):
        """Non-existent path must return 404."""
        response = client.post(
            "/api/v1/segment/set-image",
            json={"imagePath": "/nonexistent/image.jpg"},
        )
        assert response.status_code == 404

    def test_set_image_invalid_extension_returns_400(self, client, tmp_path):
        """Unsupported file type must return 400."""
        bad_file = tmp_path / "data.csv"
        bad_file.write_text("a,b,c")
        response = client.post(
            "/api/v1/segment/set-image",
            json={"imagePath": str(bad_file)},
        )
        assert response.status_code == 400


class TestPredictEndpoint:
    def test_predict_from_text_returns_masks(self, loaded_session):
        """Text prompt must return a non-empty masks list with mask_b64 and score."""
        client, session_id = loaded_session
        response = client.post(
            "/api/v1/segment/predict",
            json={"session_id": session_id, "text": "person"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "masks" in data
        assert len(data["masks"]) > 0
        assert "mask_b64" in data["masks"][0]
        assert "score" in data["masks"][0]

    def test_predict_from_box_returns_masks(self, loaded_session):
        """Box prompt must return a masks list."""
        client, session_id = loaded_session
        response = client.post(
            "/api/v1/segment/predict",
            json={"session_id": session_id, "box": [10, 10, 150, 150]},
        )
        assert response.status_code == 200
        assert "masks" in response.json()

    def test_predict_from_points_returns_masks(self, loaded_session):
        """Point prompt must return a masks list."""
        client, session_id = loaded_session
        response = client.post(
            "/api/v1/segment/predict",
            json={
                "session_id": session_id,
                "points": [[100, 100], [50, 50]],
                "point_labels": [1, 0],
            },
        )
        assert response.status_code == 200
        assert "masks" in response.json()

    def test_predict_invalid_session_returns_404(self, client):
        """Unknown session_id must return 404."""
        response = client.post(
            "/api/v1/segment/predict",
            json={"session_id": "nonexistent-session", "text": "cat"},
        )
        assert response.status_code == 404

    def test_predict_no_prompt_returns_400(self, loaded_session):
        """Predict with no prompt type must return 400."""
        client, session_id = loaded_session
        response = client.post(
            "/api/v1/segment/predict",
            json={"session_id": session_id},
        )
        assert response.status_code == 400


class TestApplyEndpoints:
    def test_background_remove_returns_result(self, loaded_session):
        """background-remove must return a result_b64 PNG."""
        client, session_id = loaded_session
        mask_b64 = _make_mask_b64()
        response = client.post(
            "/api/v1/segment/apply/background-remove",
            json={"session_id": session_id, "mask_b64": mask_b64},
        )
        assert response.status_code == 200
        data = response.json()
        assert "result_b64" in data
        assert data["session_id"] == session_id

    def test_blur_applies_to_masked_region(self, loaded_session):
        """blur must return a result_b64 and accept a radius param."""
        client, session_id = loaded_session
        mask_b64 = _make_mask_b64()
        response = client.post(
            "/api/v1/segment/apply/blur",
            json={"session_id": session_id, "mask_b64": mask_b64, "radius": 10},
        )
        assert response.status_code == 200
        assert "result_b64" in response.json()

    def test_isolate_returns_subject(self, loaded_session):
        """isolate must return a cropped transparent PNG."""
        client, session_id = loaded_session
        mask_b64 = _make_mask_b64(fill=255)  # all-white mask
        response = client.post(
            "/api/v1/segment/apply/isolate",
            json={"session_id": session_id, "mask_b64": mask_b64},
        )
        assert response.status_code == 200
        assert "result_b64" in response.json()

    def test_apply_invalid_session_returns_404(self, client):
        """apply/* with unknown session must return 404."""
        mask_b64 = _make_mask_b64()
        response = client.post(
            "/api/v1/segment/apply/blur",
            json={"session_id": "bad-session", "mask_b64": mask_b64, "radius": 5},
        )
        assert response.status_code == 404
