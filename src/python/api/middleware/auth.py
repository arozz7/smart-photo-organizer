"""
API Key Authentication Middleware.

Provides optional API key authentication for the Debug API.
Disabled by default for local development.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """Middleware to validate API key in request headers."""
    
    def __init__(self, app, api_key: str):
        super().__init__(app)
        self.api_key = api_key
    
    async def dispatch(self, request: Request, call_next):
        # Skip auth for docs and health endpoints
        if request.url.path in ["/docs", "/redoc", "/openapi.json", "/api/v1/health"]:
            return await call_next(request)
        
        # Check API key header
        provided_key = request.headers.get("X-API-Key")
        
        if not provided_key:
            return JSONResponse(
                status_code=401,
                content={"error": "Missing API key", "detail": "Provide X-API-Key header"}
            )
        
        if provided_key != self.api_key:
            return JSONResponse(
                status_code=403,
                content={"error": "Invalid API key"}
            )
        
        return await call_next(request)
