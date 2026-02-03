# Phase 60: FAISS IVF Migration

## 🎯 Goal
Ensure the application scales to 500,000+ faces while maintaining sub-100ms vector search times.

## 🛠️ The Changes
### 1. Hybrid Index Strategy
Implemented in `facelib/vector_store.py`:
- **Small Library (< 2,000 faces):** Uses `IndexFlatL2` (Exact Search). This is optimal for small datasets where clustering overhead exceeds the benefit.
- **Large Library (>= 2,000 faces):** Automatically switches to `IndexIVFFlat` (Inverted File Index).
    - **Training:** The index is trained on the current dataset.
    - **Clusters (nlist):** Dynamically calculated as `4 * sqrt(N)`, clamped between 32 and 4096.

### 2. Benefits
- **Speed:** `IndexIVFFlat` searches only a subset of clusters, drastically reducing computation for large N.
- **Scalability:** The system can now handle hundreds of thousands of faces without freezing the UI during searches.

## ⚠️ Notes
- The index type switch happens automatically during `rebuild_index`.
- Ensure to run "Rebuild Face Index" if your library is already large to trigger the migration.
