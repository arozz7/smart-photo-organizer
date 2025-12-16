# Smart Photo Organizer - Design Specification

## 1. Overview
A modern, local-first desktop application for managing large photo libraries. It emphasizes privacy (local AI), performance (virtualized lists, SQLite), and ease of use.

## 2. Navigation Structure
The application will use a persistent sidebar navigation:
- **Library** (All Photos)
- **People** (Face Recognition)
- **Albums / Tags** (Coming later, but UI placeholder)
- **Settings**

## 3. Detailed Page Specs

### 3.1 Library (Dashboard)
**Goal**: Browse entire collection efficiently.
- **Layout**: 
    - Top Bar: Search input, Sort options (Date, Name), Filter (Date Range).
    - Main Area: Virtualized Grid of thumbnails. 
        - Default Grouping: Month/Year.
        - **Flexible Grouping**: By Folder/Drive Location, By Date.
- **Interactions**:
    - Scroll: Infinite/Virtualized.
    - Click: Opens **Photo Detail View**.
    - Right-Click: Context menu (Add Tag, Reveal in Explorer, Delete).
- **Empty State**: 
    - "No photos found. Configure a folder to start scanning." -> Link to Settings.

### 3.2 Photo Detail View
**Goal**: View high-quality image and metadata.
- **Layout**:
    - **Center**: Large image canvas. Zoom/Pan support.
    - **Left/Right Arrows**: Navigation to next/prev photo.
    - **Right Panel (Collapsible)**:
        - **Info**: Date, Resolution, Camera Model, ISO, Aperture (EXIF).
        - **Tags**: Chip list of AI tags and User tags. Input to add new.
        - **Faces**: Cropped thumbnails of detected faces. 
            - If named: "Jane Doe". 
            - If unknown: "Unknown" with "Add Name" input.
- **Interactions**:
    - `Esc`: Close view.
    - `Removing`: Remove from Library Database ONLY. **Original files are Read-Only and never deleted from disk.**

### 3.3 People View
**Goal**: Organize photos by people.
- **Layout**:
    - **Tabs**: "Identified People" | "Unnamed Faces".
    - **Identified Grid**:
        - Card for each person: Cover photo (face crop), Name, Count of photos.
        - Click -> Opens "Person Detail" (Grid of photos containing this person).
    - **Unnamed Grid**:
        - Grid of face crops.
        - Grouping: "Likely Same Person" (Clustering) - *Advanced feature*.
        - Action: Input name. Auto-complete existing names.

### 3.4 Settings
**Goal**: App configuration.
- **Library Locations**:
    - List of watched folders.
    - Actions: 
        - "Add Folder": Browse to add new source.
        - "Update Location": Relink a folder if drive letter changes (e.g. `D:\` -> `E:\`).
        - "Remove": Stop watching (keeps photos in DB or removes them? - likely remove from DB).
        - "Rescan Now": Force full scan.
- **Database**:
    - Stats (Total Photos, Total Faces).
    - "Clear AI Data", "Reset Database".
- **Preferences**:
    - Theme (Dark/Light/System).
    - Auto-scan on startup (Toggle).

## 4. User Flows

### Flow: Onboarding / First Run
1. App launches.
2. User is greeted with "Welcome to Smart Photo Organizer".
3. "Choose a folder to scan" prompt.
4. User selects `D:\Photos`.
5. App begins background scan.
6. User is redirected to **Library** where photos start appearing in real-time.
7. Toast/Banner: "Scanning... 150/1000 processed."

### Flow: Naming a Face
1. User goes to **People** > **Unnamed**.
2. Sees a face of "Cousin Bob".
3. Clicks "Add Name".
4. Types "Bob".
5. App creates Person record "Bob".
6. Face moves to **Identified**.
7. Background process checks other descriptors for matches with "Bob".

### Flow: Search
1. User types "Beach" in global search.
2. App queries `tags` and `photos` (FTS potentially).
3. Grid filters to show photos with "Beach" tag (AI or User).

## 5. Visual Guidelines
- **Theme**: Dark mode by default for photo viewing (makes photos pop).
- **Accent Color**: Indigo/Violet for primary actions.
- **Typography**: Inter (Clean, modern sans-serif).
- **Components**: 
    - Glassmorphic panels for overlays.
    - Smooth transitions for hover states.
