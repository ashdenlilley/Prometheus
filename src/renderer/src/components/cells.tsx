import { useRef, useState } from 'react'
import type { CellValue, Column, DateRange, Issue, SelectOption } from '@shared/types'
import { PillSelect } from './fields'
import { ICONS } from './icons'
import { useOutside } from './ui'
import { clsx, fmtDate } from '../util'

interface CellEditorProps {
  column: Column
  value: CellValue | undefined
  issue?: Issue
  onChange: (v: CellValue | undefined) => void
  variant?: 'cell' | 'field'
}

const isRange = (v: CellValue | undefined): v is DateRange =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asIds = (v: CellValue | undefined): string[] =>
  Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []

// One editor per column type. variant 'cell' is the compact in-table look; 'field' is the drawer look.
export function CellEditor({ column, value, issue, onChange, variant = 'field' }: CellEditorProps) {
  const cls = variant === 'cell' ? 'cell-input' : 'field-input'
  const str = typeof value === 'string' ? value : ''
  const num = typeof value === 'number' ? value : undefined
  const options = column.options ?? []

  switch (column.type) {
    case 'text':
    case 'people':
      return (
        <input
          className={cls}
          value={str}
          placeholder={column.type === 'people' ? 'Unassigned' : ''}
          onChange={e => onChange(e.target.value || undefined)}
        />
      )

    case 'long_text':
      return variant === 'field' ? (
        <textarea className="field-input area" rows={3} value={str} onChange={e => onChange(e.target.value || undefined)} />
      ) : (
        <input className={cls} value={str} onChange={e => onChange(e.target.value || undefined)} />
      )

    case 'number':
      return (
        <input
          className={clsx(cls, 'num')}
          type="number"
          value={num ?? ''}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )

    case 'status':
      return (
        <PillSelect
          value={str}
          options={options.map(o => ({ value: o.id, label: o.label, color: o.color }))}
          onChange={v => onChange(v || undefined)}
        />
      )

    case 'dropdown':
      return (
        <ChipPicker
          options={options}
          selected={asIds(value)}
          onChange={ids => onChange(ids)}
        />
      )

    case 'date':
      return <input className={cls} type="date" value={str} onChange={e => onChange(e.target.value || undefined)} />

    case 'timeline': {
      const r = isRange(value) ? value : {}
      return (
        <div className="range-edit">
          <input className={cls} type="date" value={r.start ?? ''} onChange={e => onChange({ ...r, start: e.target.value || undefined })} />
          <span className="muted">→</span>
          <input className={cls} type="date" value={r.end ?? ''} onChange={e => onChange({ ...r, end: e.target.value || undefined })} />
        </div>
      )
    }

    case 'checkbox':
      return (
        <div className="checkbox-cell">
          <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
        </div>
      )

    case 'tags':
      return <TagsInput value={Array.isArray(value) ? value : []} onChange={onChange} />

    case 'link':
      return (
        <div className="link-edit">
          <input className={cls} value={str} placeholder="https://" onChange={e => onChange(e.target.value || undefined)} />
          {/^https?:\/\//i.test(str) && (
            <button className="icon-btn" title="Open link" onClick={() => window.api.openExternal(str)}>
              {ICONS.external}
            </button>
          )}
        </div>
      )

    case 'email':
      return <input className={cls} type="email" value={str} placeholder="name@company.com" onChange={e => onChange(e.target.value || undefined)} />

    case 'phone':
      return <input className={cls} type="tel" value={str} onChange={e => onChange(e.target.value || undefined)} />

    case 'rating':
      return <Rating value={num} onChange={onChange} />

    case 'progress':
      return <ProgressEdit value={num ?? 0} onChange={onChange} />

    case 'created':
      return <span className="muted">{issue ? new Date(issue.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>

    case 'updated':
      return <span className="muted">{issue ? fmtDate(issue.updatedAt.slice(0, 10)) : ''}</span>
  }
}

// Multi-select of coloured options, opened as a popover.
export function ChipPicker({
  options,
  selected,
  onChange
}: {
  options: SelectOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false), open)

  return (
    <div className="chip-picker" ref={ref}>
      <button type="button" className="chip-trigger" onClick={() => setOpen(o => !o)}>
        {selected.length === 0 && <span className="muted">Choose</span>}
        {selected.map(id => {
          const o = options.find(x => x.id === id)
          return o ? (
            <span key={id} className="chip" style={{ background: o.color }}>{o.label}</span>
          ) : null
        })}
      </button>
      {open && (
        <div className="popover left">
          {options.map(o => {
            const on = selected.includes(o.id)
            return (
              <button
                key={o.id}
                type="button"
                className="popover-item"
                onClick={() => onChange(on ? selected.filter(x => x !== o.id) : [...selected, o.id])}
              >
                <span className="chip" style={{ background: o.color }}>{o.label}</span>
                <span className="grow" />
                {on && <span className="check">✓</span>}
              </button>
            )
          })}
          {options.length === 0 && <div className="muted pad">No options. Edit the column to add some.</div>}
        </div>
      )}
    </div>
  )
}

function TagsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const t = draft.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }

  return (
    <div className="chip-picker tags">
      {value.map(t => (
        <span key={t} className="chip neutral">
          {t}
          <button type="button" className="chip-x" onClick={() => onChange(value.filter(x => x !== t))}>×</button>
        </span>
      ))}
      <input
        className="tag-draft"
        value={draft}
        placeholder={value.length ? '' : 'Add tag'}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
      />
    </div>
  )
}

function Rating({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <div className="rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={clsx('star', (value ?? 0) >= n && 'on')}
          onClick={() => onChange(value === n ? undefined : n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function ProgressEdit({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="progress-edit">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
      <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))} />
      <span className="progress-label">{value}%</span>
    </div>
  )
}
