import { PRIORITIES, STATUSES, type CellValue, type Column, type ColumnType, type Status } from '@shared/types'

export const COLUMN_TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Status / select' }
]

export function StatusDot({ status }: { status: Status }) {
  const s = STATUSES.find(x => x.id === status)!
  return (
    <span
      className="status-dot"
      title={s.label}
      style={{ borderColor: s.color, background: status === 'done' ? s.color : 'transparent' }}
    />
  )
}

export function StatusSelect({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <select className="input-sm" value={value} onChange={e => onChange(e.target.value as Status)}>
      {STATUSES.map(s => (
        <option key={s.id} value={s.id}>{s.label}</option>
      ))}
    </select>
  )
}

export function PrioritySelect({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  return (
    <select className="input-sm" value={value} onChange={e => onChange(Number(e.target.value))}>
      {PRIORITIES.map((p, i) => (
        <option key={p} value={i}>{p}</option>
      ))}
    </select>
  )
}

export function PriorityText({ value }: { value: number }) {
  if (!value) return null
  return <span className={`prio prio-${value}`}>{PRIORITIES[value]}</span>
}

interface CellEditorProps {
  column: Column
  value: CellValue | undefined
  onChange: (v: CellValue | undefined) => void
  variant?: 'cell' | 'field'
}

// Renders the editor for one custom column. Empty input clears the value.
export function CellEditor({ column, value, onChange, variant = 'field' }: CellEditorProps) {
  const cls = variant === 'cell' ? 'cell-input' : 'input-sm'
  const text = typeof value === 'string' ? value : ''

  switch (column.type) {
    case 'checkbox':
      return <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
    case 'select':
      return (
        <select className={cls} value={text} onChange={e => onChange(e.target.value || undefined)}>
          <option value="" />
          {column.options?.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )
    case 'number':
      return (
        <input
          className={cls}
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
    case 'date':
      return <input className={cls} type="date" value={text} onChange={e => onChange(e.target.value || undefined)} />
    default:
      return <input className={cls} value={text} onChange={e => onChange(e.target.value || undefined)} />
  }
}
