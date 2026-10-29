import { useState } from 'react'
import type { Project } from '@shared/types'
import { todayISO } from '@shared/dates'
import { workloadBuckets, weekStarts } from '@shared/workload'
import { useStore } from '../store'
import { fmtDate } from '../util'

export function WorkloadView({ project }: { project: Project }) {
  const { data, dispatch } = useStore()
  const [from, setFrom] = useState(todayISO())
  const [weeks, setWeeks] = useState(4)
  const [measure, setMeasure] = useState<'points' | 'count'>('points')

  const issues = data.issues.filter(i => i.projectId === project.id && !i.archivedAt)
  const rows = workloadBuckets(issues, { from, weeks, measure, statuses: project.statuses })
  const starts = weekStarts(from, weeks)

  const setCapacity = (person: string, value: string) => {
    const capacity = { ...project.capacity }
    if (value === '') delete capacity[person]
    else capacity[person] = Number(value)
    dispatch({ type: 'patchProject', id: project.id, patch: { capacity } })
  }

  return (
    <div className="workload">
      <div className="planning-head">
        <label className="muted small">
          Start week <input type="date" className="field-input" aria-label="Start week" value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
        </label>
        <select className="field-input" aria-label="Weeks" value={weeks} onChange={e => setWeeks(Number(e.target.value))}>
          {[4, 8, 12].map(n => <option key={n} value={n}>{n} weeks</option>)}
        </select>
        <select className="field-input" aria-label="Workload measure" value={measure} onChange={e => setMeasure(e.target.value as 'points' | 'count')}>
          <option value="points">Points</option>
          <option value="count">Issues</option>
        </select>
      </div>
      {!rows.length ? (
        <p className="muted small">No assigned issues with a due date in this range.</p>
      ) : (
        <table className="workload-table">
          <thead>
            <tr>
              <th>Assignee</th>
              <th>Capacity</th>
              {starts.map(s => <th key={s}>{fmtDate(s)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const cap = project.capacity?.[row.person]
              return (
                <tr key={row.person}>
                  <td>{row.person}</td>
                  <td>
                    <input
                      type="number"
                      className="field-input"
                      aria-label={`Capacity for ${row.person}`}
                      min={0}
                      value={cap ?? ''}
                      onChange={e => setCapacity(row.person, e.target.value)}
                    />
                  </td>
                  {row.weeks.map((v, n) => {
                    const over = measure === 'points' && cap !== undefined && v > cap
                    const title = over ? `${row.person}: ${+v.toFixed(1)} of ${cap} pts` : undefined
                    return (
                      <td key={starts[n]} className={over ? 'over' : undefined} title={title}>
                        {+v.toFixed(1)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
