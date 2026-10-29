import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Column, Issue, Project, SavedView } from '@shared/types'
import { applyFilter, childrenOf, groupIssues, issuesFromRows, issuesToCSV, issuesToRows, parseCSV, progressValue, summarize, withoutCompleted, type FixedField } from '@shared/query'
import { resolveColumnLayout } from '@shared/views'
import { displayAssignee, isAgentAssignee } from '@shared/agents'
import { createIssue, issueKey, useStore, withValue } from '../store'
import { AgentBadge } from '../components/AgentBadge'
import { CellEditor } from '../components/cells'
import { EstimateSelect, PrioritySelect, StatusDot, StatusSelect } from '../components/fields'
import { exportXlsx, importXlsx } from '../xlsx'
import { ICONS } from '../components/icons'
import { ColumnModal } from '../components/ColumnModal'
import { PrPill } from '../components/PrPill'
import { FilterBar, useViewQuery } from '../components/FilterBar'
import { BulkBar } from '../components/BulkBar'
import { FavGutter } from '../components/FavGutter'
import { Menu, QuickAdd, type MenuItem } from '../components/ui'
import { customSortValue, defaultWidth, fixedSortValue, FIXED_COLUMNS, type FixedKey } from '../columns'
import { clsx } from '../util'
import { parseAsanaCsv, parseAsanaJson, parseJiraCsv, type ImportRow } from '@shared/importers'
import { ImportModal } from '../components/ImportModal'

interface ColumnRef {
  key: string
  label: string
  width: number
  fixed: FixedKey | null
  column: Column | null
}

const MIN_WIDTH = 80
const FAV_WIDTH = 18
const SELECT_WIDTH = 40
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
  const query = useViewQuery(project, 'table')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({})
  const [editing, setEditing] = useState<Column | 'new' | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [templateId, setTemplateId] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const excelInput = useRef<HTMLInputElement>(null)
  const jiraInput = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<ImportRow[] | null>(null)

  const all = data.issues.filter(i => i.projectId === project.id && !i.triage && !i.archivedAt)
  const filtered = applyFilter(all, query.filter, project)
  const visible = query.showCompleted ? filtered : withoutCompleted(filtered, project)
  const visibleIds = new Set(visible.map(i => i.id))

  // With a saved table view active, its order and hidden columns apply and edits go to that view.
  const activeView = project.views.find(v => v.id === query.viewId && v.view === 'table')
  const layout = resolveColumnLayout(project, activeView)

  const baseCols: ColumnRef[] = [
    // The PR column only appears once the project links a repo or an issue has a PR.
    ...FIXED_COLUMNS.filter(f => f.key !== 'pr' || (project.repos ?? []).length > 0 || data.issues.some(i => i.projectId === project.id && i.prState)).map(f => ({
      key: f.key,
      label: f.label,
      width: project.widths[f.key] ?? f.width,
      fixed: f.key as FixedKey,
      column: null
    })),
    ...project.columns.map(c => ({
      key: c.id,
      label: c.name,
      width: project.widths[c.id] ?? defaultWidth(c),
      fixed: null,
      column: c
    }))
  ]
    .filter(c => !query.hidden.includes(c.key) && !layout.hidden.includes(c.key))
    .map(c => ({ ...c, width: liveWidths[c.key] ?? c.width }))
  const cols = orderColumns(baseCols, layout.order)

  const template = `${FAV_WIDTH}px ${SELECT_WIDTH}px ${cols.map(c => `${c.width}px`).join(' ')} ${ACTIONS_WIDTH}px`
  const rowStyle = { gridTemplateColumns: template, width: 'max-content' }
  const update = (id: string, patch: Partial<Issue>) => dispatch({ type: 'patchIssue', id, patch })

  const sortRef = query.sort ? cols.find(c => c.key === query.sort!.key) : undefined
  const sortItems = (items: Issue[]) => {
    if (!query.sort || !sortRef) return items
    const value = (i: Issue) =>
      sortRef.fixed
        ? fixedSortValue(sortRef.fixed, i, project)
        : sortRef.column!.progressMode === 'subissues'
          ? progressValue(sortRef.column!, i, all, project.statuses)
          : customSortValue(sortRef.column!, i, project, data)
    const sign = query.sort.dir === 'asc' ? 1 : -1
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

  // Patches the active view's layout, or the project's when no view is active.
  const viewsWith = (patch: Partial<SavedView>) => project.views.map(v => (v.id === activeView?.id ? { ...v, ...patch } : v))

  // Drop onto a header: the dragged column moves to the target's position.
  const moveColumn = (from: string, to: string) => {
    if (from === to || to === 'name') return
    const keys = cols.map(c => c.key).filter(k => k !== from)
    keys.splice(keys.indexOf(to), 0, from)
    dispatch({ type: 'patchProject', id: project.id, patch: activeView ? { views: viewsWith({ order: keys }) } : { order: keys } })
  }

  // Hidden columns are kept in the page's memory, and in the active view when there is one.
  const setHidden = (hidden: string[]) => {
    query.setHidden(hidden)
    if (activeView) dispatch({ type: 'patchProject', id: project.id, patch: { views: viewsWith({ hidden }) } })
  }

  const hideColumn = (key: string) => setHidden([...query.hidden, key])

  const deleteColumn = (c: Column) => {
    if (window.confirm(`Delete column "${c.name}"? Its values are removed.`)) {
      dispatch({ type: 'deleteColumn', projectId: project.id, columnId: c.id })
    }
  }

  const headerMenu = (c: ColumnRef): MenuItem[] => {
    const items: MenuItem[] = []
    if (c.column) items.push({ label: 'Edit column', onSelect: () => setEditing(c.column) })
    items.push({ label: 'Sort ascending', onSelect: () => query.setSort({ key: c.key, dir: 'asc' }) })
    items.push({ label: 'Sort descending', onSelect: () => query.setSort({ key: c.key, dir: 'desc' }) })
    if (query.sort) items.push({ label: 'Clear sort', onSelect: () => query.setSort(null) })
    items.push({ label: 'Hide column', onSelect: () => hideColumn(c.key) })
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
          project={project}
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
          <div className="t-name" style={{ paddingLeft: i.parentId ? 18 : 0 }}>
            <button className="key-btn" onClick={() => onOpen(i.id)}>{issueKey(data, i)}</button>
            <input className="cell-input name" value={i.title} onChange={e => update(i.id, { title: e.target.value })} />
          </div>
        )
      case 'status':
        return <StatusSelect value={i.status} statuses={project.statuses} onChange={status => update(i.id, { status })} />
      case 'priority':
        return <PrioritySelect value={i.priority} onChange={priority => update(i.id, { priority })} />
      case 'assignee':
        if (isAgentAssignee(i.assignee)) {
          return (
            <div className="agent-cell">
              <AgentBadge data={data} assignee={i.assignee} />
              <button className="btn ghost" aria-label="Clear assignee" onClick={() => update(i.id, { assignee: '' })}>×</button>
            </div>
          )
        }
        return <input className="cell-input" value={i.assignee} placeholder="Unassigned" onChange={e => update(i.id, { assignee: e.target.value })} />
      case 'due':
        return <input className="cell-input" type="date" value={i.dueDate ?? ''} onChange={e => update(i.id, { dueDate: e.target.value || undefined })} />
      case 'start':
        return <input className="cell-input" type="date" value={i.startDate ?? ''} onChange={e => update(i.id, { startDate: e.target.value || undefined })} />
      case 'estimate':
        return project.estimateScale === 'tshirt'
          ? <EstimateSelect className="cell-input" value={i.estimate} onChange={estimate => update(i.id, { estimate })} />
          : <input className="cell-input num" type="number" value={i.estimate ?? ''} onChange={e => update(i.id, { estimate: e.target.value === '' ? undefined : Number(e.target.value) })} />
      case 'labels':
        return <input className="cell-input" value={i.labels.join(', ')} placeholder="Add labels" onChange={e => update(i.id, { labels: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
      case 'cycle':
        return (
          <select className="cell-input" value={i.cycleId ?? ''} onChange={e => update(i.id, { cycleId: e.target.value || undefined })}>
            <option value="">None</option>
            {data.cycles.filter(c => c.projectId === project.id).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )
      case 'milestone':
        return (
          <select className="cell-input" value={i.milestoneId ?? ''} onChange={e => update(i.id, { milestoneId: e.target.value || undefined })}>
            <option value="">None</option>
            {project.milestones.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )
      case 'pr':
        return i.prState ? <PrPill state={i.prState} /> : null
      default:
        return null
    }
  }

  const togglePick = (id: string) =>
    setPicked(p => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const bulkSet = (patch: Partial<Issue>) => {
    dispatch({ type: 'patchIssues', ids: pickedVisible, patch })
    setPicked(new Set())
  }

  const bulkDelete = () => {
    if (!window.confirm(`Delete ${pickedVisible.length} issues?`)) return
    dispatch({ type: 'deleteIssues', ids: pickedVisible })
    setPicked(new Set())
  }

  const exportCSV = () => {
    const blob = new Blob([issuesToCSV(data, project, visible)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${project.key}-issues.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const exportExcel = () => exportXlsx(issuesToRows(data, project, visible), `${project.key}-issues.xlsx`)

  // Shared by CSV and Excel import. The first row is the header and needs a Title column.
  const importRows = (rows: string[][]) => {
    if (!rows[0]?.some(h => h.trim().toLowerCase() === 'title')) return window.alert('The file needs a Title column.')
    const issues = issuesFromRows(data, project, rows)
    if (issues.length) dispatch({ type: 'addIssues', issues })
  }
  const importCSV = async (file: File) => importRows(parseCSV(await file.text()))
  const importExcel = async (file: File) => {
    let rows: string[][]
    try {
      rows = await importXlsx(file)
    } catch {
      return window.alert(`Could not read ${file.name} as an Excel (.xlsx) file.`)
    }
    importRows(rows)
  }

  // JSON is an Asana export. CSV with an Issue key or Summary header is Jira; any other CSV is read as Asana.
  const importJiraAsana = async (file: File) => {
    let rows: ImportRow[]
    try {
      const text = await file.text()
      if (file.name.toLowerCase().endsWith('.json')) rows = parseAsanaJson(text)
      else rows = (parseCSV(text)[0] ?? []).some(h => ['Issue key', 'Summary'].includes(h.trim())) ? parseJiraCsv(text) : parseAsanaCsv(text)
    } catch {
      return window.alert(`Could not read ${file.name} as a Jira or Asana export.`)
    }
    if (!rows.length) return window.alert('No tasks found in that file.')
    setPendingImport(rows)
  }

  const tpl = data.templates.find(t => t.id === templateId && t.projectId === project.id)
  const addItem = (title: string, status: string) => {
    const base = tpl
    dispatch({
      type: 'addIssue',
      issue: createIssue(data, project.id, base?.title ?? title, {
        status: base?.status ?? status,
        description: base?.description ?? '',
        priority: base?.priority ?? 0,
        labels: base?.labels ?? [],
        estimate: base?.estimate
      })
    })
  }

  const groups = groupIssues(
    query.sort ? sortItems(visible) : visible,
    project,
    query.groupBy,
    id => data.cycles.find(c => c.id === id)?.name ?? '',
    id => project.milestones.find(m => m.id === id)?.name ?? ''
  )

  const pickedVisible = [...picked].filter(id => visibleIds.has(id))

  return (
    <div className="view table-view">
      <div className="toolbar">
        <FilterBar project={project} kind="table" query={query} />
        {activeView && <span className="muted small">Layout saved to view {activeView.name}</span>}
        <span className="grow" />
        <select className="input-sm" value={templateId} onChange={e => setTemplateId(e.target.value)} aria-label="Template for new items">
          <option value="">No template</option>
          {data.templates.filter(t => t.projectId === project.id).map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button className="btn" onClick={exportCSV}>Export CSV</button>
        <button className="btn" onClick={() => fileInput.current?.click()}>Import CSV</button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={e => e.target.files?.[0] && importCSV(e.target.files[0])} />
        <button className="btn" onClick={exportExcel}>Export Excel</button>
        <button className="btn" onClick={() => excelInput.current?.click()}>Import Excel</button>
        <input ref={excelInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e => e.target.files?.[0] && importExcel(e.target.files[0])} />
        <button className="btn" aria-label="Import from Jira or Asana" onClick={() => jiraInput.current?.click()}>Import Jira/Asana</button>
        <input ref={jiraInput} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={e => e.target.files?.[0] && importJiraAsana(e.target.files[0])} />
      </div>

      <BulkBar
        project={project}
        count={pickedVisible.length}
        onPatch={bulkSet}
        onDelete={bulkDelete}
        onClear={() => setPicked(new Set())}
      />

      <div className="table-wrap">
        <div className="t-row t-head" style={rowStyle}>
          <div className="t-cell t-fav" />
          <div className="t-cell t-select">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={visible.length > 0 && visible.every(i => picked.has(i.id))}
              onChange={e => setPicked(e.target.checked ? new Set(visible.map(i => i.id)) : new Set())}
            />
          </div>
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

        {groups.map(g => {
          const items = g.items
          const open = !collapsed[g.key]
          // Sub-issues sit under their parent when both are in the group; orphans show as top level.
          const ids = new Set(items.map(i => i.id))
          const roots = items.filter(i => !i.parentId || !ids.has(i.parentId))
          const ordered = roots.flatMap(r => [r, ...childrenOf(items, r.id)])
          const status = query.groupBy === 'status' ? project.statuses.find(s => s.id === g.key) : undefined
          return (
            <div key={g.key} className="t-group">
              <button className="t-group-head" onClick={() => setCollapsed(c => ({ ...c, [g.key]: open }))}>
                <span className={clsx('caret', !open && 'closed')}>▾</span>
                {status && <StatusDot status={status} />}
                <span className="t-group-title" style={{ color: g.color ?? 'inherit' }}>{displayAssignee(data, g.label) || 'All items'}</span>
                <span className="count">{items.length}</span>
              </button>

              {open &&
                ordered.map(i => (
                  <div key={i.id} className={clsx('t-row fav-host', picked.has(i.id) && 'picked')} style={rowStyle}>
                    <div className="t-cell t-fav">
                      <FavGutter issue={i} />
                    </div>
                    <div className="t-cell t-select">
                      <input type="checkbox" checked={picked.has(i.id)} onChange={() => togglePick(i.id)} aria-label={`Select ${issueKey(data, i)}`} />
                    </div>
                    {cols.map(c => (
                      <div key={c.key} className="t-cell">{renderCell(c, i)}</div>
                    ))}
                    <div className="t-cell t-actions" />
                  </div>
                ))}

              {open && items.length > 0 && (
                <div className="t-row t-summary" style={rowStyle}>
                  <div className="t-cell t-fav" />
                  <div className="t-cell" />
                  {cols.map(c => (
                    <div key={c.key} className="t-cell">
                      {c.column ? summarize(c.column, items, all, project.statuses) : ''}
                    </div>
                  ))}
                  <div className="t-cell t-actions" />
                </div>
              )}

              {open && (
                <div className="t-add">
                  <QuickAdd
                    placeholder="+ Add item"
                    onAdd={title => addItem(title, g.key === 'all' || query.groupBy !== 'status' ? project.statuses[0].id : g.key)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {query.hidden.length > 0 && (
        <div className="hidden-cols muted small">
          Hidden:{' '}
          {query.hidden.map(k => {
            const label = FIXED_COLUMNS.find(f => f.key === (k as FixedField))?.label ?? project.columns.find(c => c.id === k)?.name ?? k
            return (
              <button key={k} className="chip neutral" onClick={() => setHidden(query.hidden.filter(x => x !== k))}>
                {label} +
              </button>
            )
          })}
        </div>
      )}

      {editing && (
        <ColumnModal project={project} column={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {pendingImport && <ImportModal rows={pendingImport} project={project} onClose={() => setPendingImport(null)} />}
    </div>
  )
}
