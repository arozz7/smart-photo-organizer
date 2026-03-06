import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useScan } from '../context/ScanContext'
import { useAlert } from '../context/AlertContext'

interface PhotoActionsProps {
    photo: any
    visualRotation: number
    setVisualRotation: React.Dispatch<React.SetStateAction<number>>
    isRotating: boolean
    setIsRotating: (b: boolean) => void
    onClose: () => void
}

export function PhotoActions({ photo, visualRotation, setVisualRotation, isRotating, setIsRotating, onClose }: PhotoActionsProps) {
    const navigate = useNavigate()
    const { refreshPhoto } = useScan()
    const { showConfirm, showAlert } = useAlert()

    return (
        <div className="pb-4 border-b border-gray-800 space-y-3">
            <button
                onClick={() => {
                    onClose()
                    navigate(`/enhance/${photo.id}`, { state: { photo } })
                }}
                className="w-full py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded font-bold shadow-lg flex items-center justify-center gap-2"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                </svg>
                Enhance Photo
            </button>

            <div className="grid grid-cols-2 gap-2">
                <button
                    onClick={() => setVisualRotation(prev => prev - 90)}
                    className="py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm font-medium flex items-center justify-center gap-2"
                    title="Rotate Left (Preview)"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                    Left
                </button>
                <button
                    onClick={() => setVisualRotation(prev => prev + 90)}
                    className="py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm font-medium flex items-center justify-center gap-2"
                    title="Rotate Right (Preview)"
                >
                    Right
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                    </svg>
                </button>

                {visualRotation % 360 !== 0 && (
                    <button
                        onClick={() => {
                            showConfirm({
                                title: 'Save Rotation',
                                description: `Save rotation of ${visualRotation} degrees? This will modify the original file and re-scan for faces.`,
                                confirmLabel: 'Save & Re-Scan',
                                onConfirm: async () => {
                                    try {
                                        setIsRotating(true)
                                        await window.ipcRenderer.invoke('ai:rotateImage', { photoId: photo.id, rotation: visualRotation })
                                        await refreshPhoto(photo.id)
                                        onClose()
                                    } catch (e) {
                                        showAlert({ title: 'Rotation Failed', description: String(e), variant: 'danger' })
                                    } finally {
                                        setIsRotating(false)
                                    }
                                }
                            })
                        }}
                        disabled={isRotating}
                        className={`col-span-2 w-full py-2 ${isRotating ? 'bg-gray-600 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 animate-pulse'} text-white rounded font-bold shadow-lg flex items-center justify-center gap-2`}
                    >
                        {isRotating ? (
                            <>
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Saving & Re-Scanning...
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Save Rotation
                            </>
                        )}
                    </button>
                )}
            </div>
        </div>
    )
}
