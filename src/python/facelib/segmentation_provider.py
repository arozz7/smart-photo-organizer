"""
Abstract base class defining the segmentation provider interface.

All concrete providers (SAM 3, future models) must implement this interface,
ensuring the app can swap segmentation backends without touching route code.
"""

from abc import ABC, abstractmethod
from typing import Any


class SegmentationProvider(ABC):
    """Model-agnostic interface for image segmentation providers."""

    @abstractmethod
    def initialize(self) -> None:
        """Load model weights and warm up the model. Called lazily on first use."""

    @abstractmethod
    def set_image(self, image_path: str) -> str:
        """
        Load an image and cache it for subsequent predictions.

        Args:
            image_path: Absolute path to the image file.

        Returns:
            session_id: Opaque string identifying this image session.

        Raises:
            FileNotFoundError: If the image does not exist.
        """

    @abstractmethod
    def get_session_image(self, session_id: str) -> Any:
        """
        Retrieve the cached PIL Image for a session.

        Args:
            session_id: Session identifier returned by set_image.

        Returns:
            PIL.Image.Image object for the session.

        Raises:
            KeyError: If session_id is not found.
        """

    @abstractmethod
    def predict_from_points(
        self,
        session_id: str,
        points: list[list[int]],
        labels: list[int],
    ) -> dict[str, Any]:
        """
        Segment using click-point prompts (SAM2-like interface).

        Args:
            session_id: Session from set_image.
            points: List of [x, y] pixel coordinates.
            labels: Per-point labels — 1 = positive (include), 0 = negative (exclude).

        Returns:
            Dict with 'masks' list; each entry has 'mask_b64' (base64 PNG),
            'score' (float 0–1), 'area' (int pixel count).

        Raises:
            KeyError: If session_id is not found.
        """

    @abstractmethod
    def predict_from_box(
        self,
        session_id: str,
        box: list[int],
    ) -> dict[str, Any]:
        """
        Segment using a bounding-box prompt.

        Args:
            session_id: Session from set_image.
            box: [x1, y1, x2, y2] in pixel coordinates.

        Returns:
            Dict with 'masks' list; each entry has 'mask_b64', 'score', 'area'.

        Raises:
            KeyError: If session_id is not found.
        """

    @abstractmethod
    def predict_from_text(
        self,
        session_id: str,
        text: str,
    ) -> dict[str, Any]:
        """
        Segment using a natural-language text prompt (SAM 3 native feature).

        Args:
            session_id: Session from set_image.
            text: Description of the subject to segment (e.g. "person", "cat").

        Returns:
            Dict with 'masks' list; each entry has 'mask_b64', 'score', 'area'.

        Raises:
            KeyError: If session_id is not found.
        """

    @abstractmethod
    def get_capabilities(self) -> dict[str, Any]:
        """
        Describe what this provider supports.

        Returns:
            Dict with at minimum:
              - 'provider'    (str)  — model name
              - 'model_ready' (bool) — whether the checkpoint is present
              - 'text_prompts'(bool) — whether text-based segmentation is supported
              - 'video'       (bool) — whether video tracking is supported
        """

    @abstractmethod
    def cleanup(self) -> None:
        """Release model weights and clear the session cache."""
