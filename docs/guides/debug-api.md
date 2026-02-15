# Debug API Documentation

Debug API for Smart Photo Organizer face detection troubleshooting.

## Quick Start

```powershell
# Start backend in HTTP mode
$env:API_MODE = "http"
python src/python/main.py

# API available at http://localhost:3001
# Swagger docs at http://localhost:3001/docs
```

## Endpoints

### Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/health` | GET | Check backend health, models, GPU |
| `/api/v1/status` | GET | Get current status (idle/scanning) |

### Debug

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/debug/detect-faces` | POST | Run face detection on image |
| `/api/v1/debug/vlm-verify` | POST | Run VLM verification on region |
| `/api/v1/debug/config` | GET | View current AI config |
| `/api/v1/debug/config` | POST | Hot-reload config changes |
| `/api/v1/debug/nms-analysis` | POST | Analyze NMS merging behavior |

## Examples

### Check Health
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/health"
```

### Detect Faces
```powershell
$body = @{ imagePath = "C:/path/to/image.jpg" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/debug/detect-faces" -Method POST -Body $body -ContentType "application/json"
```

### Hot-Reload Detection Threshold
```powershell
$body = @{ detection = @{ threshold = 0.45 } } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/debug/config" -Method POST -Body $body -ContentType "application/json"
```

## Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `API_MODE` | `ipc` | Set to `http` for REST mode |
| `API_PORT` | `3001` | Server port |
| `API_HOST` | `127.0.0.1` | Bind address |
| `API_KEY` | (none) | Optional API key for auth |

## Authentication

Disabled by default. To enable:
```powershell
$env:API_KEY = "your-secret-key"
```

Then include in requests:
```powershell
-Headers @{ "X-API-Key" = "your-secret-key" }
```
