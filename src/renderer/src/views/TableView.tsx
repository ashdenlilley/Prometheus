import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { STATUSES, type Column, type Issue, type Project } from '@shared/types'
import { createIssue, issueKey, useStore, withValue } from '../store'
import { CellEditor } from '../components/cells'
import { PrioritySelect, StatusDot, StatusSelect } from '../components/fields'
import { ICONS } from '../components/icons'
import { ColumnModal } from '../components/ColumnModal'
import { Menu, QuickAdd, type MenuItem } from '../components/ui'
import {
  customSortValue,
  defaultWidth,
  fixedSortValue,
  FIXED_COLUMNS,
  summarize,
  type FixedKey
} from '../columns'
import { clsx } from '../util'

interface ColumnRef {
  key: string
  label: string
  width: number
  fixed: FixedKey | null
  column: Column | null
}

interface Sort {
  key: string
  dir: 'asc' | 'desc'
}

const MIN_WIDTH = 80
const ACTIONS_WIDTH = 48

// Saved order first (unknown keys dropped, new columns appended), with 'name' always leading.
function orderColumns(cols: ColumnRef[], order: string[] | undefined): ColumnRef[] {
  const saved = (order ?? []).filter(k => cols.some(c => c.key === k))
  const keys = [...saved, ...cols.map(c => c.key).filter(k => !saved.includes(k))]
  const sorted = ['name', ...keys.filter(k => k !== 'name')]
  return sorted.map(k => cols.find(c => c.key === k)!)
}

export function TableView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [sort, setSort] = useState<Sort | null>(null)
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({})
  const [editing, setEditing] = useState<Column | 'new' | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const issues = data.issues.filter(i => i.projectId === project.id)

  const baseCols: ColumnRef[] = [
    ...FIXED_COLUMNS.map(f => ({
      key: f.key,
      label: f.label,
      width: project.widths[f.key] ?? f.width,
      fixed: f.key,
      column: null
    })),
    ...project.columns.map(c => ({
      key: c.id,
      label: c.name,
      width: project.widths[c.id] ?? defaultWidth(c),
      fixed: null,
      column: c
    }))
  ].map(c => ({ ...c, width: liveWidths[c.key] ?? c.width }))
  const cols = orderColumns(baseCols, project.order)

  const template = `${cols.map(c => `${c.width}px`).join(' ')} ${ACTIONS_WIDTH}px`
  const rowStyle = { gridTemplateColumns: template, width: 'max-content' }
  const update = (id: string, patch: Partial<Issue>) => dispatch({ type: 'patchIssue', id, patch })

  const sortRef = sort ? cols.find(c => c.key === sort.key) : undefined
  const sortItems = (items: Issue[]) => {
    if (!sort || !sortRef) return items
    const value = (i: Issue) =>
      sortRef.fixed ? fixedSortValue(sortRef.fixed, i) : customSortValue(sortRef.column!, i)
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sign
    })
  }

  // Drag the header's right edge. Width previews live; the store is written on release.
  const beginResize = (e: ReactMouseEvent, c: ColumnRef) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    let width = c.width
    document.body.style.cursor = 'col-resize'
    const move = (ev: MouseEvent) => {
      width = Math.max(MIN_WIDTH, c.width + ev.clientX - x0)
      setLiveWidths(w => ({ ...w, [c.key]: width }))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      dispatch({ type: 'patchProject', id: project.id, patch: { widths: { ...project.widths, [c.key]: width } } })
      setLiveWidths(w => {
        const next = { ...w }
        delete next[c.key]
        return next
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Drop onto a header: the dragged column moves to the target's position.
  const moveColumn = (from: string, to: string) => {
    if (from === to || to === 'name') return
    const keys = cols.map(c => c.key).filter(k => k !== from)
    keys.splice(keys.indexOf(to), 0, from)
    dispatch({ type: 'patchProject', id: project.id, patch: { order: keys } })
  }

  const deleteColumn = (c: Column) => {
    if (window.confirm(`Delete column "${c.name}"? Its values are removed.`)) {
      dispatch({ type: 'deleteColumn', projectId: project.id, columnId: c.id })
    }
  }

  const headerMenu = (c: ColumnRef): MenuItem[] => {
    const items: MenuItem[] = []
    if (c.column) items.push({ label: 'Edit column', onSelect: () => setEditing(c.column) })
    items.push({ label: 'Sort ascending', onSelect: () => setSort({ key: c.key, dir: 'asc' }) })
    items.push({ label: 'Sort descending', onSelect: () => setSort({ key: c.key, dir: 'desc' }) })
    if (sort) items.push({ label: 'Clear sort', onSelect: () => setSort(null) })
    if (c.column) {
      items.push({ label: 'Delete column', danger: true, icon: ICONS.trash, onSelect: () => deleteColumn(c.column!) })
    }
    return items
  }

  const renderCell = (c: ColumnRef, i: Issue) => {
    if (c.column) {
      return (
        <CellEditor
          column={c.column}
          issue={i}
          variant="cell"
          value={i.values[c.key]}
          onChange={v => update(i.id, { values: withValue(i.values, c.key, v) })}
        />
      )
    }
    switch (c.fixed) {
      case 'name':
        return (
          <div className="t-name">
            <button className="key-btn" onClick={() => onOpen(i.id)}>{issueKey(data, i)}</button>
            <input className="cell-input name" value={i.title} onChange={e => update(i.id, { title: e.target.value })} />
          </div>
        )
      case 'status':
        return <StatusSelect value={i.status} onChange={status => update(i.id, { status })} />
      case 'priority':
        return <PrioritySelect value={i.priority} onChange={priority => update(i.id, { priority })} />
      case 'assignee':
        return <input className="cell-input" value={i.assignee} placeholder="Unassigned" onChange={e => update(i.id, { assignee: e.target.value })} />
      case 'due':
        return <input className="cell-input" type="date" value={i.dueDate ?? ''} onChange={e => update(i.id, { dueDate: e.target.value || undefined })} />
      default:
        return null
    }
  }

  return (
    <div className="view table-view">
      <div className="table-wrap">
        <div className="t-row t-head" style={rowStyle}>
          {cols.map(c => (
            <div
              key={c.key}
              className={clsx('t-cell t-th', overKey === c.key && dragKey !== c.key && 'drop-target', dragKey === c.key && 'dragging')}
              draggable={c.key !== 'name'}
              onDragStart={e => {
                setDragKey(c.key)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', c.key)
              }}
              onDragOver={e => {
                if (!dragKey) return
                e.preventDefault()
                setOverKey(c.key)
              }}
              onDragLeave={() => setOverKey(null)}
              onDrop={e => {
                e.preventDefault()
                if (dragKey) moveColumn(dragKey, c.key)
                setDragKey(null)
                setOverKey(null)
              }}
              onDragEnd={() => {
                setDragKey(null)
                setOverKey(null)
              }}
            >
              <span className="t-th-label">{c.label}</span>
              <Menu items={headerMenu(c)} align="right" />
              <div className="t-resize" onMouseDown={e => beginResize(e, c)} />
            </div>
          ))}
          <div className="t-cell t-actions">
            <button className="icon-btn" title="Add column" onClick={() => setEditing('new')}>{ICONS.plus}</button>
          </div>
        </div>

        {STATUSES.map(s => {
          const items = sortItems(issues.filter(i => i.status === s.id))
          const open = !collapsed[s.id]
          return (
            <div key={s.id} className="t-group">
              <button className="t-group-head" onClick={() => setCollapsed(c => ({ ...c, [s.id]: open }))}>
                <span className={clsx('caret', !open && 'closed')}>▾</span>
                <StatusDot status={s.id} />
                <span className="t-group-title" style={{ color: s.color }}>{s.label}</span>
                <span className="count">{items.length}</span>
              </button>

              {open &&
                items.map(i => (
                  <div key={i.id} className="t-row" style={rowStyle}>
                    {cols.map(c => (
                      <div key={c.key} className="t-cell">{renderCell(c, i)}</div>
                    ))}
                    <div className="t-cell t-actions" />
                  </div>
                ))}

              {open && items.length > 0 && (
                <div className="t-row t-summary" style={rowStyle}>
                  {cols.map(c => (
                    <div key={c.key} className="t-cell">
                      {c.column ? summarize(c.column, items) : ''}
                    </div>
                  ))}
                  <div className="t-cell t-actions" />
                </div>
              )}

              {open && (
                <div className="t-add">
                  <QuickAdd
                    placeholder="+ Add item"
                    onAdd={title =>
                      dispatch({ type: 'addIssue', issue: createIssue(data, project.id, title, { status: s.id }) })
                    }
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing && (
        <ColumnModal project={project} column={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
