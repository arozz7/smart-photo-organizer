-- Phase 56: VLM Verification Diagnostics
-- Run this in your database to check the status of face verification

-- 1. Count faces by entity_type
SELECT 
    entity_type,
    COUNT(*) as count,
    ROUND(AVG(score), 3) as avg_score
FROM faces
WHERE is_ignored = 0 OR is_ignored IS NULL
GROUP BY entity_type
ORDER BY count DESC;

-- 2. Show suspect faces pending verification
SELECT 
    f.id,
    f.photo_id,
    f.score,
    f.verification_attempts,
    p.file_path,
    p.created_at as photo_date
FROM faces f
JOIN photos p ON f.photo_id = p.id
WHERE f.entity_type = 'suspect'
  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
ORDER BY p.created_at DESC
LIMIT 20;

-- 3. Show recently verified faces (promoted from suspect to human)
SELECT 
    f.id,
    f.photo_id,
    f.score,
    f.entity_type,
    p.file_path
FROM faces f
JOIN photos p ON f.photo_id = p.id
WHERE f.score < 0.45
  AND f.entity_type = 'human'
  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
ORDER BY f.id DESC
LIMIT 20;

-- 4. Show rejected faces (marked as non-human by VLM)
SELECT 
    f.id,
    f.photo_id,
    f.score,
    f.verification_attempts,
    p.file_path
FROM faces f
JOIN photos p ON f.photo_id = p.id
WHERE f.score < 0.45
  AND f.is_ignored = 1
ORDER BY f.id DESC
LIMIT 20;

-- 5. Summary statistics
SELECT 
    'Total Faces' as metric,
    COUNT(*) as value
FROM faces
WHERE is_ignored = 0 OR is_ignored IS NULL
UNION ALL
SELECT 
    'Suspect Faces (Pending)',
    COUNT(*)
FROM faces
WHERE entity_type = 'suspect'
  AND (is_ignored = 0 OR is_ignored IS NULL)
UNION ALL
SELECT 
    'Low Confidence Verified',
    COUNT(*)
FROM faces
WHERE score < 0.45
  AND entity_type = 'human'
  AND (is_ignored = 0 OR is_ignored IS NULL)
UNION ALL
SELECT 
    'Rejected by VLM',
    COUNT(*)
FROM faces
WHERE score < 0.45
  AND is_ignored = 1;
