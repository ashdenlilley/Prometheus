import { useState } from 'react'
import type { Project } from '@shared/types'
import { useStore } from '../store'
import { IssueRow } from '../components/IssueRow'
import { addDays, fmtDate, progress, todayISO, uid } from '../util'

export function CyclesView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const today = todayISO()
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(addDays(today, 13))

  const cycles = data.cycles
    .filter(c => c.projectId === project.id)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const issues = data.issues.filter(i => i.projectId === project.id)
  const unassigned = issues.filter(i => !i.cycleId && i.status !== 'done' && i.status !== 'canceled')

  const create = () => {
    if (!name.trim()) return
    dispatch({
      type: 'addCycle',
      cycle: { id: uid(), projectId: project.id, name: name.trim(), startDate, endDate }
    })
    setName('')
  }

  const remove = (id: string, label: string) => {
    if (window.confirm(`Delete "${label}"? Its issues stay in the project.`)) {
      dispatch({ type: 'deleteCycle', id })
    }
  }

  return (
    <div className="view">
      <div className="toolbar cycle-form">
        <input className="input-sm" placeholder="Cycle name" value={name} onChange={e => setName(e.target.value)} />
        <input className="input-sm" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <input className="input-sm" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <button className="btn primary" onClick={create}>New cycle</button>
      </div>

      {cycles.map(c => {
        const inCycle = issues.filter(i => i.cycleId === c.id)
        const p = progress(inCycle)
        const active = c.startDate <= today && today <= c.endDate
        return (
          <section key={c.id} className="cycle">
            <div className="group-head">
              <span>{c.name}</span>
              {active && <span className="tag accent">Active</span>}
              <span className="muted">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</span>
              <span className="grow" />
              <span className="muted">{p.done}/{p.total} done</span>
              <button className="btn danger" onClick={() => remove(c.id, c.name)}>Delete</button>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${p.pct}%` }} />
            </div>
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
