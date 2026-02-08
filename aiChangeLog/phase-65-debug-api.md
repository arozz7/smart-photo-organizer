# Phase 65: Debug API Implementation

## Summary
Implemented Debug API REST layer for face detection troubleshooting, with foundation for External Agent API.

## Changes Made

### New Files
| File | Description |
|------|-------------|
| `src/python/api/__init__.py` | API module initialization |
| `src/python/api/server.py` | FastAPI server with dual-mode startup |
| `src/python/api/routes/debug.py` | Debug endpoints for face detection |
| `src/python/api/routes/status.py` | Health and status endpoints |
| `src/python/api/middleware/auth.py` | Optional API key authentication |
| `docs/debug-api-plan.md` | Implementation plan documentation |

### Modified Files
| File | Change |
|------|--------|
| `src/python/main.py` | Added dual-mode startup (HTTP or IPC based on `API_MODE` env var) |
| `src/python/requirements.txt` | Added `fastapi>=0.109.0` and `uvicorn[standard]>=0.27.0` |

## New API Endpoints

### Debug Endpoints (`/api/v1/debug/`)
- `POST /detect-faces` - Raw detector output with NMS results
- `POST /vlm-verify` - VLM semantic verification on a region
- `GET /config` - View current AI configuration
- `POST /config` - Hot-reload config changes without restart
- `POST /nms-analysis` - NMS before/after breakdown

### Production Endpoints (`/api/v1/`)
- `GET /status` - Backend status (idle/scanning/queue depth)
- `GET /health` - Health check (models loaded, GPU status, memory)

## Usage

### Start in HTTP Mode
```powershell
$env:API_MODE = "http"
python src/python/main.py
```

### Test Endpoints
```powershell
# Health check
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/health"

# View config
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/debug/config"

# Hot-reload threshold
$body = @{ detection = @{ threshold = 0.45 } } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/debug/config" -Method POST -Body $body -ContentType "application/json"
```

### OpenAPI Docs
Visit `http://localhost:3001/docs` for interactive Swagger UI.

## Notes
- Default binding: `127.0.0.1:3001` (localhost only)
- API key auth disabled by default for local development
- Existing IPC mode (stdin/stdout) unchanged - remains default

---

## Phase 4 & 5 Additions

### TypeScript Integration
| File | Change |
|------|--------|
| `electron/infrastructure/PythonAIProvider.ts` | Added `checkStandaloneBackend()`, `sendHttpRequest()`, and HTTP fallback in `sendRequest()` |

### Tests & Documentation
| File | Description |
|------|-------------|
| `tests/python/unit/test_api.py` | Unit tests for health, status, config, and auth endpoints |
| `docs/debug-api.md` | User documentation with examples |
