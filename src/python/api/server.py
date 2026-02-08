"""
FastAPI Server for Smart Photo Organizer Debug API.

This module provides a REST API layer for debugging face detection/recognition
and serves as the foundation for the External Agent API.

Usage:
    # Standalone mode (HTTP server)
    API_MODE=http python main.py
    
    # Embedded mode (stdin IPC - default)
    python main.py
"""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import debug, status
from .middleware.auth import ApiKeyMiddleware

logger = logging.getLogger("smart-photo-ai")

# Configuration defaults
DEFAULT_PORT = 3001
DEFAULT_HOST = "127.0.0.1"  # Localhost-only by default for security


def get_api_config():
    """Load API configuration from environment or config file."""
    return {
        "port": int(os.environ.get("API_PORT", DEFAULT_PORT)),
        "host": os.environ.get("API_HOST", DEFAULT_HOST),
        "api_key": os.environ.get("API_KEY", None),  # Disabled by default
        "allowed_origins": os.environ.get("API_ORIGINS", "http://localhost:5173").split(","),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events for the FastAPI app."""
    logger.info("[API] Debug API server starting...")
    yield
    logger.info("[API] Debug API server shutting down...")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    config = get_api_config()
    
    app = FastAPI(
        title="Smart Photo Organizer Debug API",
        description="REST API for debugging face detection/recognition and library management.",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    
    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config["allowed_origins"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # API Key authentication (if configured)
    if config["api_key"]:
        app.add_middleware(ApiKeyMiddleware, api_key=config["api_key"])
        logger.info("[API] API key authentication enabled")
    else:
        logger.info("[API] API key authentication disabled (local development mode)")
    
    # Register routes
    app.include_router(debug.router, prefix="/api/v1/debug", tags=["Debug"])
    app.include_router(status.router, prefix="/api/v1", tags=["Status"])
    
    return app


def start_http_server():
    """Start the HTTP server (called when API_MODE=http)."""
    import uvicorn
    
    config = get_api_config()
    app = create_app()
    
    logger.info(f"[API] Starting HTTP server on {config['host']}:{config['port']}")
    uvicorn.run(
        app,
        host=config["host"],
        port=config["port"],
        log_level="info",
    )
