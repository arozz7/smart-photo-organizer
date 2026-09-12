"""
Chooses the concrete SegmentationProvider implementation based on device.

Meta's official `sam3` package (Sam3PackageProvider) has a confirmed
device-handling bug: its text/exemplar (PCS) prompt path hardcodes a CUDA
reference somewhere in Meta's own code, independent of the device parameter
passed to build_sam3_image_model(). It works correctly on GPU, but raises
a device-mismatch error on CPU-only machines. The transformers-based
implementation (Sam3TransformersProvider) has no such bug and is the
fallback for machines without a CUDA GPU.

Both classes are ordinary drop-in SegmentationProvider implementations —
callers only need this factory, never the concrete classes directly.
"""

import logging
from typing import Any

from facelib.segmentation_provider import SegmentationProvider

logger = logging.getLogger("smart-photo-ai")


def create_segmentation_provider(cfg: dict[str, Any]) -> SegmentationProvider:
    """
    Build the appropriate SegmentationProvider for this machine.

    Args:
        cfg: The 'segmentation' section of ai-config.json (or its defaults).

    Returns:
        Sam3PackageProvider on a CUDA-capable machine (or when
        cfg['device'] == 'cuda'), Sam3TransformersProvider otherwise.
    """
    device_pref = cfg.get("device", "auto")
    max_sessions = cfg.get("max_cached_sessions", 5)

    use_gpu = device_pref == "cuda"
    if device_pref == "auto":
        try:
            import torch
            use_gpu = torch.cuda.is_available()
        except ImportError:
            use_gpu = False

    if use_gpu:
        from facelib.sam3_provider import Sam3PackageProvider

        logger.info("Segmentation: using Sam3PackageProvider (GPU)")
        return Sam3PackageProvider(
            model_checkpoint=cfg.get("model_checkpoint", "models/sam3.pt"),
            device="cuda",
            max_cached_sessions=max_sessions,
        )

    from facelib.sam3_provider_transformers import Sam3TransformersProvider

    logger.info("Segmentation: using Sam3TransformersProvider (CPU)")
    return Sam3TransformersProvider(
        model_checkpoint=cfg.get("model_checkpoint_cpu", "models/sam3_model.safetensors"),
        device="cpu",
        max_cached_sessions=max_sessions,
    )
