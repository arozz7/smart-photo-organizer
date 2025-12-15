# Logic Examples & Flows

This document details the specific internal logic for key workflows.

## 1. Scanner Loop (Simplified)

The scanner is responsible for ingesting files. It handles failures gracefully (e.g. corrupt RAW files) and ensures the UI always has a preview to show.

### Flow Chart

```mermaid
graph TD
    Start(Start Scan) --> ReadDir{Read Directory}
    ReadDir --> |File| CheckExt{Supported Ext?}
    ReadDir --> |Dir| Recurse[Recursive Call]
    
    CheckExt -- No --> Skip
    CheckExt -- Yes --> DBCheck{In DB?}
    
    DBCheck -- Yes --> UpdateCheck{Needs Update?}
    DBCheck -- No --> NewFile[Process New File]
    
    NewFile --> Exif[Extract Metadata (ExifTool)]
    NewFile --> Preview{Gen Preview}
    
    Preview --> |RAW| TryExif[Try ExifTool Extraction]
    TryExif -- Fail --> TrySharp[Try Sharp Conversion]
    
    TrySharp --> SavePreview[Save .jpg to Cache]
    SavePreview --> InsertDB[INSERT INTO photos]
```

### Logic Snippet (TypeScript)

```typescript
// electron/scanner.ts (Concept)

for (const entry of entries) {
    if (isSupported(entry)) {
        // 1. Check DB
        const existing = db.getPhoto(entry.path);
        
        // 2. Generate Preview if needed
        let previewPath = existing?.preview_path;
        if (!previewPath || needsRetry) {
             previewPath = await extractPreview(entry.path);
        }
        
        // 3. Insert/Update
        if (!existing) {
             db.insertPhoto({
                 path: entry.path,
                 preview: previewPath,
                 metadata: await getMetadata(entry.path)
             });
        }
    }
}
```

## 2. Face Assignment & Learning

The system "learns" who people are by calculating a mean descriptor vector. As you add more faces to a person, the mean becomes more accurate.

### The "Mean" Strategy
Instead of comparing a new face to *every* face in the database (O(N*M)), we compare it to the *Mean Vector* of each Person (O(P)).

### Logic Flow

1.  **User Action:** User types "Alice" for a face.
2.  **DB Transaction:**
    *   Find/Create Person "Alice" (ID: 101).
    *   Update `faces` table: Set `person_id = 101` for the selected face.
3.  **Recalculate Mean:**
    *   Fetch ALL face descriptors for Person 101.
    *   Calculate average vector: $V_{mean} = \frac{\sum V_i}{count}$.
    *   Update `people` table with new `descriptor_mean`.
4.  **Auto-Matching (Next Scan):**
    *   When a new face $V_{new}$ is detected:
    *   Calculate distance $d = CosineDist(V_{new}, V_{mean})$.
    *   If $d < Threshold$ (0.4), auto-assign to "Alice".

### Logic Snippet (SQL/TS)

```typescript
// electron/main.ts (Concept)

function assignPerson(faceId, personName) {
    db.transaction(() => {
        // 1. Create/Get Person
        const person = db.getPerson(personName) || db.createPerson(personName);
        
        // 2. Link Face
        db.run('UPDATE faces SET person_id = ? WHERE id = ?', person.id, faceId);
        
        // 3. Update Mean
        const allFaces = db.getAllFacesForPerson(person.id);
        const meanVector = calculateMean(allFaces.map(f => f.descriptor));
        
        db.run('UPDATE people SET descriptor_mean_json = ? WHERE id = ?', 
            JSON.stringify(meanVector), person.id);
    });
}
```
