import React, { useState, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';

interface FaceDebugModalProps {
    isOpen: boolean;
    onClose: () => void;
    faceIds: number[];
}

interface Comparison {
    face1: number;
    face2: number;
    similarity: number;
    distance: number;
}

const FaceDebugModal: React.FC<FaceDebugModalProps> = ({ isOpen, onClose, faceIds }) => {
    const [loading, setLoading] = useState(false);
    const [comparisons, setComparisons] = useState<Comparison[]>([]);
    const [indexStatus, setIndexStatus] = useState<any>(null);
    const [clusterDebug, setClusterDebug] = useState<any>(null);
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [threshold, setThreshold] = useState(0.5);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    // Ref to prevent concurrent calls
    const isLoadingRef = useRef(false);

    // Stable key for face IDs to prevent re-fetching on reference change
    const faceIdsKey = [...faceIds].sort().join(',');

    useEffect(() => {
        if (isOpen && faceIds.length > 0 && !isLoadingRef.current) {
            loadData();
        }
    }, [isOpen, faceIdsKey]);

    const loadData = async () => {
        if (isLoadingRef.current) return;
        isLoadingRef.current = true;

        setLoading(true);
        setError(null);
        setSuggestions([]);
        setClusterDebug(null);

        try {
            // Get saved threshold first
            const saved = localStorage.getItem('regroupThreshold');
            if (saved) setThreshold(parseFloat(saved));

            // Get similarity comparisons (fast - local calculation in Electron)
            if (faceIds.length >= 2) {
                // @ts-ignore
                const compareResult = await window.ipcRenderer.invoke('ai:compareFaces', { faceIds });
                if (compareResult.success) {
                    setComparisons(compareResult.comparisons || []);
                }
            }

            // Skip index status on reload - it's slow and not essential
            // Only load it if we don't have it yet
            if (!indexStatus) {
                try {
                    // @ts-ignore
                    const statusResult = await window.ipcRenderer.invoke('ai:getIndexStatus');
                    if (statusResult.status) {
                        setIndexStatus(statusResult.status);
                    }
                } catch {
                    // Ignore index status errors
                }
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
            isLoadingRef.current = false;
        }
    };

    const [hasSearched, setHasSearched] = useState(false);

    // Separate function for loading suggestions - user clicks button
    const loadSuggestions = async () => {
        if (loadingSuggestions || faceIds.length === 0) return;

        setLoadingSuggestions(true);
        setHasSearched(false);
        try {
            const saved = localStorage.getItem('regroupThreshold');
            console.log('[FaceDebug] Checking suggestions for faces:', faceIds);

            // @ts-ignore
            const matchResult = await window.ipcRenderer.invoke('face:findPotentialMatches', {
                faceIds,
                threshold: parseFloat(saved || '0.5')
            });

            console.log('[FaceDebug] Match result:', matchResult);

            if (matchResult.success && matchResult.matches) {
                setSuggestions(matchResult.matches);
            }
            setHasSearched(true);
        } catch (matchError) {
            console.warn('[FaceDebug] Suggestion lookup failed:', matchError);
            setError('Suggestion lookup failed: ' + String(matchError));
        } finally {
            setLoadingSuggestions(false);
        }
    };

    const runDebugCluster = async () => {
        setLoading(true);
        setClusterDebug(null);
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('ai:debugCluster', { threshold });
            if (result.debug_info) {
                setClusterDebug(result.debug_info);
            } else if (result.error) {
                setError(result.error);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    const eps = 1 - threshold; // DBSCAN distance threshold

    // Find cluster membership for selected faces
    const getClusterForFace = (faceId: number): number | null => {
        if (!clusterDebug?.face_clusters) return null;
        const cluster = clusterDebug.face_clusters[faceId];
        return cluster === undefined ? null : cluster;
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] max-h-[80vh] bg-gray-900 border border-gray-700 p-6 rounded-xl shadow-xl z-50 overflow-y-auto">
                    <Dialog.Title className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                        🔬 Face Debug Info
                        <span className="text-xs bg-yellow-600/20 text-yellow-400 px-2 py-0.5 rounded">DEV ONLY</span>
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-gray-400 mb-4">
                        Analyzing {faceIds.length} selected face(s)
                    </Dialog.Description>

                    {loading && (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-900/20 border border-red-900/50 p-3 rounded text-red-300 text-sm mb-4">
                            {error}
                        </div>
                    )}

                    {!loading && !error && (
                        <div className="space-y-6">
                            {/* Current Settings */}
                            <div className="bg-gray-800/50 p-4 rounded-lg">
                                <h4 className="text-sm font-medium text-gray-300 mb-2">Current Settings</h4>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="text-gray-400">Similarity Threshold:</div>
                                    <div className="text-white font-mono">{threshold.toFixed(2)}</div>
                                    <div className="text-gray-400">DBSCAN eps (distance):</div>
                                    <div className="text-white font-mono">{eps.toFixed(2)}</div>
                                </div>
                            </div>

                            {/* Named Person Suggestions */}
                            {suggestions.length > 0 && (
                                <div className="bg-green-900/20 border border-green-900/30 p-4 rounded-lg">
                                    <h4 className="text-sm font-medium text-green-300 mb-2">🎯 Named Person Matches (Top 5 Closest)</h4>
                                    <div className="space-y-2">
                                        {suggestions
                                            .filter(s => s.match)
                                            .sort((a, b) => (b.match?.similarity || 0) - (a.match?.similarity || 0))
                                            .slice(0, 5)
                                            .map((s, i) => {
                                                const distance = 1 - (s.match?.similarity || 0);
                                                return (
                                                    <div key={i} className="flex items-center justify-between bg-gray-800/50 p-2 rounded text-sm">
                                                        <span className="font-mono text-gray-300">Face #{s.faceId}</span>
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-green-400 font-medium">
                                                                → {s.match?.personName || 'Unknown'}
                                                            </span>
                                                            <span className="text-xs font-mono">
                                                                <span className="text-gray-400">sim:</span>
                                                                <span className="text-green-400 ml-1">{((s.match?.similarity || 0) * 100).toFixed(1)}%</span>
                                                                <span className="text-gray-400 ml-2">dist:</span>
                                                                <span className={`ml-1 ${distance <= eps ? 'text-green-400' : 'text-red-400'}`}>
                                                                    {distance.toFixed(3)}
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                    <p className="text-xs text-green-200/60 mt-2">
                                        Top matches sorted by similarity. Distance ≤ {eps.toFixed(2)} (green) means within grouping threshold.
                                    </p>
                                </div>
                            )}

                            {suggestions.length === 0 && faceIds.length > 0 && (
                                <div className="bg-gray-800/30 border border-gray-700 p-3 rounded flex items-center justify-between">
                                    <span className="text-xs text-gray-400">
                                        Check if selected faces match named persons in your database
                                    </span>
                                    <button
                                        onClick={loadSuggestions}
                                        disabled={loadingSuggestions}
                                        className="px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 text-green-300 border border-green-600/30 rounded text-xs transition-colors disabled:opacity-50"
                                    >
                                        {loadingSuggestions ? 'Checking...' : 'Check Named Persons'}
                                    </button>
                                </div>
                            )}

                            {/* Pairwise Comparisons */}
                            {comparisons.length > 0 && (
                                <div>
                                    <h4 className="text-sm font-medium text-gray-300 mb-2">Pairwise Comparisons</h4>
                                    <div className="bg-gray-800/30 rounded-lg overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-800">
                                                <tr>
                                                    <th className="px-3 py-2 text-left text-gray-400">Face 1</th>
                                                    <th className="px-3 py-2 text-left text-gray-400">Face 2</th>
                                                    <th className="px-3 py-2 text-left text-gray-400">Similarity</th>
                                                    <th className="px-3 py-2 text-left text-gray-400">Distance</th>
                                                    <th className="px-3 py-2 text-left text-gray-400">Would Group?</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {comparisons.map((c, i) => {
                                                    const wouldGroup = c.distance <= eps;
                                                    return (
                                                        <tr key={i} className="border-t border-gray-800">
                                                            <td className="px-3 py-2 font-mono text-gray-300">#{c.face1}</td>
                                                            <td className="px-3 py-2 font-mono text-gray-300">#{c.face2}</td>
                                                            <td className="px-3 py-2">
                                                                <span className={`font-mono ${c.similarity >= threshold ? 'text-green-400' : 'text-yellow-400'}`}>
                                                                    {(c.similarity * 100).toFixed(1)}%
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <span className={`font-mono ${c.distance <= eps ? 'text-green-400' : 'text-red-400'}`}>
                                                                    {c.distance.toFixed(4)}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                {wouldGroup ? (
                                                                    <span className="text-green-400">✓ Yes</span>
                                                                ) : (
                                                                    <span className="text-red-400">✗ No (dist &gt; {eps.toFixed(2)})</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Analysis */}
                                    {comparisons.some(c => c.distance > eps) && (
                                        <div className="mt-3 bg-yellow-900/20 border border-yellow-900/50 p-3 rounded text-yellow-200 text-xs">
                                            <strong>⚠️ Why not grouped:</strong> Some face pairs have distance &gt; eps ({eps.toFixed(2)}).
                                            DBSCAN won't cluster them unless they're connected through other close faces.
                                            <br /><br />
                                            <strong>Try:</strong> Lower the similarity threshold (more loose grouping) or these may genuinely be different people to the AI.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* FAISS Index Status */}
                            {indexStatus && (
                                <div className="bg-gray-800/50 p-4 rounded-lg">
                                    <h4 className="text-sm font-medium text-gray-300 mb-2">FAISS Index Status</h4>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div className="text-gray-400">Index Loaded:</div>
                                        <div className={indexStatus.loaded ? 'text-green-400' : 'text-red-400'}>
                                            {indexStatus.loaded ? 'Yes' : 'No'}
                                        </div>
                                        <div className="text-gray-400">Indexed Vectors:</div>
                                        <div className="text-white font-mono">{indexStatus.total_vectors}</div>
                                        <div className="text-gray-400">ID Map Size:</div>
                                        <div className="text-white font-mono">{indexStatus.id_map_size}</div>
                                    </div>
                                </div>
                            )}

                            {/* Selected Face IDs */}
                            <div className="bg-gray-800/50 p-4 rounded-lg">
                                <h4 className="text-sm font-medium text-gray-300 mb-2">Selected Face IDs</h4>
                                <div className="font-mono text-xs text-gray-400 break-all">
                                    {faceIds.join(', ')}
                                </div>
                                {clusterDebug && (
                                    <div className="mt-2 pt-2 border-t border-gray-700">
                                        <span className="text-xs text-gray-400">Cluster Assignment: </span>
                                        {faceIds.map((id, i) => {
                                            const cluster = getClusterForFace(id);
                                            return (
                                                <span key={id} className="font-mono text-xs">
                                                    {i > 0 && ', '}
                                                    <span className={cluster === -1 ? 'text-red-400' : cluster === null ? 'text-gray-500' : 'text-green-400'}>
                                                        #{id}→{cluster === -1 ? 'Noise' : cluster === null ? '?' : `C${cluster}`}
                                                    </span>
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Debug Clustering Section */}
                            <div className="bg-yellow-900/20 border border-yellow-900/30 p-4 rounded-lg">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-sm font-medium text-yellow-300">🔬 Run Full Cluster Debug</h4>
                                    <button
                                        onClick={runDebugCluster}
                                        disabled={loading || loadingSuggestions}
                                        className="px-3 py-1.5 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-300 border border-yellow-600/30 rounded text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {loading ? 'Running...' : 'Run DBSCAN Debug'}
                                    </button>
                                </div>

                                {clusterDebug && (
                                    <div className="space-y-3 text-xs">
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="bg-gray-800/50 p-2 rounded">
                                                <div className="text-gray-400">Total Faces</div>
                                                <div className="text-white font-mono text-lg">{clusterDebug.total_faces}</div>
                                            </div>
                                            <div className="bg-gray-800/50 p-2 rounded">
                                                <div className="text-gray-400">Clusters Found</div>
                                                <div className="text-green-400 font-mono text-lg">{clusterDebug.cluster_count}</div>
                                            </div>
                                            <div className="bg-gray-800/50 p-2 rounded">
                                                <div className="text-gray-400">Noise (Unclustered)</div>
                                                <div className="text-red-400 font-mono text-lg">{clusterDebug.noise_count}</div>
                                            </div>
                                        </div>

                                        <div className="bg-gray-800/50 p-2 rounded">
                                            <div className="text-gray-400 mb-1">Distance Stats</div>
                                            <div className="grid grid-cols-3 gap-2 font-mono">
                                                <span>Min: <span className="text-green-400">{clusterDebug.distance_stats?.min}</span></span>
                                                <span>Mean: <span className="text-yellow-400">{clusterDebug.distance_stats?.mean}</span></span>
                                                <span>Max: <span className="text-red-400">{clusterDebug.distance_stats?.max}</span></span>
                                            </div>
                                        </div>

                                        <div className="bg-gray-800/50 p-2 rounded">
                                            <div className="text-gray-400 mb-1">Pair Analysis (eps={clusterDebug.eps_threshold})</div>
                                            <div className="font-mono">
                                                <span className="text-green-400">{clusterDebug.pairs_within_eps}</span> within eps,
                                                <span className="text-red-400 ml-2">{clusterDebug.pairs_outside_eps}</span> outside eps
                                            </div>
                                        </div>

                                        {clusterDebug.cluster_sizes && (
                                            <div className="bg-gray-800/50 p-2 rounded">
                                                <div className="text-gray-400 mb-1">Cluster Sizes</div>
                                                <div className="font-mono text-gray-300">
                                                    [{clusterDebug.cluster_sizes.slice(0, 10).join(', ')}{clusterDebug.cluster_sizes.length > 10 ? '...' : ''}]
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {!clusterDebug && (
                                    <p className="text-xs text-yellow-200/60">
                                        Click "Run DBSCAN Debug" to see which cluster each selected face belongs to and detailed clustering statistics.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}


                    {/* Named Person Suggestions Results */}
                    {suggestions.length > 0 && (
                        <div>
                            <h4 className="text-sm font-medium text-gray-300 mb-2">Named Person Suggestions</h4>
                            <div className="bg-gray-800/30 rounded-lg overflow-hidden border border-gray-700">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-800">
                                        <tr>
                                            <th className="px-3 py-2 text-left text-gray-400">Person</th>
                                            <th className="px-3 py-2 text-left text-gray-400">Match %</th>
                                            <th className="px-3 py-2 text-left text-gray-400">Distance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {suggestions.map((s, i) => (
                                            <tr key={i} className="border-t border-gray-800">
                                                <td className="px-3 py-2 text-white">{s.person_name}</td>
                                                <td className="px-3 py-2 text-green-400">{(s.similarity * 100).toFixed(1)}%</td>
                                                <td className="px-3 py-2 font-mono text-gray-300">
                                                    <span className={s.distance <= eps ? 'text-green-400' : 'text-red-400'}>
                                                        {s.distance.toFixed(4)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Check Button (Empty State) */}
                    {suggestions.length === 0 && faceIds.length > 0 && (
                        <div className="bg-gray-800/30 border border-gray-700 p-3 rounded flex items-center justify-between mt-4">
                            <span className="text-xs text-gray-400 flex items-center gap-2">
                                Check if selected faces match named persons in your database
                                {hasSearched && <span className="text-yellow-500 font-bold ml-2">⚠️ No matches found</span>}
                            </span>
                            <button
                                onClick={loadSuggestions}
                                disabled={loadingSuggestions || loading}
                                className="px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 text-green-300 border border-green-600/30 rounded text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loadingSuggestions ? 'Checking...' : (hasSearched ? 'Check Again' : 'Check Named Persons')}
                            </button>
                        </div>
                    )}

                    <div className="mt-6 flex justify-end gap-3">
                        <button
                            onClick={loadData}
                            disabled={loading}
                            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm transition-colors"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm transition-colors"
                        >
                            Close
                        </button>
                    </div>

                    <Dialog.Close asChild>
                        <button className="absolute top-4 right-4 text-gray-400 hover:text-white">
                            <Cross2Icon />
                        </button>
                    </Dialog.Close>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root >
    );
};

export default FaceDebugModal;
