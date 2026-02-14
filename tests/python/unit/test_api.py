"""
Unit tests for Debug API endpoints.

Tests the FastAPI routes for face detection debugging.
"""

import pytest
from fastapi.testclient import TestClient
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))


class TestStatusEndpoints:
    """Tests for /api/v1/status and /api/v1/health endpoints."""
    
    @pytest.fixture
    def client(self):
        """Create test client with mocked dependencies."""
        # Import here to avoid loading AI models during test collection
        from api.server import create_app
        app = create_app()
        return TestClient(app)
    
    def test_health_returns_200(self, client):
        """Health endpoint should return 200 with healthy status."""
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["healthy"] is True
        assert "python_version" in data
        assert "models" in data
    
    def test_status_returns_200(self, client):
        """Status endpoint should return 200 with idle status."""
        response = client.get("/api/v1/status")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "idle"
        assert "timestamp" in data
        assert data["queue_depth"] == 0


class TestDebugConfigEndpoints:
    """Tests for /api/v1/debug/config endpoints."""
    
    @pytest.fixture
    def client(self):
        from api.server import create_app
        app = create_app()
        return TestClient(app)
    
    def test_get_config_returns_current_settings(self, client):
        """GET /debug/config should return current AI config."""
        response = client.get("/api/v1/debug/config")
        assert response.status_code == 200
        data = response.json()
        assert "detection" in data
        assert "nms" in data
        assert "vlm" in data
        assert "ai_mode" in data
    
    def test_post_config_updates_settings(self, client):
        """POST /debug/config should update settings and return changes."""
        response = client.post("/api/v1/debug/config", json={
            "detection": {"threshold": 0.55}
        })
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["changes"]) > 0
        assert "detection.threshold" in data["changes"][0]


class TestAuthMiddleware:
    """Tests for API key authentication middleware."""
    
    def test_health_bypasses_auth(self):
        """Health endpoint should bypass API key auth."""
        import os
        os.environ["API_KEY"] = "test-secret-key"
        
        from api.server import create_app
        app = create_app()
        client = TestClient(app)
        
        # Health should work without API key
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        
        # Clean up
        del os.environ["API_KEY"]
    
    def test_debug_requires_auth_when_enabled(self):
        """Debug endpoints should require API key when auth is enabled."""
        import os
        os.environ["API_KEY"] = "test-secret-key"
        
        from api.server import create_app
        app = create_app()
        client = TestClient(app)
        
        # Debug config without key should fail
        response = client.get("/api/v1/debug/config")
        assert response.status_code == 401
        
        # With correct key should work
        response = client.get("/api/v1/debug/config", headers={"X-API-Key": "test-secret-key"})
        assert response.status_code == 200
        
        # Clean up
        del os.environ["API_KEY"]


class TestDetectFacesEndpoint:
    """Tests for /api/v1/debug/detect-faces endpoint."""
    
    @pytest.fixture
    def client(self):
        from api.server import create_app
        app = create_app()
        return TestClient(app)
    
    def test_detect_faces_missing_image_returns_404(self, client):
        """Should return 404 for non-existent image."""
        response = client.post("/api/v1/debug/detect-faces", json={
            "imagePath": "/nonexistent/path/image.jpg"
        })
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
