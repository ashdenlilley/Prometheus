import { useState } from 'react'
import type { Dashboard, Issue, Space, Widget, WidgetType } from '@shared/types'
import { categoryOf } from '@shared/model'
import { progress } from '@shared/query'
import { Burndown } from './CyclesView'
import { issueKey, useStore } from '../store'
import { ICONS } from '../components/icons'
import { askText, Modal } from '../components/ui'
import { fmtDate, todayISO, uid, clsx } from '../util'

const WIDGET_TYPES: { type: WidgetType; label: string }[] = [
  { type: 'numbers', label: 'Numbers' },
  { type: 'progress', label: 'Progress by project' },
  { type: 'chart', label: 'Chart by status' },
  { type: 'workload', label: 'Workload by person' },
  { type: 'overdue', label: 'Overdue' },
  { type: 'list', label: 'Open issues' },
  { type: 'milestones', label: 'Milestones' },
  { type: 'cycle', label: 'Active cycle' }
]

// Space dashboards: widgets over every project in the space, or one project.
export function DashboardView({ space }: { space: Space }) {
  const { data, dispatch } = useStore()
  const boards = data.dashboards.filter(d => d.spaceId === space.id)
  const [activeId, setActiveId] = useState<string | null>(boards[0]?.id ?? null)
  const [adding, setAdding] = useState(false)
  const board = boards.find(b => b.id === activeId) ?? boards[0]

  const newBoard = async () => {
    const name = await askText('Dashboard name', 'Dashboard')
    if (!name) return
    const dashboard: Dashboard = { id: uid(), spaceId: space.id, name, widgets: [] }
    dispatch({ type: 'addDashboard', dashboard })
    setActiveId(dashboard.id)
  }

  const removeWidget = (w: Widget) => {
    if (!board) return
    dispatch({ type: 'patchDashboard', id: board.id, patch: { widgets: board.widgets.filter(x => x.id !== w.id) } })
  }

  return (
    <div className="view dashboard">
      <div className="toolbar">
        {boards.map(b => (
          <button key={b.id} className={clsx('btn', b.id === board?.id && 'primary')} onClick={() => setActiveId(b.id)}>{b.name}</button>
        ))}
        <button className="btn" onClick={newBoard}>{ICONS.plus} New dashboard</button>
        <span className="grow" />
        {board && (
          <>
            <button className="btn" onClick={() => setAdding(true)}>{ICONS.plus} Add widget</button>
            <button
              className="btn danger ghost"
              onClick={() => {
                if (window.confirm(`Delete dashboard "${board.name}"?`)) dispatch({ type: 'deleteDashboard', id: board.id })
              }}
            >
              {ICONS.trash}
            </button>
          </>
        )}
      </div>

      {!board && (
        <div className="empty-block">
          <p>No dashboards yet. A dashboard shows numbers, charts and lists across the space.</p>
          <button className="btn primary" onClick={newBoard}>{ICONS.plus} New dashboard</button>
        </div>
      )}

      {board && (
        <div className="widget-grid">
          {board.widgets.map(w => (
            <section key={w.id} className="widget">
              <div className="widget-head">
                <span>{w.title}</span>
                <button className="icon-btn" aria-label="Remove widget" onClick={() => removeWidget(w)}>{ICONS.close}</button>
              </div>
              <WidgetBody widget={w} spaceId={space.id} />
            </section>
          ))}
          {board.widgets.length === 0 && <div className="muted">Add a widget to start.</div>}
        </div>
      )}

      {adding && board && <AddWidget boardId={board.id} spaceId={space.id} onClose={() => setAdding(false)} />}
    </div>
  )
}

function scopeIssues(data: { issues: Issue[]; projects: { id: string; spaceId: string }[] }, spaceId: string, projectId?: string) {
  const ids = data.projects.filter(p => p.spaceId === spaceId && (!projectId || p.id === projectId)).map(p => p.id)
  return data.issues.filter(i => ids.includes(i.projectId) && !i.triage)
}

function WidgetBody({ widget, spaceId }: { widget: Widget; spaceId: string }) {
  const { data } = useStore()
  const issues = scopeIssues(data, spaceId, widget.projectId)
  const projects = data.projects.filter(p => p.spaceId === spaceId && (!widget.projectId || p.id === widget.projectId))
  const today = todayISO()
  const open = issues.filter(i => {
    const c = categoryOf(data.projects.find(p => p.id === i.projectId), i.status)
    return c !== 'completed' && c !== 'canceled'
  })
  const overdue = open.filter(i => i.dueDate && i.dueDate < today).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))

  switch (widget.type) {
    case 'numbers':
      return (
        <div className="stat-row">
          <Stat label="Open" value={open.length} />
          <Stat label="Overdue" value={overdue.length} />
          <Stat label="Done" value={issues.length - open.length} />
          <Stat label="Completion" value={`${progress(issues, projects.flatMap(p => p.statuses)).pct}%`} />
        </div>
      )
    case 'progress':
      return (
        <div className="widget-list">
          {projects.map(p => {
            const pr = progress(issues.filter(i => i.projectId === p.id), p.statuses)
            return (
              <div key={p.id} className="widget-row">
                <span className="ellipsis">{p.name}</span>
                <div className="bar"><div className="bar-fill" style={{ width: `${pr.pct}%`, background: p.color }} /></div>
                <span className="muted small">{pr.pct}%</span>
              </div>
            )
          })}
        </div>
      )
    case 'chart': {
      const statuses = projects[0]?.statuses ?? []
      const counts = statuses.map(s => ({ s, n: issues.filter(i => i.status === s.id).length }))
      const max = Math.max(1, ...counts.map(c => c.n))
      return (
        <div className="chart small">
          {counts.map(c => (
            <div key={c.s.id} className="chart-col">
              <span className="muted small">{c.n}</span>
              <div className="chart-bar" style={{ height: `${(c.n / max) * 120}px`, background: c.s.color }} />
              <span className="small chart-label">{c.s.label}</span>
            </div>
          ))}
        </div>
      )
    }
    case 'workload': {
      const people = new Map<string, { n: number; pts: number }>()
      for (const i of open) {
        const key = i.assignee || 'Unassigned'
        const cur = people.get(key) ?? { n: 0, pts: 0 }
        people.set(key, { n: cur.n + 1, pts: cur.pts + (i.estimate ?? 0) })
      }
      return (
        <div className="widget-list">
          {[...people.entries()].map(([name, v]) => (
            <div key={name} className="widget-row">
              <span className="ellipsis">{name}</span>
              <span className="muted small">{v.n} open · {v.pts} pts</span>
            </div>
          ))}
          {people.size === 0 && <div className="muted small">Nothing open.</div>}
        </div>
      )
    }
    case 'milestones': {
      const items = projects
        .flatMap(p => p.milestones.map(m => ({ p, m })))
        .sort((a, b) => (a.m.date ?? '9999').localeCompare(b.m.date ?? '9999'))
      if (items.length === 0) return <div className="muted small">No milestones.</div>
      return (
        <div className="widget-list">
          {items.map(({ p, m }) => (
            <div key={m.id} className="widget-row">
              <span className={clsx('rm-milestone-dot', m.done && 'done')} />
              <span className="grow ellipsis">{m.name}</span>
              <span className="muted small">{p.name}</span>
              <span className="muted small">{m.date ? fmtDate(m.date) : 'No date'}</span>
            </div>
          ))}
        </div>
      )
    }
    case 'cycle': {
      const active = data.cycles.filter(c => projects.some(p => p.id === c.projectId) && c.startDate <= today && today <= c.endDate)
      if (active.length === 0) return <div className="muted small">No active cycle.</div>
      return (
        <div className="widget-list">
          {active.map(c => {
            const owner = data.projects.find(p => p.id === c.projectId)!
            const inCycle = issues.filter(i => i.cycleId === c.id)
            const pr = progress(inCycle, owner.statuses)
            return (
              <div key={c.id}>
                <div className="widget-row">
                  <span className="grow ellipsis">{owner.name} · {c.name}</span>
                  <span className="muted small">{pr.done}/{pr.total} done</span>
                </div>
                <Burndown cycle={c} issues={inCycle} statuses={owner.statuses} />
              </div>
            )
          })}
        </div>
      )
    }
    case 'overdue':
      return <IssueList issues={overdue} projectOf={i => data.projects.find(p => p.id === i.projectId)} extra={i => fmtDate(i.dueDate!)} emptyText="Nothing overdue." />
    case 'list':
      return <IssueList issues={open.slice(0, 20)} projectOf={i => data.projects.find(p => p.id === i.projectId)} emptyText="Nothing open." />
  }
}

function IssueList({
  issues,
  projectOf,
  extra,
  emptyText
}: {
  issues: Issue[]
  projectOf: (i: Issue) => { key: string; statuses: { id: string; label: string }[] } | undefined
  extra?: (i: Issue) => string
  emptyText: string
}) {
  const { data } = useStore()
  if (issues.length === 0) return <div className="muted small">{emptyText}</div>
  return (
    <div className="widget-list">
      {issues.map(i => {
        const p = projectOf(i)
        return (
          <div key={i.id} className="widget-row">
            <span className="muted key">{issueKey(data, i)}</span>
            <span className="grow ellipsis">{i.title}</span>
            <span className="muted small">{p?.statuses.find(s => s.id === i.status)?.label}</span>
            {extra && <span className="muted small">{extra(i)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label muted">{label}</div>
    </div>
  )
}

function AddWidget({ boardId, spaceId, onClose }: { boardId: string; spaceId: string; onClose: () => void }) {
  const { data, dispatch } = useStore()
  const board = data.dashboards.find(b => b.id === boardId)
  const [type, setType] = useState<WidgetType>('numbers')
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const projects = data.projects.filter(p => p.spaceId === spaceId)

  const add = () => {
    if (!board) return
    const label = WIDGET_TYPES.find(t => t.type === type)?.label ?? 'Widget'
    const widget: Widget = { id: uid(), type, title: title.trim() || label, projectId: projectId || undefined }
    dispatch({ type: 'patchDashboard', id: boardId, patch: { widgets: [...board.widgets, widget] } })
    onClose()
  }

  return (
    <Modal title="Add widget" onClose={onClose}>
      <div className="field">
        Type
        <div className="type-grid">
          {WIDGET_TYPES.map(t => (
            <button key={t.type} type="button" className={clsx('type-tile', type === t.type && 'on')} onClick={() => setType(t.type)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Scope
        <select className="field-input" value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">Whole space</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Title
        <input className="field-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={WIDGET_TYPES.find(t => t.type === type)?.label} />
      </label>
      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={add}>Add</button>
      </div>
    </Modal>
  )
}
