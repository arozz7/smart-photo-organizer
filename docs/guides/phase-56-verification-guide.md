# Phase 56: How to Verify Background VLM Verification is Running

## Quick Status Check

### Option 1: Check in Settings UI
1. Open the app
2. Go to **Settings** → **Maintenance** tab
3. Look at the **Face Verification** section
4. You'll see:
   - **Pending Verifications** count (updates every 5 seconds)
   - If the count is **0** and shows **green**, there are no suspect faces to verify
   - If the count is **> 0** and shows **amber**, the service is processing them

### Option 2: Check Logs
The service logs every ~30 seconds. Look for these messages in your logs:

**When service starts:**
```
[BackgroundVerificationService] Starting...
```

**When no suspect faces exist:**
```
[BackgroundVerificationService] No suspect faces to verify (total pending: 0)
```

**When processing faces:**
```
[BackgroundVerificationService] Processing 10 suspect faces (15 total pending)
[BackgroundVerificationService] Face 12345 verified as human (confidence: 0.85)
[BackgroundVerificationService] Face 12346 rejected as non-face (reason: appears to be a knee)
```

### Option 3: Run SQL Diagnostics
Use the diagnostic queries in `docs/phase-56-diagnostics.sql`:

```sql
-- Quick status check
SELECT 
    entity_type,
    COUNT(*) as count
FROM faces
WHERE is_ignored = 0 OR is_ignored IS NULL
GROUP BY entity_type;
```

Expected results:
- `human` - Normal verified faces
- `suspect` - Faces pending VLM verification
- `NULL` - Older faces from before Phase 56

### Option 4: Developer Console
Open DevTools console and run:
```javascript
window.ipcRenderer.invoke('face:getVerificationStatus').then(console.log)
```

You'll see:
```json
{
  "success": true,
  "pending": 0,
  "isRunning": true
}
```

## How to Create Suspect Faces for Testing

If you want to test the service, you have two options:

### Option 1: Trigger Manual Audit
1. Go to **Settings** → **Maintenance**
2. Click **"Audit Low Confidence Faces"** button
3. This will mark all existing faces with detection score < 0.45 as 'suspect'
4. Watch the logs to see them being processed

### Option 2: Scan Photos with TTA Enabled
1. Enable **TTA (Rotation Augmentation)** in Settings → Advanced Face
2. Scan some photos (especially group photos or photos with complex backgrounds)
3. Low-confidence detections (score < 0.45) will automatically be marked as 'suspect'
4. The background service will verify them asynchronously

## Troubleshooting

### Service Not Running?
Check the main log for startup errors:
```
[ServiceManager] Starting BackgroundVerificationService...
[BackgroundVerificationService] Starting...
```

### No Suspect Faces?
This is normal! It means:
1. All your faces have high confidence scores (> 0.45)
2. OR you haven't scanned with TTA enabled yet
3. OR all suspect faces have already been verified

### Service Paused?
The service automatically pauses when:
- Active scanning is in progress (to avoid resource conflicts)
- You'll see: `[BackgroundVerificationService] No suspect faces to verify (total pending: X)`

## Performance Notes

- **Batch Size**: 10 faces per iteration
- **Sleep Interval**: 5 seconds between batches
- **VLM Speed**: ~2-5 seconds per face (depends on GPU)
- **Expected Throughput**: ~120-300 faces per hour

## What Happens to Verified Faces?

**Promoted (is_face = true):**
- `entity_type` changes from `'suspect'` → `'human'`
- Face becomes visible in UI
- Can be assigned to people normally

**Rejected (is_face = false):**
- `is_ignored` set to `1`
- Face is hidden from UI
- Will not appear in clustering or assignment

**Failed Verification (VLM error):**
- `verification_attempts` incremented
- After 3 failed attempts → auto-ignored
- Prevents infinite retry loops
