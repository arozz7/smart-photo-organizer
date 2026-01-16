# Release Notes: v0.5.0 to v0.5.5

## 🌟 Highlights

This release cycle (v0.5.0 → v0.5.5) focuses on **Scalability and Background Intelligence**. We've moved heavy lifting from the frontend to background services, introduced "Human vs Pet" classification, and streamlined the workflow for managing large photo libraries.

---

## 🚀 Key Features

### 1. Background Auto Face Bucketing (The "Always-On" Organizer)
*Previously, clustering only happened when you opened the page. Now, it runs silently in the background.*
- **Suggestion Buckets:** The system automatically groups new faces that match existing people. You just click "Confirm" or "Reject".
- **Discovery Buckets:** Finds new, unknown people in your library and groups them for easy naming.
- **Smart Scheduling:** The background service detects when you are active and pauses immediately to prevent lag.
- **Merge by Person:** Automatically combines multiple suggestion buckets for the same person, reducing manual review time.

### 2. Smart Face Management
- **Background Face Filter:** Automatically identifies and ignores "noise" faces (strangers in the background, blurs) based on customizable thresholds.
- **Confidence Tiering:** New matches are classified as **High Confidence** (auto-assign) or **Review Needed** (manual confirmation).
- **Misassigned Face Detection:** Detects faces that statistically don't look like the person they are assigned to (Outliers) and flags them for review.
- **Unified Naming:** A single, consistent "Name Person" input with autocomplete and AI suggestions across all views.

### 3. Classification & Organization
- **Human vs. Pet Classification:** 
  - Distinct `entity_type` (Person vs Pet).
  - Pets have their own matching logic (Pets only match Pets).
  - UI badges to easily distinguish profiles.
- **Photo Session Grouping:** Unassigned faces are now grouped by "Session" (Time & Folder), making it easier to name people from specific events (e.g., "Christmas Party 2025").

### 4. Frontend Streamlining (v0.5.5 Polish)
- **Live Counts:** "Unnamed Faces" badges update in real-time during scans.
- **Performance:** Enforced 150-face limit on cluster views to keep the UI buttery smooth even with huge groups.
- **Move Modal Fixed:** Stabilized the "Move Faces" tool and removed distracting AI suggestions.
- **Activity Summary:** Fixed the "Items this Session" counter to accurately track your session throughput.

### 5. Stability & Architecture
- **Graceful Shutdown:** Fixed issue where closing the app during AI processing caused errors.
- **Era-Aware Matching:** Improved recognition accuracy for people who age significantly by using "Era" driven centroids.
- **Refactoring:** Major code cleanup in `FaceAnalysisService` for better maintainability.

---

## 📊 Stats & Metrics
- **Performance:** Background clustering is ~20x faster than previous frontend-based clustering.
- **Reliability:** Comprehensive test backfill added for all core services.
