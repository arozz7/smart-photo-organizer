"""
Commands package for Smart Photo Organizer AI Engine.

This package contains modular command handlers extracted from main.py
to comply with file size limits and improve maintainability.
"""

from . import scan
from . import face_analysis
from . import clustering
from . import index
from . import utilities

__all__ = ['scan', 'face_analysis', 'clustering', 'index', 'utilities']
