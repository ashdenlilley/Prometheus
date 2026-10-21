import { useState } from 'react'
import type { Column, ColumnType, Project, SelectOption } from '@shared/types'
import { useStore } from '../store'
import { COLUMN_TYPE_INFO, HAS_OPTIONS, LABEL_COLORS } from '../columns'
import { ICONS } from './icons'
import { Modal } from './ui'
import { uid } from '../util'

const STATUS_DEFAULTS: SelectOption[] = [
  { id: 'working', label: 'Working on it', color: '#fdab3d' },
  { id: 'done', label: 'Done', color: '#00c875' },
  { id: 'stuck', label: 'Stuck', color: '#e2445c' },
  { id: 'idle', label: 'Not started', color: '#c4c4c4' }
]

// Add a new column (no `column`) or edit an existing one.
export function ColumnModal({ project, column, onClose }: { project: Project; column?: Column; onClose: () => void }) {
  const { data, dispatch } = useStore()
  const [name, setName] = useState(column?.name ?? '')
  const [type, setType] = useState<ColumnType>(column?.type ?? 'text')
  const [description, setDescription] = useState(column?.description ?? '')
  const [options, setOptions] = useState<SelectOption[]>(
    column?.options ?? (type === 'status' ? STATUS_DEFAULTS : [])
  )
  const [numberFormat, setNumberFormat] = useState<NonNullable<Column['numberFormat']>>(column?.numberFormat ?? 'plain')
  const [currency, setCurrency] = useState(column?.currency ?? 'USD')
  const [footer, setFooter] = useState<NonNullable<Column['footer']> | ''>(column?.footer ?? '')
  const [formula, setFormula] = useState(column?.formula ?? '')
  const [linkProjectId, setLinkProjectId] = useState(column?.linkProjectId ?? '')
  const [relationColumnId, setRelationColumnId] = useState(column?.relationColumnId ?? '')
  const [mirrorField, setMirrorField] = useState(column?.mirrorField ?? 'title')
  const [required, setRequired] = useState(!!column?.required)

  const hasOptions = HAS_OPTIONS.includes(type)
  const space = data.projects.filter(p => p.spaceId === project.spaceId && p.id !== project.id)
  const relationCols = project.columns.filter(c => c.type === 'board_relation' && c.id !== column?.id)
  const linked = data.projects.find(p => p.id === (linkProjectId || relationCols.find(c => c.id === relationColumnId)?.linkProjectId))

  const changeType = (next: ColumnType) => {
    setType(next)
    if (HAS_OPTIONS.includes(next) && options.length === 0) {
      setOptions(next === 'status' ? STATUS_DEFAULTS : [{ id: uid(), label: 'Option 1', color: LABEL_COLORS[0] }])
    }
  }

  const save = () => {
    if (!name.trim()) return
    const patch: Partial<Column> = {
      name: name.trim(),
      type,
      description: description || undefined,
      options: hasOptions ? options.filter(o => o.label.trim()) : undefined,
      numberFormat: type === 'number' ? numberFormat : undefined,
      currency: type === 'number' && numberFormat === 'currency' ? currency : undefined,
      footer: footer || undefined,
      formula: type === 'formula' ? formula : undefined,
      linkProjectId: type === 'board_relation' ? linkProjectId || undefined : undefined,
      relationColumnId: type === 'mirror' ? relationColumnId || undefined : undefined,
      mirrorField: type === 'mirror' ? mirrorField : undefined,
      required: required || undefined
    }
    if (column) {
      dispatch({ type: 'patchColumn', projectId: project.id, columnId: column.id, patch })
    } else {
      dispatch({ type: 'addColumn', projectId: project.id, column: { id: uid(), ...patch, name: patch.name!, type } })
    }
    onClose()
  }

  const updateOption = (id: string, patch: Partial<SelectOption>) =>
    setOptions(opts => opts.map(o => (o.id === id ? { ...o, ...patch } : o)))

  const groups = [...new Set(COLUMN_TYPE_INFO.map(t => t.group))]

  return (
    <Modal title={column ? 'Edit column' : 'Add column'} onClose={onClose}>
      <label className="field">
        Name
        <input className="field-input" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      </label>

      <div className="field">
        Type
        {groups.map(g => (
          <div key={g} className="type-group">
            <div className="muted small">{g}</div>
            <div className="type-grid">
              {COLUMN_TYPE_INFO.filter(t => t.group === g).map(t => (
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
        ))}
      </div>

      <label className="field">
        Description
        <input className="field-input" value={description} onChange={e => setDescription(e.target.value)} />
      </label>

      {type === 'number' && (
        <div className="field-row">
          <label className="field">
            Format
            <select className="field-input" value={numberFormat} onChange={e => setNumberFormat(e.target.value as typeof numberFormat)}>
              <option value="plain">Plain</option>
              <option value="decimal">Decimal (2 dp)</option>
              <option value="currency">Currency</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          {numberFormat === 'currency' && (
            <label className="field">
              Currency
              <input className="field-input" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} />
            </label>
          )}
        </div>
      )}

      {type === 'formula' && (
        <label className="field">
          Formula
          <input className="field-input" value={formula} placeholder="Estimate * 2" onChange={e => setFormula(e.target.value)} />
          <span className="muted small">Names of number columns, with + - * / ^ % and brackets. Functions: SUM, AVG, MIN, MAX, ABS, ROUND, IF. Comparisons: &lt; &gt; = &lt;= &gt;= &lt;&gt;.</span>
        </label>
      )}

      {type === 'board_relation' && (
        <label className="field">
          Connect to project
          <select className="field-input" value={linkProjectId} onChange={e => setLinkProjectId(e.target.value)}>
            <option value="">Choose project</option>
            <option value={project.id}>{project.name} (this project)</option>
            {space.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}

      {type === 'mirror' && (
        <div className="field-row">
          <label className="field">
            Through column
            <select className="field-input" value={relationColumnId} onChange={e => setRelationColumnId(e.target.value)}>
              <option value="">Choose connect column</option>
              {relationCols.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Show
            <select className="field-input" value={mirrorField} onChange={e => setMirrorField(e.target.value)}>
              <option value="title">Title</option>
              <option value="status">Status</option>
              {linked?.columns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

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

      {(type === 'number' || type === 'progress' || type === 'formula') && (
        <label className="field">
          Footer summary
          <select className="field-input" value={footer} onChange={e => setFooter(e.target.value as typeof footer)}>
            <option value="">Default</option>
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
            <option value="min">Min</option>
            <option value="max">Max</option>
            <option value="count">Count</option>
            <option value="none">None</option>
          </select>
        </label>
      )}

      <label className="check-field">
        <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
        Required
      </label>

      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>{column ? 'Save' : 'Add column'}</button>
      </div>
    </Modal>
  )
}
