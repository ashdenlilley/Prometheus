import { useState } from 'react'
import type { Issue, Project } from '@shared/types'
import { addDays, parseISO, toISO, todayISO } from '@shared/dates'
import { useStore } from '../store'
import { clsx } from '../util'

// Month grid of issues by due date.
export function CalendarView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data } = useStore()
  const [month, setMonth] = useState(() => {
    const d = parseISO(todayISO())
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const first = toISO(month)
  const startDay = month.getDay()
  const gridStart = addDays(first, -startDay)
  const cells = Array.from({ length: 42 }, (_, n) => addDays(gridStart, n))
  const issues = data.issues.filter((i): i is Issue & { dueDate: string } => i.projectId === project.id && !!i.dueDate && !i.archivedAt)
  const today = todayISO()

  const shift = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <div className="view calendar">
      <div className="toolbar">
        <button className="btn" onClick={() => shift(-1)}>‹</button>
        <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button className="btn" onClick={() => shift(1)}>›</button>
        <button className="btn" onClick={() => setMonth(new Date(parseISO(today).getFullYear(), parseISO(today).getMonth(), 1))}>Today</button>
      </div>
      <div className="cal-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="cal-head muted small">{d}</div>
        ))}
        {cells.map(d => {
          const day = parseISO(d)
          const inMonth = day.getMonth() === month.getMonth()
          const items = issues.filter(i => i.dueDate === d)
          return (
            <div key={d} className={clsx('cal-cell', !inMonth && 'out', d === today && 'today')}>
              <div className="cal-day small">{day.getDate()}</div>
              {items.map(i => (
                <button key={i.id} className="cal-item" onClick={() => onOpen(i.id)}>{i.title}</button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
