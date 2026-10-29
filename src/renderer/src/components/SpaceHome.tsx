import { useState } from 'react'
import type { Project, Space } from '@shared/types'
import { categoryOf } from '@shared/model'
import { progress } from '@shared/query'
import { useStore } from '../store'
import { ICONS } from './icons'
import { fmtDate, clsx, uid } from '../util'
import { LABEL_COLORS } from '../columns'
import { SpaceLabels } from './SpaceLabels'

interface SpaceHomeProps {
  space: Space
  onOpenProject: (projectId: string) => void
  onNewProject: () => void
  onDeleted: () => void
}

// Overview of one space: initiatives, every project in it, with progress.
export function SpaceHome({ space, onOpenProject, onNewProject, onDeleted }: SpaceHomeProps) {
  const { data, dispatch } = useStore()
  const [name, setName] = useState(space.name)
  const projects = data.projects.filter(p => p.spaceId === space.id)
  const issues = data.issues.filter(i => projects.some(p => p.id === i.projectId) && !i.triage && !i.archivedAt)
  const doneOf = (p: Project) => data.issues.filter(i => i.projectId === p.id)
  const totals = projects.reduce(
    (acc, p) => {
      const pr = progress(doneOf(p), p.statuses)
      return { done: acc.done + pr.done, total: acc.total + pr.total }
    },
    { done: 0, total: 0 }
  )
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0
  const open = issues.filter(i => {
    const c = categoryOf(projects.find(p => p.id === i.projectId), i.status)
    return c !== 'completed' && c !== 'canceled'
  }).length
  const initiatives = data.initiatives.filter(i => i.spaceId === space.id)
  const [initiativeName, setInitiativeName] = useState('')

  const rename = () => {
    const next = name.trim()
    if (!next) return setName(space.name)
    if (next !== space.name) dispatch({ type: 'patchSpace', id: space.id, patch: { name: next } })
  }

  const remove = () => {
    if (!window.confirm(`Delete space "${space.name}" and its ${projects.length} project(s)?`)) return
    dispatch({ type: 'deleteSpace', id: space.id })
    onDeleted()
  }

  const addInitiative = () => {
    if (!initiativeName.trim()) return
    dispatch({
      type: 'addInitiative',
      initiative: {
        id: uid(),
        spaceId: space.id,
        name: initiativeName.trim(),
        color: LABEL_COLORS[initiatives.length % LABEL_COLORS.length],
        status: 'active'
      }
    })
    setInitiativeName('')
  }

  return (
    <div className="view space-home">
      <header className="space-hero">
        <span className="space-hero-chip" style={{ background: space.color }}>{space.name.slice(0, 1).toUpperCase()}</span>
        <div className="space-hero-text">
          <input
            className="space-title"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Space name"
          />
          <div className="muted">{projects.length} projects · {open} open issues · {pct}% complete</div>
        </div>
        <button className="btn danger ghost" onClick={remove}>{ICONS.trash} Delete space</button>
      </header>

      <div className="stat-row">
        <Stat label="Projects" value={projects.length} />
        <Stat label="Open issues" value={open} />
        <Stat label="Done" value={totals.done} />
        <Stat label="Completion" value={`${pct}%`} />
      </div>

      <div className="section-title-row">
        <h2>Initiatives</h2>
      </div>
      <div className="initiative-list">
        {initiatives.map(i => {
          const linked = projects.filter(p => p.initiativeId === i.id)
          const all = linked.flatMap(p => doneOf(p))
          const pr = linked.length ? progress(all, linked.flatMap(p => p.statuses)) : { pct: 0, done: 0, total: 0 }
          return (
            <div key={i.id} className="initiative-card">
              <div className="initiative-name">
                <span className="dot" style={{ background: i.color }} /> {i.name}
                <button className="icon-btn" aria-label="Remove initiative" onClick={() => dispatch({ type: 'deleteInitiative', id: i.id })}>{ICONS.close}</button>
              </div>
              <div className="bar"><div className="bar-fill" style={{ width: `${pr.pct}%`, background: i.color }} /></div>
              <div className="muted small">{linked.length} projects · {pr.pct}%{i.targetDate ? ` · target ${fmtDate(i.targetDate)}` : ''}</div>
            </div>
          )
        })}
        <div className="initiative-add">
          <input className="quick-add" placeholder="+ New initiative" value={initiativeName} onChange={e => setInitiativeName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addInitiative()} />
        </div>
      </div>

      <div className="section-title-row">
        <h2>Projects</h2>
        <button className="btn primary" onClick={onNewProject}>{ICONS.plus} New project</button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-block">
          <p>No projects in this space yet.</p>
          <button className="btn primary" onClick={onNewProject}>{ICONS.plus} New project</button>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map(p => {
            const mine = doneOf(p)
            const pr = progress(mine, p.statuses)
            const active = mine.filter(i => p.statuses.find(s => s.id === i.status)?.category === 'started').length
            return (
              <button key={p.id} className="project-card" onClick={() => onOpenProject(p.id)}>
                <div className="project-card-head">
                  <span className="project-chip lg" style={{ background: p.color }}>{p.key.slice(0, 2)}</span>
                  <div className="grow minw0">
                    <div className="project-card-title ellipsis">{p.name}</div>
                    <div className="muted small">{p.key} · {mine.length} issues · {p.status.replace('_', ' ')}</div>
                  </div>
                  <span className={clsx('pct-badge', pr.pct === 100 && 'complete')}>{pr.pct}%</span>
                </div>
                <div className="bar"><div className="bar-fill" style={{ width: `${pr.pct}%`, background: p.color }} /></div>
                <div className="project-card-foot muted small">
                  <span>{pr.done}/{pr.total} done</span>
                  <span>{active} in progress</span>
                  {p.targetDate && <span>Target {fmtDate(p.targetDate)}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
      <SpaceLabels space={space} />
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
