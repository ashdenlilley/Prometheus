import { useEffect, useState } from 'react'
import type { Cycle, Issue, Project, StatusDef } from '@shared/types'
import { addDays, dayDiff, todayISO } from '@shared/dates'
import { categoryOf } from '@shared/model'
import { progress } from '@shared/query'
import { useStore } from '../store'
import { IssueRow } from '../components/IssueRow'
import { fmtDate, uid, clsx } from '../util'

export function CyclesView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const today = todayISO()
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(addDays(today, project.cycleLength - 1))

  const cycles = data.cycles.filter(c => c.projectId === project.id).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const issues = data.issues.filter(i => i.projectId === project.id)
  const unassigned = issues.filter(i => !i.cycleId && !i.triage && categoryOf(project, i.status) !== 'completed' && categoryOf(project, i.status) !== 'canceled')

  // Automatic cycles: append cycles until one covers today.
  useEffect(() => {
    if (!project.autoCycles) return
    const last = cycles[cycles.length - 1]
    let coverageEnd = last ? last.endDate : addDays(today, -1)
    let start = last ? addDays(last.endDate, 1) : today
    let n = cycles.length + 1
    const created: Cycle[] = []
    while (coverageEnd < today) {
      const end = addDays(start, project.cycleLength - 1)
      created.push({ id: uid(), projectId: project.id, name: `Cycle ${n}`, startDate: start, endDate: end })
      coverageEnd = end
      start = addDays(end, 1)
      n++
    }
    created.forEach(cycle => dispatch({ type: 'addCycle', cycle }))
    // Runs once per project switch or toggle; the cycle list is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.autoCycles])

  const create = () => {
    if (!name.trim()) return
    dispatch({ type: 'addCycle', cycle: { id: uid(), projectId: project.id, name: name.trim(), startDate, endDate } })
    setName('')
  }

  const remove = (c: Cycle) => {
    if (window.confirm(`Delete "${c.name}"? Its issues stay in the project.`)) dispatch({ type: 'deleteCycle', id: c.id })
  }

  const rollOver = (c: Cycle) => {
    const next = cycles[cycles.indexOf(c) + 1]
    if (!next) return window.alert('Create the next cycle first.')
    dispatch({ type: 'rollOverCycle', cycleId: c.id, toCycleId: next.id })
  }

  const velocity = cycles
    .filter(c => c.endDate < today)
    .map(c => ({ c, done: issues.filter(i => i.cycleId === c.id && categoryOf(project, i.status) === 'completed').length }))

  return (
    <div className="view">
      <div className="toolbar cycle-form">
        <input className="input-sm" placeholder="Cycle name" value={name} onChange={e => setName(e.target.value)} />
        <input className="input-sm" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <input className="input-sm" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <button className="btn primary" onClick={create}>New cycle</button>
        <label className="check-field">
          <input
            type="checkbox"
            checked={project.autoCycles}
            onChange={e => dispatch({ type: 'patchProject', id: project.id, patch: { autoCycles: e.target.checked } })}
          />
          Auto-create
        </label>
        <label className="inline-select">
          Length (days)
          <input
            className="input-sm"
            type="number"
            min={1}
            value={project.cycleLength}
            onChange={e => dispatch({ type: 'patchProject', id: project.id, patch: { cycleLength: Math.max(1, Number(e.target.value)) } })}
          />
        </label>
      </div>

      {velocity.length > 0 && (
        <section className="cycle">
          <div className="group-head">
            <span>Velocity</span>
            <span className="muted small">completed issues per past cycle</span>
          </div>
          <div className="velocity">
            {velocity.map(v => (
              <div key={v.c.id} className="velocity-bar" title={`${v.c.name}: ${v.done}`}>
                <div className="velocity-fill" style={{ height: `${Math.max(4, v.done * 12)}px` }} />
                <span className="muted small">{v.done}</span>
                <span className="muted small">{v.c.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {cycles.map(c => {
        const inCycle = issues.filter(i => i.cycleId === c.id)
        const p = progress(inCycle, project.statuses)
        const active = c.startDate <= today && today <= c.endDate
        return (
          <section key={c.id} className="cycle">
            <div className="group-head">
              <span>{c.name}</span>
              {active && <span className="tag accent">Active</span>}
              <span className="muted">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</span>
              <span className="grow" />
              <span className="muted">{p.done}/{p.total} done</span>
              <button className="btn" onClick={() => rollOver(c)} title="Move unfinished issues to the next cycle">Roll over</button>
              <button className="btn danger" onClick={() => remove(c)}>Delete</button>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${p.pct}%` }} />
            </div>
            <Burndown cycle={c} issues={inCycle} statuses={project.statuses} />
            {inCycle.map(i => (
              <IssueRow key={i.id} issue={i} onOpen={onOpen} />
            ))}
            {inCycle.length === 0 && <div className="muted pad">No issues in this cycle.</div>}
          </section>
        )
      })}

      <section className="cycle">
        <div className="group-head">
          <span>Unassigned open issues</span>
          <span className="count">{unassigned.length}</span>
        </div>
        {unassigned.map(i => (
          <div key={i.id} className="row-wrap">
            <IssueRow issue={i} onOpen={onOpen} />
            <select
              className="input-sm"
              value=""
              onChange={e => e.target.value && dispatch({ type: 'patchIssue', id: i.id, patch: { cycleId: e.target.value } })}
            >
              <option value="">Add to cycle...</option>
              {cycles.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ))}
      </section>
    </div>
  )
}

// Remaining work per day against an ideal straight line. Done dates come from completedAt.
export function Burndown({ cycle, issues, statuses }: { cycle: Cycle; issues: Issue[]; statuses: StatusDef[] }) {
  const live = issues.filter(i => statuses.find(s => s.id === i.status)?.category !== 'canceled')
  const total = live.length
  const span = Math.max(1, dayDiff(cycle.startDate, cycle.endDate))
  const today = todayISO()
  const lastDay = today < cycle.endDate ? today : cycle.endDate
  if (total === 0 || cycle.startDate > today) return null

  const W = 480
  const H = 120
  const x = (n: number) => (n / span) * W
  const y = (r: number) => H - (r / total) * H
  const points: string[] = []
  for (let n = 0; n <= dayDiff(cycle.startDate, lastDay); n++) {
    const day = addDays(cycle.startDate, n)
    const remaining = live.filter(i => !(i.completedAt && i.completedAt.slice(0, 10) <= day)).length
    points.push(`${x(n)},${y(remaining)}`)
  }
  return (
    <svg className="burndown" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Burndown for ${cycle.name}`}>
      <line x1={0} y1={y(total)} x2={W} y2={y(0)} className="burn-ideal" />
      <polyline points={points.join(' ')} className="burn-actual" fill="none" />
    </svg>
  )
}
