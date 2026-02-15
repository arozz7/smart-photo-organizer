import { useState } from 'react'
import type { PhotoFilter, FilterMetadata, SmartAlbum } from '../types/filterTypes'

interface FilterPanelProps {
    filter: PhotoFilter
    metadata: FilterMetadata
    smartAlbums: SmartAlbum[]
    onFilterChange: (filter: PhotoFilter) => void
    onClear: () => void
    onSaveAlbum: (name: string) => void
    onLoadAlbum: (album: SmartAlbum) => void
    onDeleteAlbum: (id: number) => void
    onOpenCompound: () => void
}

interface SectionProps {
    title: string
    children: React.ReactNode
    defaultOpen?: boolean
}

function Section({ title, children, defaultOpen = false }: SectionProps) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="border-b border-gray-700">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700/50 transition-colors"
            >
                {title}
                <span className="text-xs">{open ? '\u25B2' : '\u25BC'}</span>
            </button>
            {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
        </div>
    )
}

function Hint({ text }: { text: string }) {
    return <p className="text-[10px] text-gray-500 leading-tight">{text}</p>
}

function SelectField({ label, value, options, onChange, hint }: {
    label: string
    value: string
    options: { value: string; label: string }[]
    onChange: (v: string) => void
    hint?: string
}) {
    return (
        <div>
            <label className="block text-xs text-gray-400 mb-1">{label}</label>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
            >
                <option value="">Any</option>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {hint && <Hint text={hint} />}
        </div>
    )
}

function SliderField({ label, min, max, step, value, onChange, hint, displayValue }: {
    label: string
    min: number
    max: number
    step: number
    value: number | undefined
    onChange: (v: number | undefined) => void
    hint?: string
    displayValue?: string
}) {
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-400">{label}</label>
                <span className="text-xs text-gray-300 font-mono">
                    {displayValue ?? (value !== undefined ? value : 'Any')}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value ?? min}
                onChange={e => {
                    const v = Number(e.target.value)
                    onChange(v === min ? undefined : v)
                }}
                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                <span>{min}</span>
                <span>{max}</span>
            </div>
            {hint && <Hint text={hint} />}
        </div>
    )
}

function CheckboxField({ label, checked, onChange, hint }: {
    label: string
    checked: boolean
    onChange: (v: boolean) => void
    hint?: string
}) {
    return (
        <div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => onChange(e.target.checked)}
                    className="rounded bg-gray-700 border-gray-600 text-indigo-500 focus:ring-indigo-500"
                />
                {label}
            </label>
            {hint && <Hint text={hint} />}
        </div>
    )
}

/** Preset buttons for quick photo sharpness filtering */
function BlurPresets({ onSelect }: { onSelect: (min?: number, max?: number) => void }) {
    const presets = [
        { label: 'Sharp', min: 100, max: undefined, hint: '100+' },
        { label: 'Medium', min: 30, max: 100, hint: '30-100' },
        { label: 'Blurry', min: undefined, max: 30, hint: '<30' },
    ]
    return (
        <div className="flex gap-1">
            {presets.map(p => (
                <button
                    key={p.label}
                    onClick={() => onSelect(p.min, p.max)}
                    className="flex-1 text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded px-1 py-1 transition-colors border border-gray-600"
                    title={p.hint}
                >
                    {p.label}
                </button>
            ))}
        </div>
    )
}

export default function FilterPanel({
    filter,
    metadata,
    smartAlbums,
    onFilterChange,
    onClear,
    onSaveAlbum,
    onLoadAlbum,
    onDeleteAlbum,
    onOpenCompound,
}: FilterPanelProps) {
    const [albumName, setAlbumName] = useState('')
    const [showSaveInput, setShowSaveInput] = useState(false)

    const update = (patch: Partial<PhotoFilter>) => {
        onFilterChange({ ...filter, ...patch })
    }

    const activeCount = Object.keys(filter).filter(k => {
        const v = filter[k as keyof PhotoFilter]
        return v !== undefined && v !== '' && v !== false
    }).length

    // Format blur value for display
    const blurDisplay = () => {
        const parts: string[] = []
        if (filter.blurScoreMin !== undefined) parts.push(`>= ${filter.blurScoreMin}`)
        if (filter.blurScoreMax !== undefined) parts.push(`<= ${filter.blurScoreMax}`)
        return parts.length > 0 ? parts.join(', ') : 'Any'
    }

    return (
        <div className="w-72 bg-gray-800 border-r border-gray-700 flex flex-col overflow-y-auto">
            <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Filters</h2>
                <div className="flex items-center gap-2">
                    {activeCount > 0 && (
                        <span className="text-xs bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">
                            {activeCount}
                        </span>
                    )}
                    <button
                        onClick={onClear}
                        className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        Clear
                    </button>
                </div>
            </div>

            {/* Search */}
            <Section title="Search" defaultOpen>
                <input
                    type="text"
                    placeholder="Search file names..."
                    value={filter.search || ''}
                    onChange={e => update({ search: e.target.value || undefined })}
                    className="w-full bg-gray-700 text-gray-200 text-sm rounded px-2 py-1.5 border border-gray-600 focus:border-indigo-500 focus:outline-none"
                />
            </Section>

            {/* Quality */}
            <Section title="Quality">
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-gray-400">Photo Sharpness</label>
                        <span className="text-xs text-gray-300 font-mono">{blurDisplay()}</span>
                    </div>
                    <BlurPresets onSelect={(min, max) => update({
                        blurScoreMin: min,
                        blurScoreMax: max,
                    })} />
                    <Hint text="Variance of Laplacian. Higher = sharper. Requires rescan to populate." />
                    <div className="flex gap-2 items-center mt-1.5">
                        <input
                            type="number"
                            min={0}
                            step={5}
                            placeholder="Min"
                            value={filter.blurScoreMin ?? ''}
                            onChange={e => update({ blurScoreMin: e.target.value ? Number(e.target.value) : undefined })}
                            className="w-1/2 bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
                        />
                        <span className="text-gray-500 text-xs">to</span>
                        <input
                            type="number"
                            min={0}
                            step={5}
                            placeholder="Max"
                            value={filter.blurScoreMax ?? ''}
                            onChange={e => update({ blurScoreMax: e.target.value ? Number(e.target.value) : undefined })}
                            className="w-1/2 bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
                        />
                    </div>
                </div>
            </Section>

            {/* Date */}
            <Section title="Date">
                <SelectField
                    label="Year"
                    value={filter.year !== undefined ? String(filter.year) : ''}
                    options={metadata.years.map(y => ({ value: String(y), label: String(y) }))}
                    onChange={v => update({ year: v ? Number(v) : undefined })}
                />
                <SelectField
                    label="Month"
                    value={filter.month !== undefined ? String(filter.month) : ''}
                    options={Array.from({ length: 12 }, (_, i) => ({
                        value: String(i + 1),
                        label: new Date(2000, i).toLocaleString('default', { month: 'long' }),
                    }))}
                    onChange={v => update({ month: v ? Number(v) : undefined })}
                />
                <div>
                    <label className="block text-xs text-gray-400 mb-1">Date Range</label>
                    <div className="flex gap-2">
                        <input
                            type="date"
                            value={filter.dateFrom || ''}
                            onChange={e => update({ dateFrom: e.target.value || undefined })}
                            className="w-1/2 bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
                        />
                        <input
                            type="date"
                            value={filter.dateTo || ''}
                            onChange={e => update({ dateTo: e.target.value || undefined })}
                            className="w-1/2 bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
                        />
                    </div>
                </div>
            </Section>

            {/* Camera */}
            <Section title="Camera">
                <SelectField
                    label="Camera Model"
                    value={filter.camera || ''}
                    options={metadata.cameraModels.map(c => ({ value: c, label: c }))}
                    onChange={v => update({ camera: v || undefined })}
                />
            </Section>

            {/* File Type */}
            <Section title="File Type">
                <SelectField
                    label="Extension"
                    value={filter.fileType || ''}
                    options={metadata.fileTypes.map(t => ({ value: t, label: t.toUpperCase() }))}
                    onChange={v => update({ fileType: v || undefined })}
                />
            </Section>

            {/* Faces */}
            <Section title="Faces">
                <SelectField
                    label="Has Faces"
                    value={filter.hasFaces === undefined ? '' : filter.hasFaces ? 'yes' : 'no'}
                    options={[
                        { value: 'yes', label: 'Yes' },
                        { value: 'no', label: 'No' },
                    ]}
                    onChange={v => update({
                        hasFaces: v === 'yes' ? true : v === 'no' ? false : undefined,
                    })}
                />
                <CheckboxField
                    label="Unnamed faces only"
                    checked={filter.unnamedFacesOnly || false}
                    onChange={v => update({ unnamedFacesOnly: v || undefined })}
                    hint="Photos with faces not yet assigned to a person"
                />
                <CheckboxField
                    label="Frontal faces only"
                    checked={filter.frontalFacesOnly || false}
                    onChange={v => update({ frontalFacesOnly: v || undefined })}
                    hint="Head rotation less than 30 degrees"
                />
                <SliderField
                    label="Min Face Quality"
                    min={0}
                    max={1}
                    step={0.05}
                    value={filter.faceQualityMin}
                    onChange={v => update({ faceQualityMin: v })}
                    displayValue={filter.faceQualityMin !== undefined ? filter.faceQualityMin.toFixed(2) : 'Any'}
                    hint="0-1 composite score. 0.7+ = high quality, 0.4-0.7 = OK, <0.4 = low"
                />
                <SelectField
                    label="Confidence Tier"
                    value={filter.confidenceTier || ''}
                    options={[
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' },
                        { value: 'unknown', label: 'Unknown' },
                    ]}
                    onChange={v => update({
                        confidenceTier: (v as PhotoFilter['confidenceTier']) || undefined,
                    })}
                    hint="How confidently each face was matched to a person"
                />
            </Section>

            {/* Existing Filters */}
            <Section title="Folder / Tag / Person">
                <SelectField
                    label="Folder"
                    value={filter.folder || ''}
                    options={metadata.folders.map(f => ({ value: f.folder, label: f.folder }))}
                    onChange={v => update({ folder: v || undefined })}
                />
                <SelectField
                    label="Tag"
                    value={filter.tag || ''}
                    options={metadata.tags.map(t => ({ value: t.name, label: t.name }))}
                    onChange={v => update({ tag: v || undefined })}
                />
                <SelectField
                    label="Person"
                    value={filter.people?.[0] !== undefined ? String(filter.people[0]) : ''}
                    options={metadata.people.map(p => ({
                        value: String(p.id),
                        label: `${p.name} (${p.face_count})`,
                    }))}
                    onChange={v => update({
                        people: v ? [Number(v)] : undefined,
                    })}
                />
            </Section>

            {/* Compound Filter Builder */}
            <Section title="Advanced">
                <button
                    onClick={onOpenCompound}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm py-1.5 rounded transition-colors"
                >
                    Compound Filter Builder
                </button>
                <Hint text="Build complex AND/OR/NOT filter combinations" />
            </Section>

            {/* Smart Albums */}
            <Section title="Smart Albums">
                {smartAlbums.length > 0 && (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                        {smartAlbums.map(album => (
                            <div
                                key={album.id}
                                className="flex items-center justify-between bg-gray-700/50 rounded px-2 py-1"
                            >
                                <button
                                    onClick={() => onLoadAlbum(album)}
                                    className="text-sm text-gray-200 hover:text-white truncate flex-1 text-left"
                                >
                                    {album.name}
                                </button>
                                <button
                                    onClick={() => album.id && onDeleteAlbum(album.id)}
                                    className="text-xs text-red-400 hover:text-red-300 ml-2 shrink-0"
                                >
                                    x
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                {showSaveInput ? (
                    <div className="flex gap-1">
                        <input
                            type="text"
                            placeholder="Album name"
                            value={albumName}
                            onChange={e => setAlbumName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && albumName.trim()) {
                                    onSaveAlbum(albumName.trim())
                                    setAlbumName('')
                                    setShowSaveInput(false)
                                }
                            }}
                            className="flex-1 bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
                            autoFocus
                        />
                        <button
                            onClick={() => {
                                if (albumName.trim()) {
                                    onSaveAlbum(albumName.trim())
                                    setAlbumName('')
                                    setShowSaveInput(false)
                                }
                            }}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-2 py-1 rounded"
                        >
                            Save
                        </button>
                        <button
                            onClick={() => { setShowSaveInput(false); setAlbumName('') }}
                            className="text-gray-400 hover:text-white text-xs px-1"
                        >
                            x
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowSaveInput(true)}
                        className="w-full border border-dashed border-gray-600 hover:border-indigo-500 text-gray-400 hover:text-white text-sm py-1.5 rounded transition-colors"
                    >
                        Save Current Filters
                    </button>
                )}
            </Section>
        </div>
    )
}
