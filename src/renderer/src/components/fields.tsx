import { PRIORITIES, STATUSES } from '@shared/types'
import { clsx } from '../util'

const PRIORITY_COLORS = ['#8a8f98', '#e2445c', '#fdab3d', '#ffcb00', '#579bfc']

export function StatusDot({ status }: { status: (typeof STATUSES)[number]['id'] }) {
  const s = STATUSES.find(x => x.id === status)!
  return (
    <span
      className="status-dot"
      title={s.label}
      style={{ borderColor: s.color, background: status === 'done' ? s.color : 'transparent' }}
    />
  )
}

// Full-cell coloured select: the whole cell takes the chosen colour, like Monday status pills.
export function PillSelect({
  value,
  options,
  onChange,
  placeholder = '—'
}: {
  value: string
  options: { value: string; label: string; color: string }[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  const current = options.find(o => o.value === value)
  return (
    <div className={clsx('pill', !current && 'empty')} style={current ? { background: current.color } : undefined}>
      <select className="pill-select" value={current ? value : ''} onChange={e => onChange(e.target.value)}>
        {!current && <option value="">{placeholder}</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export function StatusSelect({ value, onChange }: { value: (typeof STATUSES)[number]['id']; onChange: (s: (typeof STATUSES)[number]['id']) => void }) {
  return (
    <PillSelect
      value={value}
      options={STATUSES.map(s => ({ value: s.id, label: s.label, color: s.color }))}
      onChange={v => onChange(v as (typeof STATUSES)[number]['id'])}
    />
  )
}

export function PrioritySelect({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  return (
    <PillSelect
      value={value ? String(value) : ''}
      options={PRIORITIES.slice(1).map((label, i) => ({ value: String(i + 1), label, color: PRIORITY_COLORS[i + 1] }))}
      onChange={v => onChange(v ? Number(v) : 0)}
      placeholder="No priority"
    />
  )
}

export function PriorityText({ value }: { value: number }) {
  if (!value) return null
  return <span className="prio" style={{ color: PRIORITY_COLORS[value] }}>{PRIORITIES[value]}</span>
}
