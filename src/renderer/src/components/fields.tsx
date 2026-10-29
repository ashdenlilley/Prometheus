import { PRIORITIES, type StatusDef } from '@shared/types'
import { formatEstimate, parseEstimate, TSHIRT } from '@shared/estimate'
import { clsx } from '../util'
import { PRIORITY_COLORS } from '../columns'

export function StatusDot({ status }: { status: StatusDef }) {
  const done = status.category === 'completed'
  return (
    <span
      className="status-dot"
      title={status.label}
      style={{ borderColor: status.color, background: done ? status.color : 'transparent' }}
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

export function StatusSelect({ value, statuses, onChange }: { value: string; statuses: StatusDef[]; onChange: (s: string) => void }) {
  return (
    <PillSelect
      value={value}
      options={statuses.map(s => ({ value: s.id, label: s.label, color: s.color }))}
      onChange={onChange}
    />
  )
}

export function EstimateSelect({ value, className, onChange }: { value: number | undefined; className: string; onChange: (v: number | undefined) => void }) {
  return (
    <select className={className} aria-label="Estimate" value={formatEstimate(value, 'tshirt')} onChange={e => onChange(parseEstimate(e.target.value, 'tshirt'))}>
      <option value="">None</option>
      {TSHIRT.map(([label]) => (
        <option key={label} value={label}>{label}</option>
      ))}
    </select>
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
