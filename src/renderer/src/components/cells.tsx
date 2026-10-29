import { useEffect, useRef, useState } from 'react'
import type { CellValue, Column, DateRange, FileRef, Issue, IntegrationLink, Project, SelectOption } from '@shared/types'
import { evaluateFormula, fieldValue, formatNumber, progressValue } from '@shared/query'
import { parseIntegrationLink } from '@shared/integrations'
import { issueKey } from '@shared/model'
import { fromLocalInput, toLocalInput } from '@shared/datetime'
import { formatLocation, parseLocation } from '@shared/location'
import { elapsedHours, formatElapsed, startTimer, stopTimer } from '@shared/timetrack'
import { subtaskLabel, subtaskSummary } from '@shared/subtasks'
import { toggleVote, voters } from '@shared/votes'
import { useStore } from '../store'
import { PillSelect, PrioritySelect } from './fields'
import { ICONS } from './icons'
import { ProviderBadge } from './ProviderBadge'
import { askText, useOutside } from './ui'
import { clsx, fmtDate } from '../util'

interface CellEditorProps {
  column: Column
  project: Project
  value: CellValue | undefined
  issue?: Issue
  onChange: (v: CellValue | undefined) => void
  variant?: 'cell' | 'field'
}

const isRange = (v: CellValue | undefined): v is DateRange =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asIds = (v: CellValue | undefined): string[] =>
  Array.isArray(v) ? (v as string[]) : typeof v === 'string' && v ? [v] : []

const MAX_FILE = 5 * 1024 * 1024

// One editor per column type. variant 'cell' is the compact in-table look; 'field' is the drawer look.
export function CellEditor({ column, project, value, issue, onChange, variant = 'field' }: CellEditorProps) {
  const { data, dispatch } = useStore()
  const cls = variant === 'cell' ? 'cell-input' : 'field-input'
  const str = typeof value === 'string' ? value : ''
  const num = typeof value === 'number' ? value : undefined
  const options = column.options ?? []

  switch (column.type) {
    case 'text':
      return (
        <input
          className={cls}
          value={str}
          onChange={e => onChange(e.target.value || undefined)}
        />
      )

    case 'location': {
      const loc = parseLocation(str)
      // Coordinates ride along in the string (see shared/location.ts), so free text stays editable.
      const setCoords = async () => {
        const text = await askText('Coordinates as lat, lon', loc.lat === undefined ? '' : `${loc.lat}, ${loc.lon}`)
        const p = text ? parseLocation(text) : undefined
        if (p?.lat !== undefined && p.lon !== undefined) onChange(formatLocation(loc.address, p.lat, p.lon))
      }
      return (
        <div className="loc-edit">
          <input className={cls} value={str} placeholder="Address or place" onChange={e => onChange(e.target.value || undefined)} />
          <button type="button" className={clsx('icon-btn', loc.lat === undefined && 'muted')} aria-label="Set coordinates" title={loc.lat === undefined ? 'Set coordinates' : `${loc.lat}, ${loc.lon}`} onClick={setCoords}>📍</button>
        </div>
      )
    }

    case 'people':
      return <TagsInput value={Array.isArray(value) ? (value as string[]) : []} suggestions={project.members} onChange={onChange} placeholder="Add person" />

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
          title={num !== undefined ? formatNumber(num, column) : undefined}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )

    case 'status':
    case 'label':
      return (
        <PillSelect
          value={str}
          options={options.map(o => ({ value: o.id, label: o.label, color: o.color }))}
          onChange={v => onChange(v || undefined)}
        />
      )

    case 'color':
      return (
        <div className="color-cell">
          <PillSelect
            value={str}
            options={options.map(o => ({ value: o.id, label: o.label, color: o.color }))}
            onChange={v => onChange(v || undefined)}
          />
        </div>
      )

    case 'priority':
      return <PrioritySelect value={num ?? 0} onChange={p => onChange(p || undefined)} />

    case 'dropdown':
      return <ChipPicker options={options} selected={asIds(value)} onChange={ids => onChange(ids)} />

    case 'date':
      if (column.includeTime) {
        return <input className={cls} type="datetime-local" value={str ? toLocalInput(str) : ''} onChange={e => onChange(fromLocalInput(e.target.value) || undefined)} />
      }
      return <input className={cls} type="date" value={str} onChange={e => onChange(e.target.value || undefined)} />

    case 'week':
      return <input className={cls} type="week" value={str} onChange={e => onChange(e.target.value || undefined)} />

    case 'hour':
      return <input className={cls} type="time" value={str} onChange={e => onChange(e.target.value || undefined)} />

    case 'time_tracking': {
      const running = issue?.timer?.columnId === column.id
      return (
        <div className="range-edit">
          <input className={clsx(cls, 'num')} type="number" min={0} step={0.25} value={num ?? ''} placeholder="0" onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
          <span className="muted">h</span>
          {issue && (
            <button
              type="button"
              className="icon-btn"
              aria-label={running ? 'Stop timer' : 'Start timer'}
              title={running ? 'Stop timer' : 'Start timer'}
              onClick={() => dispatch({ type: 'patchIssue', id: issue.id, patch: running ? stopTimer(issue, new Date()) : startTimer(issue, column.id, new Date()) })}
            >
              {running ? '■' : '▶'}
            </button>
          )}
          {running && issue.timer && <TimerReadout start={issue.timer.start} />}
        </div>
      )
    }

    case 'world_clock':
      return <WorldClock zone={str} onChange={v => onChange(v)} cls={cls} />

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
      return <TagsInput value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />

    case 'doc': {
      const ids = asIds(value)
      const docs = data.docs ?? []
      const titleOf = (id: string) => docs.find(d => d.id === id)?.title ?? 'Missing doc'
      const setIds = (next: string[]) => onChange(next.length ? next : undefined)
      const pickable = docs.filter(d => d.spaceId === project.spaceId && !d.archivedAt && !d.template && !ids.includes(d.id))
      return (
        <div className="doc-cell">
          {ids.map(id => (
            <span key={id} className="chip neutral">
              {titleOf(id)}
              <button className="icon-btn" aria-label={`Remove ${titleOf(id)}`} onClick={() => setIds(ids.filter(x => x !== id))}>
                {ICONS.close}
              </button>
            </span>
          ))}
          <select aria-label="Add doc" value="" onChange={e => e.target.value && setIds([...ids, e.target.value])}>
            <option value="">Add doc</option>
            {pickable.map(d => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        </div>
      )
    }

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

    case 'integrations': {
      const links = Array.isArray(value) ? (value as unknown as IntegrationLink[]) : []
      // Table cells are read-only; the issue panel adds and removes links through the reducer
      if (!issue || variant === 'cell') return <LinkChips links={links} compact />
      return (
        <LinksEdit
          links={links}
          onAdd={url => dispatch({ type: 'addIntegrationLink', issueId: issue.id, columnId: column.id, url })}
          onRemove={url => dispatch({ type: 'removeIntegrationLink', issueId: issue.id, columnId: column.id, url })}
        />
      )
    }

    case 'email':
      return <input className={cls} type="email" value={str} placeholder="name@company.com" onChange={e => onChange(e.target.value || undefined)} />

    case 'phone':
      return <input className={cls} type="tel" value={str} onChange={e => onChange(e.target.value || undefined)} />

    case 'rating':
      return <Rating value={num} onChange={onChange} />

    case 'progress':
      return (
        <ProgressEdit
          value={issue ? progressValue(column, issue, data.issues, project.statuses) : num ?? 0}
          readOnly={column.progressMode === 'subissues'}
          onChange={onChange}
        />
      )

    case 'vote': {
      const list = voters(value)
      const mine = list.includes(data.me)
      return (
        <button type="button" className={clsx('vote-btn', mine && 'on')} aria-pressed={mine} onClick={() => onChange(toggleVote(value, data.me))} title={list.join(', ') || 'No votes'}>
          👍 {list.length}
        </button>
      )
    }

    case 'button': {
      const count = num ?? 0
      const press = column.buttonAction && issue ? () => dispatch({ type: 'pressButton', issueId: issue.id, columnId: column.id }) : () => onChange(count + 1)
      return (
        <button type="button" className="btn subtle" onClick={press} title="Click count">
          {column.buttonAction ? column.buttonLabel || column.name : column.name} {count ? `(${count})` : ''}
        </button>
      )
    }

    case 'subtasks':
      return <span className="muted small">{issue ? subtaskLabel(subtaskSummary(data, issue.id)) : ''}</span>

    case 'board_relation':
    case 'dependency':
      return <IssuePicker column={column} project={project} selected={asIds(value)} onChange={onChange} currentId={issue?.id} />

    case 'mirror':
      return <MirrorValue column={column} project={project} issue={issue} />

    case 'formula':
      return <FormulaValue column={column} project={project} issue={issue} />

    case 'files':
      return <FilesEdit value={Array.isArray(value) ? (value as unknown as FileRef[]) : []} onChange={onChange} />

    case 'auto_number':
      return <span className="muted">{issue ? issue.number : ''}</span>

    case 'item_id':
      return <span className="muted">{issue && project ? issueKey(data, issue) : ''}</span>

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

// Free-text chips with optional suggestions (people, tags).
export function TagsInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add tag'
}: {
  value: string[]
  onChange: (v: string[]) => void
  suggestions?: string[]
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const matches = suggestions.filter(s => !value.includes(s) && s.toLowerCase().includes(draft.toLowerCase())).slice(0, 5)

  const add = (t: string) => {
    const v = t.trim()
    if (v && !value.includes(v)) onChange([...value, v])
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
        placeholder={value.length ? '' : placeholder}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
      />
      {draft && matches.length > 0 && (
        <div className="suggest">
          {matches.map(m => (
            <button key={m} type="button" className="popover-item" onMouseDown={e => { e.preventDefault(); add(m) }}>{m}</button>
          ))}
        </div>
      )}
    </div>
  )
}

const ZONES = ['UTC', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']

// Live h:mm:ss for a running timer. Ticks each second; unmounts when the timer stops.
function TimerReadout({ start }: { start: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="muted timer-readout">{formatElapsed(elapsedHours(start, now))}</span>
}

function WorldClock({ zone, onChange, cls }: { zone: string; onChange: (v: string | undefined) => void; cls: string }) {
  const time = zone ? new Date().toLocaleTimeString(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className="range-edit">
      <select className={cls} value={zone} onChange={e => onChange(e.target.value || undefined)}>
        <option value="">Pick zone</option>
        {ZONES.map(z => (
          <option key={z} value={z}>{z}</option>
        ))}
      </select>
      <span className="muted">{time}</span>
    </div>
  )
}

// Pick issues from a project (connect boards and dependencies).
function IssuePicker({
  column,
  project,
  selected,
  onChange,
  currentId
}: {
  column: Column
  project: Project
  selected: string[]
  onChange: (v: CellValue | undefined) => void
  currentId?: string
}) {
  const { data } = useStore()
  const targetProject = column.type === 'board_relation' && column.linkProjectId ? data.projects.find(p => p.id === column.linkProjectId) : project
  const pool = data.issues.filter(i => i.projectId === targetProject?.id && i.id !== currentId)
  const options: SelectOption[] = pool.map(i => ({
    id: i.id,
    label: `${targetProject ? issueKey(data, i) : ''} ${i.title}`,
    color: '#579bfc'
  }))
  if (column.type === 'board_relation' && !targetProject) return <span className="muted">Pick a project in column settings</span>
  return (
    <ChipPicker
      options={options}
      selected={selected}
      onChange={ids => onChange(ids.length ? ids : undefined)}
    />
  )
}

// Reads the linked issues' value for a relation column. Mirror columns are read-only.
function MirrorValue({ column, project, issue }: { column: Column; project: Project; issue?: Issue }) {
  const { data } = useStore()
  if (!issue || !column.relationColumnId) return <span className="muted">—</span>
  const relation = project.columns.find(c => c.id === column.relationColumnId)
  const ids = relation ? asIds(issue.values[relation.id]) : []
  const linked = ids.map(id => data.issues.find(i => i.id === id)).filter((i): i is Issue => !!i)
  const target = data.projects.find(p => p.id === relation?.linkProjectId)
  const text = linked.map(l => {
    if (!column.mirrorField || column.mirrorField === 'title') return l.title
    if (column.mirrorField === 'status') return target?.statuses.find(s => s.id === l.status)?.label ?? l.status
    const v = target ? fieldValue(l, column.mirrorField, target) : undefined
    return Array.isArray(v) ? v.join(', ') : String(v ?? '')
  })
  return <span className="mirror-text">{text.join(', ') || '—'}</span>
}

function FormulaValue({ column, project, issue }: { column: Column; project: Project; issue?: Issue }) {
  if (!issue || !column.formula) return <span className="muted">—</span>
  const n = evaluateFormula(column.formula, issue, project)
  return <span className="formula-text">{n === undefined ? 'Error' : formatNumber(n, column)}</span>
}

// Links to external items. Clicking opens them in the browser.
function LinkChips({ links, compact, onRemove }: { links: IntegrationLink[]; compact?: boolean; onRemove?: (url: string) => void }) {
  if (links.length === 0) return <span className="muted">—</span>
  return (
    <div className="link-chips">
      {links.map(l => (
        <span key={l.url} className={clsx('chip neutral', compact && 'compact')}>
          <button type="button" className="link-chip" title={l.url} onClick={e => { e.stopPropagation(); window.api.openExternal(l.url) }}>
            <ProviderBadge provider={l.provider} />
            <span className="chip-label">{l.title ?? l.url}</span>
          </button>
          {onRemove && (
            <button type="button" className="chip-x" aria-label={`Remove ${l.title ?? l.url}`} onClick={() => onRemove(l.url)}>
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

function LinksEdit({ links, onAdd, onRemove }: { links: IntegrationLink[]; onAdd: (url: string) => void; onRemove: (url: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const add = () => {
    if (!text.trim()) return
    if (!parseIntegrationLink(text)) return setError('Paste a full http:// or https:// link')
    onAdd(text.trim())
    setText('')
    setError('')
  }
  return (
    <div className="links-edit">
      <LinkChips links={links} onRemove={onRemove} />
      <input
        className="field-input"
        value={text}
        placeholder="Paste a link"
        aria-label="Add link"
        onChange={e => {
          setText(e.target.value)
          setError('')
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') add()
        }}
      />
      {error && <span className="error small">{error}</span>}
    </div>
  )
}

function FilesEdit({ value, onChange }: { value: FileRef[]; onChange: (v: CellValue | undefined) => void }) {
  const [error, setError] = useState('')
  const add = (list: FileList | null) => {
    if (!list) return
    setError('')
    Array.from(list).forEach(f => {
      if (f.size > MAX_FILE) return setError(`${f.name} is over 5 MB`)
      const reader = new FileReader()
      reader.onload = () => onChange([...value, { name: f.name, size: f.size, dataUrl: String(reader.result) }] as unknown as CellValue)
      reader.readAsDataURL(f)
    })
  }
  return (
    <div className="files-edit">
      {value.map((f, n) => (
        <span key={`${f.name}-${n}`} className="chip neutral">
          <a href={f.dataUrl} download={f.name}>{f.name}</a>
          <button type="button" className="chip-x" onClick={() => onChange(value.filter((_, x) => x !== n) as unknown as CellValue)}>×</button>
        </span>
      ))}
      <label className="btn subtle">
        Attach
        <input type="file" multiple hidden onChange={e => add(e.target.files)} />
      </label>
      {error && <span className="error small">{error}</span>}
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

function ProgressEdit({ value, readOnly, onChange }: { value: number; readOnly?: boolean; onChange: (v: number) => void }) {
  return (
    <div className="progress-edit">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
      {!readOnly && <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))} />}
      <span className="progress-label">{value}%</span>
    </div>
  )
}
