import { useState } from 'react'
import type { Space } from '@shared/types'
import { useStore } from '../store'
import { ICONS } from './icons'
import { progress, fmtDate, clsx } from '../util'

interface SpaceHomeProps {
  space: Space
  onOpenProject: (projectId: string) => void
  onNewProject: () => void
  onDeleted: () => void
}

// Overview of one space: every project in it, with progress.
export function SpaceHome({ space, onOpenProject, onNewProject, onDeleted }: SpaceHomeProps) {
  const { data, dispatch } = useStore()
  const [name, setName] = useState(space.name)
  const projects = data.projects.filter(p => p.spaceId === space.id)
  const issues = data.issues.filter(i => projects.some(p => p.id === i.projectId))
  const totals = progress(issues)
  const open = issues.filter(i => i.status !== 'done' && i.status !== 'canceled').length

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
          <div className="muted">{projects.length} projects · {open} open issues · {totals.pct}% complete</div>
        </div>
        <button className="btn danger ghost" onClick={remove}>{ICONS.trash} Delete space</button>
      </header>

      <div className="stat-row">
        <Stat label="Projects" value={projects.length} />
        <Stat label="Open issues" value={open} />
        <Stat label="Done" value={totals.done} />
        <Stat label="Completion" value={`${totals.pct}%`} />
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
            const mine = data.issues.filter(i => i.projectId === p.id)
            const pr = progress(mine)
            const active = mine.filter(i => i.status === 'in_progress').length
            return (
              <button key={p.id} className="project-card" onClick={() => onOpenProject(p.id)}>
                <div className="project-card-head">
                  <span className="project-chip lg" style={{ background: p.color }}>{p.key.slice(0, 2)}</span>
                  <div className="grow minw0">
                    <div className="project-card-title ellipsis">{p.name}</div>
                    <div className="muted small">{p.key} · {mine.length} issues</div>
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
