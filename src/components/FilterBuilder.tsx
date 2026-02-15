import { useState } from 'react'
import type { CompoundFilter, FilterCondition, FilterGroup, FilterMetadata } from '../types/filterTypes'

interface FilterBuilderProps {
    initial: CompoundFilter | null
    metadata: FilterMetadata
    onApply: (filter: CompoundFilter) => void
    onClose: () => void
}

const FIELD_OPTIONS = [
    { value: 'blur_score', label: 'Blur Score', type: 'number' },
    { value: 'year', label: 'Year', type: 'select' },
    { value: 'camera', label: 'Camera', type: 'select' },
    { value: 'file_type', label: 'File Type', type: 'select' },
    { value: 'folder', label: 'Folder', type: 'select' },
    { value: 'tag', label: 'Tag', type: 'select' },
    { value: 'person', label: 'Person', type: 'select' },
    { value: 'has_faces', label: 'Has Faces', type: 'boolean' },
    { value: 'face_quality', label: 'Face Quality', type: 'number' },
    { value: 'frontal_faces', label: 'Frontal Faces', type: 'boolean' },
    { value: 'unnamed_faces', label: 'Unnamed Faces', type: 'boolean' },
    { value: 'confidence_tier', label: 'Confidence Tier', type: 'select' },
    { value: 'search', label: 'File Name', type: 'text' },
    { value: 'created_at', label: 'Date', type: 'date' },
]

const OPERATORS: Record<string, { value: string; label: string }[]> = {
    number: [
        { value: 'gte', label: '>=' },
        { value: 'lte', label: '<=' },
        { value: 'eq', label: '=' },
        { value: 'gt', label: '>' },
        { value: 'lt', label: '<' },
    ],
    text: [{ value: 'like', label: 'Contains' }],
    select: [{ value: 'eq', label: '=' }],
    boolean: [{ value: 'eq', label: 'Is' }],
    date: [
        { value: 'gte', label: 'After' },
        { value: 'lte', label: 'Before' },
        { value: 'between', label: 'Between' },
    ],
}

function defaultCondition(): FilterCondition {
    return { field: 'blur_score', operator: 'gte', value: 0 }
}

function defaultGroup(): FilterGroup {
    return { logic: 'AND', conditions: [defaultCondition()] }
}

function defaultFilter(): CompoundFilter {
    return { logic: 'AND', groups: [defaultGroup()] }
}

function getFieldType(field: string): string {
    return FIELD_OPTIONS.find(f => f.value === field)?.type || 'text'
}

function getSelectOptions(field: string, metadata: FilterMetadata): { value: string; label: string }[] {
    switch (field) {
        case 'year': return metadata.years.map(y => ({ value: String(y), label: String(y) }))
        case 'camera': return metadata.cameraModels.map(c => ({ value: c, label: c }))
        case 'file_type': return metadata.fileTypes.map(t => ({ value: t, label: t.toUpperCase() }))
        case 'folder': return metadata.folders.map(f => ({ value: f.folder, label: f.folder }))
        case 'tag': return metadata.tags.map(t => ({ value: t.name, label: t.name }))
        case 'person': return metadata.people.map(p => ({ value: String(p.id), label: p.name }))
        case 'confidence_tier': return [
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
            { value: 'unknown', label: 'Unknown' },
        ]
        default: return []
    }
}

export default function FilterBuilder({ initial, metadata, onApply, onClose }: FilterBuilderProps) {
    const [filter, setFilter] = useState<CompoundFilter>(initial || defaultFilter())

    const updateGroup = (gi: number, patch: Partial<FilterGroup>) => {
        const groups = [...filter.groups]
        groups[gi] = { ...groups[gi], ...patch }
        setFilter({ ...filter, groups })
    }

    const addGroup = () => {
        setFilter({ ...filter, groups: [...filter.groups, defaultGroup()] })
    }

    const removeGroup = (gi: number) => {
        if (filter.groups.length <= 1) return
        setFilter({ ...filter, groups: filter.groups.filter((_, i) => i !== gi) })
    }

    const updateCondition = (gi: number, ci: number, patch: Partial<FilterCondition>) => {
        const groups = [...filter.groups]
        const conds = [...groups[gi].conditions]
        conds[ci] = { ...conds[ci], ...patch }
        groups[gi] = { ...groups[gi], conditions: conds }
        setFilter({ ...filter, groups })
    }

    const addCondition = (gi: number) => {
        const groups = [...filter.groups]
        groups[gi] = { ...groups[gi], conditions: [...groups[gi].conditions, defaultCondition()] }
        setFilter({ ...filter, groups })
    }

    const removeCondition = (gi: number, ci: number) => {
        const groups = [...filter.groups]
        if (groups[gi].conditions.length <= 1) return
        groups[gi] = { ...groups[gi], conditions: groups[gi].conditions.filter((_, i) => i !== ci) }
        setFilter({ ...filter, groups })
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-800 rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex flex-col border border-gray-700">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
                    <h2 className="text-lg font-semibold text-white">Compound Filter Builder</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">x</button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {/* Top-level logic */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-400">Match</span>
                        <select
                            value={filter.logic}
                            onChange={e => setFilter({ ...filter, logic: e.target.value as 'AND' | 'OR' })}
                            className="bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600"
                        >
                            <option value="AND">ALL groups (AND)</option>
                            <option value="OR">ANY group (OR)</option>
                        </select>
                    </div>

                    {filter.groups.map((group, gi) => (
                        <div key={gi} className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-gray-400">Group {gi + 1}</span>
                                    <select
                                        value={group.logic}
                                        onChange={e => updateGroup(gi, { logic: e.target.value as 'AND' | 'OR' })}
                                        className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-0.5 border border-gray-600"
                                    >
                                        <option value="AND">AND</option>
                                        <option value="OR">OR</option>
                                    </select>
                                </div>
                                {filter.groups.length > 1 && (
                                    <button
                                        onClick={() => removeGroup(gi)}
                                        className="text-xs text-red-400 hover:text-red-300"
                                    >
                                        Remove group
                                    </button>
                                )}
                            </div>

                            {group.conditions.map((cond, ci) => {
                                const fieldType = getFieldType(cond.field)
                                const ops = OPERATORS[fieldType] || OPERATORS.text
                                const selectOpts = fieldType === 'select' ? getSelectOptions(cond.field, metadata) : []

                                return (
                                    <div key={ci} className="flex items-center gap-2">
                                        {/* Field */}
                                        <select
                                            value={cond.field}
                                            onChange={e => {
                                                const newField = e.target.value
                                                const newType = getFieldType(newField)
                                                const newOp = (OPERATORS[newType] || OPERATORS.text)[0].value
                                                updateCondition(gi, ci, {
                                                    field: newField,
                                                    operator: newOp as FilterCondition['operator'],
                                                    value: newType === 'boolean' ? true : '',
                                                })
                                            }}
                                            className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 w-32"
                                        >
                                            {FIELD_OPTIONS.map(f => (
                                                <option key={f.value} value={f.value}>{f.label}</option>
                                            ))}
                                        </select>

                                        {/* Operator */}
                                        <select
                                            value={cond.operator}
                                            onChange={e => updateCondition(gi, ci, { operator: e.target.value as FilterCondition['operator'] })}
                                            className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 w-20"
                                        >
                                            {ops.map(o => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                        </select>

                                        {/* Value */}
                                        {fieldType === 'boolean' ? (
                                            <select
                                                value={String(cond.value)}
                                                onChange={e => updateCondition(gi, ci, { value: e.target.value === 'true' })}
                                                className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 flex-1"
                                            >
                                                <option value="true">Yes</option>
                                                <option value="false">No</option>
                                            </select>
                                        ) : fieldType === 'select' ? (
                                            <select
                                                value={String(cond.value)}
                                                onChange={e => {
                                                    const raw = e.target.value
                                                    const numVal = Number(raw)
                                                    updateCondition(gi, ci, { value: isNaN(numVal) ? raw : numVal })
                                                }}
                                                className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 flex-1"
                                            >
                                                <option value="">Select...</option>
                                                {selectOpts.map(o => (
                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                ))}
                                            </select>
                                        ) : fieldType === 'date' ? (
                                            <input
                                                type="date"
                                                value={String(cond.value)}
                                                onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                                                className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 flex-1"
                                            />
                                        ) : (
                                            <input
                                                type={fieldType === 'number' ? 'number' : 'text'}
                                                value={String(cond.value)}
                                                onChange={e => {
                                                    const v = fieldType === 'number' ? Number(e.target.value) : e.target.value
                                                    updateCondition(gi, ci, { value: v })
                                                }}
                                                placeholder="Value"
                                                className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 flex-1"
                                            />
                                        )}

                                        {/* Exclude toggle */}
                                        <label className="flex items-center gap-1 text-xs text-gray-400 shrink-0" title="Exclude (NOT)">
                                            <input
                                                type="checkbox"
                                                checked={cond.exclude || false}
                                                onChange={e => updateCondition(gi, ci, { exclude: e.target.checked })}
                                                className="rounded bg-gray-700 border-gray-600 text-red-500 w-3 h-3"
                                            />
                                            NOT
                                        </label>

                                        {/* Remove condition */}
                                        {group.conditions.length > 1 && (
                                            <button
                                                onClick={() => removeCondition(gi, ci)}
                                                className="text-red-400 hover:text-red-300 text-xs shrink-0"
                                            >
                                                x
                                            </button>
                                        )}
                                    </div>
                                )
                            })}

                            <button
                                onClick={() => addCondition(gi)}
                                className="text-xs text-indigo-400 hover:text-indigo-300"
                            >
                                + Add condition
                            </button>
                        </div>
                    ))}

                    <button
                        onClick={addGroup}
                        className="text-sm text-indigo-400 hover:text-indigo-300"
                    >
                        + Add group
                    </button>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onApply(filter)}
                        className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
                    >
                        Apply Filter
                    </button>
                </div>
            </div>
        </div>
    )
}
