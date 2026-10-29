import { useEffect, useRef, useState } from 'react'
import type { Condition, FilterGroup, Project, SavedView, Sort } from '@shared/types'
import { emptyFilter, FIXED_FIELDS, viewShowsCompleted } from '@shared/query'
import { PR_STATE_LABEL } from '@shared/git'
import type { ViewKind } from '@shared/views'
import { useStore } from '../store'
import { askText, useOutside } from './ui'
import { ICONS } from './icons'
import { clsx, uid } from '../util'

type ChartType = NonNullable<SavedView['chartType']>

export interface ViewQuery {
  filter: FilterGroup
  setFilter: (f: FilterGroup) => void
  groupBy: string | null
  setGroupBy: (g: string | null) => void
  rowsBy: string | null
  setRowsBy: (r: string | null) => void
  sort: Sort | null
  setSort: (s: Sort | null) => void
  hidden: string[]
  setHidden: (h: string[]) => void
  showCompleted: boolean
  setShowCompleted: (s: boolean) => void
  chartType: ChartType
  setChartType: (c: ChartType) => void
  applyView: (v: SavedView) => void
  viewId: string | undefined
}

// Filter, grouping, sort and hidden columns per project and view kind. Kept in memory so they
// survive navigation; saved views persist to the project.
interface QueryState {
  filter: FilterGroup
  groupBy: string | null
  rowsBy: string | null
  sort: Sort | null
  hidden: string[]
  showCompleted: boolean
  chartType?: ChartType
  viewId?: string
}

const memory = new Map<string, QueryState>()
// Mounted useViewQuery hooks, told when openSavedView rewrites their key.
const listeners = new Set<(key: string) => void>()

function queryStateFromView(v: SavedView): QueryState {
  return { filter: v.filter, groupBy: v.groupBy, rowsBy: v.rowsBy ?? null, sort: v.sort, hidden: v.hidden, showCompleted: viewShowsCompleted(v), chartType: v.chartType ?? 'bar', viewId: v.id }
}

// Applies a saved view to its project's page for that kind, whether or not the page is open.
export function openSavedView(projectId: string, view: SavedView) {
  const key = `${projectId}:${view.view}`
  memory.set(key, queryStateFromView(view))
  listeners.forEach(l => l(key))
}

export function useViewQuery(project: Project, kind: ViewKind): ViewQuery {
  const key = `${project.id}:${kind}`
  const [state, setState] = useState<QueryState>(() => memory.get(key) ?? { filter: emptyFilter(), groupBy: null, rowsBy: null, sort: null, hidden: [], showCompleted: true })
  useEffect(() => {
    const listener = (k: string) => {
      if (k === key) setState(memory.get(key)!)
    }
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [key])
  const write = (patch: Partial<QueryState>) =>
    setState(s => {
      const next = { ...s, ...patch }
      memory.set(key, next)
      return next
    })
  return {
    filter: state.filter,
    setFilter: filter => write({ filter }),
    groupBy: state.groupBy,
    setGroupBy: groupBy => write({ groupBy }),
    rowsBy: state.rowsBy,
    setRowsBy: rowsBy => write({ rowsBy }),
    sort: state.sort,
    setSort: sort => write({ sort }),
    hidden: state.hidden,
    setHidden: hidden => write({ hidden }),
    showCompleted: state.showCompleted,
    setShowCompleted: showCompleted => write({ showCompleted }),
    chartType: state.chartType ?? 'bar',
    setChartType: chartType => write({ chartType }),
    applyView: v => write(queryStateFromView(v)),
    viewId: state.viewId
  }
}

export function fieldOptions(project: Project) {
  const fixed = [
    ...FIXED_FIELDS.map(f => ({ key: f.key as string, label: f.label })),
    { key: 'favourite', label: 'Favourite' }
  ]
  const custom = project.columns
    .filter(c => !['formula', 'button', 'subtasks', 'files', 'created', 'updated', 'timeline', 'mirror'].includes(c.type))
    .map(c => ({ key: c.id, label: c.name }))
  return [...fixed, ...custom]
}

const OPS: { op: Condition['op']; label: string }[] = [
  { op: 'is', label: 'is' },
  { op: 'is_not', label: 'is not' },
  { op: 'contains', label: 'contains' },
  { op: 'gt', label: 'greater than' },
  { op: 'lt', label: 'less than' },
  { op: 'empty', label: 'is empty' },
  { op: 'not_empty', label: 'is not empty' }
]

// Options for enumerated fields, so values can be picked instead of typed.
function valueOptions(project: Project, key: string): { value: string; label: string }[] | null {
  if (key === 'status') return project.statuses.map(s => ({ value: s.id, label: s.label }))
  if (key === 'favourite') return [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
  if (key === 'pr') return [{ value: '', label: 'None' }, ...Object.entries(PR_STATE_LABEL).map(([value, label]) => ({ value, label }))]
  if (key === 'priority') return ['No priority', 'Urgent', 'High', 'Medium', 'Low'].map((label, n) => ({ value: String(n), label }))
  const col = project.columns.find(c => c.id === key)
  if (col?.options) return col.options.map(o => ({ value: o.id, label: o.label }))
  return null
}

// Shared by the Group and Rows selects; '' is None.
function groupOptions(project: Project): { value: string; label: string }[] {
  return [
    { value: '', label: 'None' },
    { value: 'status', label: 'Status' },
    { value: 'priority', label: 'Priority' },
    { value: 'assignee', label: 'Assignee' },
    { value: 'labels', label: 'Labels' },
    { value: 'cycle', label: 'Cycle' },
    { value: 'milestone', label: 'Milestone' },
    ...project.columns
      .filter(c => ['dropdown', 'label', 'status', 'people', 'checkbox', 'text', 'color'].includes(c.type))
      .map(c => ({ value: c.id, label: c.name }))
  ]
}

export function FilterBar({ project, kind, query, showGroup = true }: { project: Project; kind: ViewKind; query: ViewQuery; showGroup?: boolean }) {
  const { dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const viewsRef = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false), open)
  useOutside(viewsRef, () => setViewsOpen(false), viewsOpen)

  const fields = fieldOptions(project)
  const views = project.views.filter(v => v.view === kind)
  const f = query.filter
  const search = f.conditions.find(c => c.key === 'name' && c.op === 'contains')

  const setConditions = (conditions: Condition[]) => query.setFilter({ ...f, conditions })
  const update = (n: number, patch: Partial<Condition>) =>
    setConditions(f.conditions.map((c, x) => (x === n ? { ...c, ...patch } : c)))

  const setSearch = (text: string) => {
    const rest = f.conditions.filter(c => !(c.key === 'name' && c.op === 'contains'))
    query.setFilter({ ...f, conditions: text ? [{ key: 'name', op: 'contains', value: text }, ...rest] : rest })
  }

  const saveView = async (personal: boolean) => {
    const name = await askText('Name this view')
    if (!name) return
    const view: SavedView = { id: uid(), name, view: kind, filter: f, groupBy: query.groupBy, rowsBy: query.rowsBy, sort: query.sort, hidden: query.hidden, showCompleted: query.showCompleted, chartType: kind === 'chart' ? query.chartType : undefined, ...(personal && { personal: true }) }
    dispatch({ type: 'patchProject', id: project.id, patch: { views: [...project.views, view] } })
  }

  const deleteView = (id: string) => {
    dispatch({ type: 'patchProject', id: project.id, patch: { views: project.views.filter(v => v.id !== id) } })
  }

  const toggleFavourite = (id: string) => {
    dispatch({ type: 'patchProject', id: project.id, patch: { views: project.views.map(v => (v.id === id ? { ...v, favourite: !v.favourite } : v)) } })
  }

  const active = f.conditions.filter(c => !(c.key === 'name' && c.op === 'contains')).length

  const viewRow = (v: SavedView) => (
    <div key={v.id} className="popover-row">
      <button className="popover-item grow" onClick={() => { query.applyView(v); setViewsOpen(false) }}>{v.name}</button>
      <button className="fav-btn" aria-label={`Favourite ${v.name}`} aria-pressed={!!v.favourite} onClick={() => toggleFavourite(v.id)}>{v.favourite ? '★' : '☆'}</button>
      <button className="icon-btn" aria-label={`Delete ${v.name}`} onClick={() => deleteView(v.id)}>{ICONS.close}</button>
    </div>
  )

  return (
    <div className="filter-bar">
      <input className="filter-search" placeholder="Search titles" value={search?.value as string ?? ''} onChange={e => setSearch(e.target.value)} />

      <div className="menu" ref={ref}>
        <button className={clsx('btn', active > 0 && 'primary')} onClick={() => setOpen(o => !o)}>
          Filter{active ? ` (${active})` : ''}
        </button>
        {open && (
          <div className="popover left filter-pop" role="dialog" aria-label="Filters">
            <label className="filter-match">
              Match
              <select className="field-input" value={f.match} onChange={e => query.setFilter({ ...f, match: e.target.value as 'all' | 'any' })}>
                <option value="all">all conditions</option>
                <option value="any">any condition</option>
              </select>
            </label>
            {f.conditions.map((c, n) => {
              if (c.key === 'name' && c.op === 'contains') return null
              const opts = valueOptions(project, c.key)
              const realN = f.conditions.indexOf(c)
              return (
                <div key={realN} className="filter-row">
                  <select className="field-input" value={c.key} onChange={e => update(realN, { key: e.target.value, value: undefined })}>
                    {fields.map(fd => (
                      <option key={fd.key} value={fd.key}>{fd.label}</option>
                    ))}
                  </select>
                  <select className="field-input" value={c.op} onChange={e => update(realN, { op: e.target.value as Condition['op'] })}>
                    {OPS.map(o => (
                      <option key={o.op} value={o.op}>{o.label}</option>
                    ))}
                  </select>
                  {(c.op === 'empty' || c.op === 'not_empty') ? null : opts && (c.op === 'is' || c.op === 'is_not') ? (
                    <select className="field-input" value={String(c.value ?? '')} onChange={e => update(realN, { value: e.target.value })}>
                      <option value="">Choose</option>
                      {opts.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="field-input" value={String(c.value ?? '')} onChange={e => update(realN, { value: e.target.value })} />
                  )}
                  <button className="icon-btn" aria-label="Remove condition" onClick={() => setConditions(f.conditions.filter((_, x) => x !== realN))}>{ICONS.close}</button>
                </div>
              )
            })}
            <div className="actions">
              <button className="btn subtle" onClick={() => setConditions([...f.conditions, { key: fields[0].key, op: 'is', value: '' }])}>{ICONS.plus} Add condition</button>
              {f.conditions.length > 0 && <button className="btn ghost" onClick={() => query.setFilter(emptyFilter())}>Clear</button>}
            </div>
          </div>
        )}
      </div>

      {showGroup && (
        <label className="inline-select">
          Group
          <select className="input-sm" value={query.groupBy ?? ''} onChange={e => query.setGroupBy(e.target.value || null)}>
            {groupOptions(project).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}

      {kind === 'board' && (
        <label className="inline-select">
          Rows
          <select className="input-sm" aria-label="Rows" value={query.rowsBy ?? ''} onChange={e => query.setRowsBy(e.target.value || null)}>
            {groupOptions(project).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}

      <label className="inline-select">
        <input type="checkbox" aria-label="Show completed" checked={query.showCompleted} onChange={e => query.setShowCompleted(e.target.checked)} />
        Show completed
      </label>

      <div className="menu" ref={viewsRef}>
        <button className="btn" onClick={() => setViewsOpen(o => !o)}>Views{views.length ? ` (${views.length})` : ''}</button>
        {viewsOpen && (
          <div className="popover left filter-pop" role="menu">
            {views.length === 0 && <div className="muted pad small">No saved views yet.</div>}
            {views.filter(v => !v.personal).map(viewRow)}
            {views.some(v => v.personal) && <div className="muted pad small">Personal</div>}
            {views.filter(v => v.personal).map(viewRow)}
            <button className="popover-item" onClick={() => { setViewsOpen(false); saveView(false) }}>{ICONS.plus} Save current as view</button>
            <button className="popover-item" aria-label="Save as personal view" onClick={() => { setViewsOpen(false); saveView(true) }}>{ICONS.plus} Save as personal view</button>
          </div>
        )}
      </div>
    </div>
  )
}
