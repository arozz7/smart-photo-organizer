
import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Slider from '@radix-ui/react-slider';
import { Cross2Icon, UpdateIcon } from '@radix-ui/react-icons';

interface ClusteringSettingsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRecluster: (options: { threshold: number, min_samples: number }) => void;
}

const ClusteringSettingsModal: React.FC<ClusteringSettingsModalProps> = ({ open, onOpenChange, onRecluster }) => {
    const [threshold, setThreshold] = useState(0.65);
    const [loading, setLoading] = useState(false);

    // Initial load: Prefer LocalStorage (Last used), else Global
    useEffect(() => {
        if (open) {
            const saved = localStorage.getItem('regroupThreshold');
            if (saved) {
                setThreshold(parseFloat(saved));
            } else {
                // @ts-ignore
                window.ipcRenderer.invoke('ai:getSettings').then((s: any) => {
                    if (s && s.faceSimilarityThreshold) {
                        setThreshold(s.faceSimilarityThreshold);
                    }
                });
            }
        }
    }, [open]);

    const handleApply = async () => {
        setLoading(true);
        // Persist preference
        localStorage.setItem('regroupThreshold', threshold.toString());

        // Call parent recluster logic
        await onRecluster({ threshold, min_samples: 2 });
        setLoading(false);
        onOpenChange(false);
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-fade-in" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] bg-gray-900 border border-gray-700 p-6 rounded-lg shadow-xl z-50 flex flex-col animate-scale-in">
                    <Dialog.Title className="text-xl font-bold text-white mb-2">Clustering Settings</Dialog.Title>
                    <Dialog.Description className="text-sm text-gray-400 mb-6">
                        Adjust how strict the AI is when grouping faces.
                    </Dialog.Description>

                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-sm font-medium text-gray-300">Similarity Threshold</label>
                                <span className="text-xs font-mono bg-gray-800 px-2 py-1 rounded text-indigo-400">{threshold.toFixed(2)}</span>
                            </div>
                            <Slider.Root
                                className="relative flex items-center select-none touch-none w-full h-5"
                                value={[threshold]}
                                max={0.95}
                                min={0.4}
                                step={0.01}
                                onValueChange={(v) => setThreshold(v[0])}
                            >
                                <Slider.Track className="bg-gray-700 relative grow rounded-full h-[3px]">
                                    <Slider.Range className="absolute bg-indigo-500 rounded-full h-full" />
                                </Slider.Track>
                                <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
                            </Slider.Root>
                            <div className="flex justify-between text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                                <span>Loose (Fewer Groups)</span>
                                <span>Strict (More Groups)</span>
                            </div>
                        </div>

                        <div className="bg-indigo-900/20 border border-indigo-500/20 rounded p-4 text-xs text-indigo-200">
                            <strong>Note:</strong> Re-clustering will regroup ALL unnamed faces currently in the view. It does not affect faces you have already named.
                        </div>
                    </div>

                    <div className="mt-8 flex justify-end gap-3">
                        <button
                            onClick={() => onOpenChange(false)}
                            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleApply}
                            disabled={loading}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-indigo-900/20"
                        >
                            {loading ? <div className="animate-spin h-3 w-3 border-2 border-white/30 border-t-white rounded-full" /> : <UpdateIcon />}
                            Run Re-Cluster
                        </button>
                    </div>

                    <Dialog.Close asChild>
                        <button className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
                            <Cross2Icon />
                        </button>
                    </Dialog.Close>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default ClusteringSettingsModal;
