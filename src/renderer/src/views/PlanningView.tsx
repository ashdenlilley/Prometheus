import { useState, type DragEvent } from 'react'
import type { Issue, Project } from '@shared/types'
import { todayISO } from '@shared/dates'
import { categoryOf, issueKey } from '@shared/model'
import { averageVelocity, capacityStatus, cyclePoints } from '@shared/planning'
import { useStore } from '../store'
import { clsx } from '../util'

export function PlanningView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const today = todayISO()
  const [picked, setPicked] = useState<string | null>(null)

  const cycles = data.cycles.filter(c => c.projectId === project.id && c.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const cycle = cycles.find(c => c.id === picked) ?? cycles[0]
  const issues = data.issues.filter(i => i.projectId === project.id && !i.archivedAt)
  const open = (i: Issue) => {
    const cat = categoryOf(project, i.status)
    return cat !== 'completed' && cat !== 'canceled'
  }
  const backlog = issues.filter(i => !i.cycleId && !i.triage && open(i))
  const inCycle = cycle ? issues.filter(i => i.cycleId === cycle.id) : []
  const planned = cycle ? cyclePoints(issues, cycle.id, project.statuses) : 0
  const { over } = capacityStatus(planned, cycle?.capacity)
  const suggested = Math.round(averageVelocity(data, project.id, today))

  const move = (issue: Issue, toCycle: boolean) => {
    if (!cycle) return
    dispatch({ type: 'patchIssue', id: issue.id, patch: { cycleId: toCycle ? cycle.id : undefined } })
  }
  const dropOn = (toCycle: boolean) => (e: DragEvent) => {
    e.preventDefault()
    const issue = issues.find(i => i.id === e.dataTransfer.getData('text/plain'))
    if (issue && !!issue.cycleId !== toCycle) move(issue, toCycle)
  }

  const row = (issue: Issue, toCycle: boolean) => (
    <div
      key={issue.id}
      className="planning-row"
      tabIndex={0}
      draggable
      onDragStart={e => e.dataTransfer.setData('text/plain', issue.id)}
      onKeyDown={e => {
        // Enter on the title button also bubbles here; only the row itself moves the issue.
        if (e.key === 'Enter' && e.target === e.currentTarget) move(issue, toCycle)
      }}
    >
      <span className="muted small">{issueKey(data, issue)}</span>
      <button type="button" className="planning-title" onClick={() => onOpen(issue.id)}>{issue.title}</button>
      <span className="muted small">{issue.estimate ?? ''}</span>
      <button
        type="button"
        className="icon-btn"
        aria-label={toCycle ? 'Move to cycle' : 'Move to backlog'}
        onClick={() => move(issue, toCycle)}
      >
        {toCycle ? '→' : '←'}
      </button>
    </div>
  )

  return (
    <div className="planning">
      {!cycle ? (
        <p className="muted small">No upcoming cycles. Create one in the Cycles view.</p>
      ) : (
        <div className="planning-head">
          <select className="field-input" aria-label="Planning cycle" value={cycle.id} onChange={e => setPicked(e.target.value)}>
            {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className={clsx('planning-load', over && 'over')}>
            Planned {planned} / {cycle.capacity !== undefined ? `Capacity ${cycle.capacity}` : 'no capacity'} pts
            {over && ' · Over capacity'}
          </span>
          <input
            type="number"
            className="field-input"
            aria-label="Cycle capacity"
            min={0}
            value={cycle.capacity ?? ''}
            onChange={e => dispatch({ type: 'patchCycle', id: cycle.id, patch: { capacity: e.target.value === '' ? undefined : Number(e.target.value) } })}
          />
          <span className="muted small">Suggested: {suggested} (avg velocity)</span>
          <button type="button" className="btn" onClick={() => dispatch({ type: 'patchCycle', id: cycle.id, patch: { capacity: suggested } })}>Use</button>
        </div>
      )}
      <div className="planning-cols">
        <section className="planning-col" onDragOver={e => e.preventDefault()} onDrop={dropOn(false)}>
          <h3 className="small">Backlog</h3>
          {backlog.map(i => row(i, true))}
        </section>
        {cycle && (
          <section className="planning-col" onDragOver={e => e.preventDefault()} onDrop={dropOn(true)}>
            <h3 className="small">{cycle.name}</h3>
            {inCycle.map(i => row(i, false))}
          </section>
        )}
      </div>
    </div>
  )
}
