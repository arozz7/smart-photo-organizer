import { useEffect, useState } from 'react'

export default function LoadingScreen({ onReady }: { onReady: () => void }) {
    const [status, setStatus] = useState('Initializing...')
    const [progress, setProgress] = useState(0)

    useEffect(() => {
        // Simulate startup sequence or listen to real events
        const steps = [
            { msg: 'Starting Background Services...', time: 500 },
            { msg: 'Connecting to Database...', time: 1000 },
            { msg: 'Loading AI Models...', time: 2000 },
            { msg: 'Preparing User Interface...', time: 800 }
        ]

        let currentStep = 0

        const nextStep = () => {
            if (currentStep >= steps.length) {
                onReady()
                return
            }

            setStatus(steps[currentStep].msg)
            setProgress(((currentStep + 1) / steps.length) * 100)

            setTimeout(() => {
                currentStep++
                nextStep()
            }, steps[currentStep].time)
        }

        nextStep()

        // Real event listener if we had backend emitting 'ready'
        // @ts-ignore
        // window.ipcRenderer.on('backend-ready', () => onReady())

    }, [])

    return (
        <div className="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center z-50 select-none">
            <style>{`
                @keyframes logo-pulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.05); opacity: 0.8; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .animate-logo-pulse {
                    animation: logo-pulse 2s infinite;
                }
            `}</style>
            <div className="w-64 space-y-4">
                <div className="flex justify-center mb-8">
                    {/* Replaced emoji with animated logo */}
                    <img src="icon.png" alt="App Logo" className="w-24 h-24 animate-logo-pulse" />
                </div>

                <h2 className="text-xl font-bold text-white text-center">Smart Photo Organizer</h2>

                <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden border border-gray-700">
                    <div
                        className="bg-indigo-500 h-full transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>

                <p className="text-xs text-gray-500 text-center font-mono animate-pulse">
                    {status}
                </p>
            </div>

            <div className="absolute bottom-4 text-gray-600 text-[10px]">
                v0.5.0
            </div>
        </div>
    )
}
