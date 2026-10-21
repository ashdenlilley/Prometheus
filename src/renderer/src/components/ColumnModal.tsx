import { useState } from 'react'
import type { Column, ColumnType, Project, SelectOption } from '@shared/types'
import { useStore } from '../store'
import { COLUMN_TYPE_INFO, DEFAULT_STATUS_OPTIONS, HAS_OPTIONS, LABEL_COLORS } from '../columns'
import { ICONS } from './icons'
import { Modal } from './ui'
import { uid } from '../util'

// Add a new column (no `column`) or edit an existing one.
export function ColumnModal({ project, column, onClose }: { project: Project; column?: Column; onClose: () => void }) {
  const { dispatch } = useStore()
  const [name, setName] = useState(column?.name ?? '')
  const [type, setType] = useState<ColumnType>(column?.type ?? 'text')
  const [options, setOptions] = useState<SelectOption[]>(
    column?.options ?? (type === 'status' ? DEFAULT_STATUS_OPTIONS : [])
  )
  const hasOptions = HAS_OPTIONS.includes(type)

  const changeType = (next: ColumnType) => {
    setType(next)
    if (HAS_OPTIONS.includes(next) && options.length === 0) {
      setOptions(next === 'status' ? DEFAULT_STATUS_OPTIONS : [{ id: uid(), label: 'Option 1', color: LABEL_COLORS[0] }])
    }
  }

  const save = () => {
    if (!name.trim()) return
    const patch: Partial<Column> = { name: name.trim(), type, options: hasOptions ? options.filter(o => o.label.trim()) : undefined }
    if (column) {
      dispatch({ type: 'patchColumn', projectId: project.id, columnId: column.id, patch })
    } else {
      dispatch({ type: 'addColumn', projectId: project.id, column: { id: uid(), ...patch, name: patch.name!, type } })
    }
    onClose()
  }

  const updateOption = (id: string, patch: Partial<SelectOption>) =>
    setOptions(opts => opts.map(o => (o.id === id ? { ...o, ...patch } : o)))

  return (
    <Modal title={column ? 'Edit column' : 'Add column'} onClose={onClose}>
      <label className="field">
        Name
        <input className="field-input" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      </label>

      <div className="field">
        Type
        <div className="type-grid">
          {COLUMN_TYPE_INFO.map(t => (
            <button
              key={t.type}
              type="button"
              className={`type-tile${type === t.type ? ' on' : ''}`}
              onClick={() => changeType(t.type)}
            >
              <span className="type-glyph">{t.glyph}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {hasOptions && (
        <div className="field">
          Labels
          <div className="option-list">
            {options.map(o => (
              <div key={o.id} className="option-row">
                <input
                  className="color-swatch"
                  type="color"
                  value={o.color}
                  onChange={e => updateOption(o.id, { color: e.target.value })}
                  aria-label="Label colour"
                />
                <input className="field-input" value={o.label} onChange={e => updateOption(o.id, { label: e.target.value })} />
                <button className="icon-btn" onClick={() => setOptions(opts => opts.filter(x => x.id !== o.id))} aria-label="Remove label">
                  {ICONS.close}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn subtle"
              onClick={() => setOptions(opts => [...opts, { id: uid(), label: `Option ${opts.length + 1}`, color: LABEL_COLORS[opts.length % LABEL_COLORS.length] }])}
            >
              {ICONS.plus} Add label
            </button>
          </div>
        </div>
      )}

      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>{column ? 'Save' : 'Add column'}</button>
      </div>
    </Modal>
  )
}
