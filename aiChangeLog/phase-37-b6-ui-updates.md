# Phase 37: UI Updates (Suggestion & Discovery Buckets)

**Version:** v0.5.5
**Status:** ✅ Complete
**Date:** 2026-01-11

## 📝 Summary
This phase introduced the frontend interface for the Background Auto Face Bucketing system. It exposes the pre-calculated face buckets ("Suggestions" and "Discoveries") created by the background service, allowing users to process thousands of faces efficiently without the heavy clustering load on the client side.

## ✨ New Features

### 1. Suggestion Buckets Tab
- **Purpose:** Displays faces that the Background Service has confident matches for (but below the auto-assign threshold).
- **Organization:** Grouped by the *Suggested Person* (e.g., "Suggested: Mom").
- **Actions:**
  - **Confirm Group:** Assigns all faces in the bucket to the suggested person.
  - **Individual Selection:** Select specific faces to confirm or name to someone else.
  - **Reject/Ungroup:** Dissolves the bucket, returning faces to the "Unnamed" pool.

### 2. Discovery Buckets Tab
- **Purpose:** Displays high-quality clusters of unknown people found by DBSCAN in the background.
- **Actions:**
  - **Name Group:** Create a new person or assign to an existing one.
  - **Ignore Group:** Hide the cluster from view.
  - **Partial Naming:** Select specific faces within a cluster to name individually.

### 3. Ignored Face Re-check
- **UI:** Added "Re-check Ignored Faces" button to the Unnamed Faces toolbar.
- **Functionality:** Triggers a background pass to re-scan ignored faces against currently named people.
- **Results:** Recovered faces appear in a dedicated "Recovered Faces" modal for review.

## 🛠️ Technical Improvements

### Optimistic UI & Bucket Management
- Implemented `useBuckets` hook for efficient fetching and optimistic state updates.
- **Partial Bucket Updates:** Fixed logic to ensure that confirming/naming only *some* faces in a group correctly unlinks those faces from the bucket while leaving the rest.
- **Bucket Cleanup:** Patched `FaceRepository` to ensure `bucket_id` is cleared (`NULL`) whenever a face is assigned to a person, preventing "zombie" bucket members.

### Refactoring & Stability
- **Group Action Standardization:** Enabled individual `handleOpenNaming` logic for Suggestion/Discovery tabs, fixing the limitation where users could only act on the entire group.
- **Background Service Fixes:** Resolved infinite loops and "0/0" progress reporting in `BackgroundBucketingService`.

## 🧪 Testing
- Verified full loop: Scan -> Background Bucketing -> UI Display -> User Confirmation -> Database Update.
- Validated partial confirmation logic by selecting specific faces in a Suggestion group.
- Tested "Re-check Ignored" flow with mock ignored faces.
