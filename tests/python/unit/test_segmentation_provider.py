"""
Unit tests for the SegmentationProvider ABC.

Verifies interface enforcement and contract compliance.
No AI models are loaded during these tests.
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_full_mock():
    """Return a fully-compliant mock provider class (not an instance)."""
    from facelib.segmentation_provider import SegmentationProvider

    class FullMockProvider(SegmentationProvider):
        def initialize(self) -> None:
            pass

        def set_image(self, image_path: str) -> str:
            return "test-session"

        def get_session_image(self, session_id: str):
            return None

        def predict_from_points(self, session_id, points, labels):
            return {"masks": []}

        def predict_from_box(self, session_id, box):
            return {"masks": []}

        def predict_from_text(self, session_id, text):
            return {"masks": []}

        def get_capabilities(self):
            return {
                "provider": "mock",
                "model_ready": True,
                "text_prompts": True,
                "video": False,
            }

        def cleanup(self) -> None:
            pass

    return FullMockProvider


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSegmentationProviderABC:
    """ABC enforcement and interface-contract tests."""

    def test_abc_cannot_be_instantiated_directly(self):
        """Instantiating the abstract class directly must raise TypeError."""
        from facelib.segmentation_provider import SegmentationProvider

        with pytest.raises(TypeError):
            SegmentationProvider()  # type: ignore[abstract]

    def test_incomplete_subclass_cannot_be_instantiated(self):
        """A subclass that omits abstract methods must raise TypeError."""
        from facelib.segmentation_provider import SegmentationProvider

        class PartialProvider(SegmentationProvider):
            def initialize(self) -> None:
                pass
            # All other abstract methods intentionally omitted

        with pytest.raises(TypeError):
            PartialProvider()  # type: ignore[abstract]

    def test_complete_subclass_can_be_instantiated(self):
        """A fully-implemented subclass must instantiate without error."""
        FullMock = _make_full_mock()
        provider = FullMock()
        from facelib.segmentation_provider import SegmentationProvider
        assert isinstance(provider, SegmentationProvider)

    def test_capabilities_schema_has_required_keys(self):
        """get_capabilities() must return a dict with the four required keys."""
        FullMock = _make_full_mock()
        provider = FullMock()
        caps = provider.get_capabilities()

        assert "provider" in caps, "Missing 'provider' key"
        assert "model_ready" in caps, "Missing 'model_ready' key"
        assert "text_prompts" in caps, "Missing 'text_prompts' key"
        assert "video" in caps, "Missing 'video' key"
