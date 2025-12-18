import { useState, useEffect } from 'react';

interface ModelInfo {
    exists: boolean;
    url: string;
    size: number;
    localPath?: string;
}

interface SystemStatus {
    models: Record<string, ModelInfo>;
}

export default function ModelDownloader({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const [status, setStatus] = useState<SystemStatus | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [progress, setProgress] = useState<{ current: number, total: number, percent: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = async () => {
        try {
            // @ts-ignore
            const s = await window.ipcRenderer.invoke('ai:getSystemStatus');
            setStatus(s);
        } catch (err) {
            console.error('Failed to get system status:', err);
        }
    };

    useEffect(() => {
        if (open) {
            fetchStatus();
        }
    }, [open]);

    useEffect(() => {
        // @ts-ignore
        const cleanup = window.ipcRenderer.on('ai:model-progress', (message: any) => {
            if (message.type === 'download_progress') {
                setProgress({
                    current: message.current,
                    total: message.total,
                    percent: message.percent
                });
            } else if (message.type === 'download_result') {
                setDownloading(null);
                setProgress(null);
                fetchStatus();
                if (!message.success) {
                    setError(message.error || 'Download failed');
                }
            }
        });
        return typeof cleanup === 'function' ? cleanup : undefined;
    }, []);

    const startDownload = async (modelName: string) => {
        try {
            setError(null);
            setDownloading(modelName);
            setProgress({ current: 0, total: 0, percent: 0 });
            // @ts-ignore
            await window.ipcRenderer.invoke('ai:downloadModel', { modelName });
        } catch (err) {
            setError(String(err));
            setDownloading(null);
            setProgress(null);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return 'Unknown size';
        const mb = bytes / (1024 * 1024);
        return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-xl flex flex-col border border-gray-700 overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <h3 className="text-lg font-semibold text-blue-400 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        AI Model Management
                    </h3>
                    <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-4 text-sm text-gray-400">
                    To optimize performance and keep the installer small, AI models are downloaded to your local device.
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[60vh]">
                    {!status ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                        </div>
                    ) : (
                        Object.entries(status.models)
                            .sort(([a], [b]) => a.includes('Runtime') ? -1 : b.includes('Runtime') ? 1 : 0)
                            .map(([name, info]) => (
                                <div key={name} className={`p-3 rounded border flex flex-col gap-2 transition-all hover:border-gray-600 ${name.includes('Runtime') ? 'bg-indigo-900/20 border-indigo-500/30' : 'bg-gray-900/50 border-gray-700/50'
                                    }`}>
                                    <div className="flex justify-between items-center">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-gray-200">{name}</span>
                                                {name.includes('Runtime') && <span className="text-[10px] bg-indigo-500 text-white px-1.5 rounded-full font-bold">REQUIRED FOR GPU</span>}
                                            </div>
                                            <span className="text-[10px] text-gray-500 truncate max-w-[250px]">{info.url}</span>
                                        </div>

                                        {info.exists ? (
                                            <div className="flex items-center gap-1 text-green-400 text-xs font-semibold bg-green-400/10 px-2 py-1 rounded">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                </svg>
                                                Ready
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => startDownload(name)}
                                                disabled={!!downloading}
                                                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-2 ${downloading === name
                                                    ? 'bg-blue-500/20 text-blue-400'
                                                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                                                    }`}
                                            >
                                                {downloading === name ? (
                                                    <>
                                                        <div className="animate-spin h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full"></div>
                                                        Downloading...
                                                    </>
                                                ) : (
                                                    <>
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                        </svg>
                                                        Download ({formatSize(info.size)})
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>

                                    {downloading === name && progress && (
                                        <div className="space-y-1 mt-1">
                                            <div className="w-full bg-gray-800 rounded-full h-1.5">
                                                <div
                                                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                                                    style={{ width: `${progress.percent}%` }}
                                                ></div>
                                            </div>
                                            <div className="flex justify-between text-[10px] text-gray-500">
                                                <span>{progress.percent.toFixed(1)}%</span>
                                                <span>{formatSize(progress.current)} / {formatSize(progress.total)}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                    )}
                </div>

                {error && (
                    <div className="m-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-300 text-xs flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {error}
                    </div>
                )}

                <div className="p-4 border-t border-gray-700 flex justify-end bg-gray-900/30">
                    <button
                        onClick={() => onOpenChange(false)}
                        className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
