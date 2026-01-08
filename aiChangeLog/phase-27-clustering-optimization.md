# Phase 27: Clustering Optimization & Debug Tools

## 🎯 Goals
- Address incorrect clustering behavior where high-similarity faces were being split.
- Improve performance of "Background Face Detection" for large libraries.
- Provide transparent debug tools to diagnose AI decision making.
- Enhance "Group by AI Suggestion" reliability.

## ✅ Completed Features

### 1. Critical Clustering Fix
- **Metric Mismatch Resolved**: Identified that the backend was using **Euclidean Distance** with thresholds intended for **Cosine Distance**.
- **Fix**: Implemented automatic threshold conversion (`eps_euclidean = sqrt(2 * eps_cosine)`).
- **Result**: Faces with 85% similarity (Distance 0.15) now correctly group together with a 0.5 threshold (previously rejected).

### 2. Performance Optimization
- **Background Detection**: Refactored the `detect_background_faces` algorithm from `O(N*C)` to `O(N)`.
- **Speedup**: Processing 30,000 faces reduced from ~23 seconds to **< 1 second**.
- **Timeouts**: Increased IPC timeouts for batch operations to prevent "Promise Timeout" errors on large datasets.

### 3. Face Debug Modal
- **New Tool**: Accessible via "Debug" button in People view (Dev Mode).
- **Features**:
    - **Pairwise Analysis**: Detailed view of Similarity % and Distance between selected faces.
    - **DBSCAN Debug**: Visual explanation of why faces formed a cluster (or didn't).
    - **Named Person Check**: On-demand check to see if selected faces match any existing person in the database.

### 4. Background Filter Improvements
- **New Filters**:
    - **Single Photo Only**: Strictly filter faces appearing in only 1 photo.
    - **Max Cluster Size**: Filter small clusters (size ≤ N).
    - **Min Distance**: Filter widely dispersed clusters.
- **Backend Count**: Fixed logic to correctly count distinct photo appearances per cluster.

### 5. Group by AI Suggestion
- **Backend Logic**: Moved grouping logic from Frontend to Backend (`aiHandlers.ts`).
- **Real-time Matching**: Centroids of clusters are matched against the Vector DB in real-time.
- **Sorting**: Suggested groups are prioritized at the top of the list.

## 🧪 Verification
- **Test Case**: Verified 4-face cluster split issue is resolved.
- **Performance**: Verified UI responsiveness with 10k+ faces.
- **Stability**: Verified no "UnboundLocalError" in Python backend.
