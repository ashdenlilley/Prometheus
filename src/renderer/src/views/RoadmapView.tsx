import type { Project } from '@shared/types'
import { useStore } from '../store'
import { Row } from './TimelineView'
import { addDays, dayDiff, parseISO, progress, todayISO, toISO } from '../util'

const DAY_W = 5

// First day of the month that is `add` months away from the month containing `s`.
const monthOf = (s: string, add = 0) => {
  const d = parseISO(s)
  return toISO(new Date(d.getFullYear(), d.getMonth() + add, 1))
}

export function RoadmapView({ projects }: { projects: Project[] }) {
  const { data, dispatch } = useStore()
  const today = todayISO()

  const rows = projects.map(p => ({
    project: p,
    start: p.startDate ?? today,
    end: p.targetDate ?? addDays(today, 90),
    issues: data.issues.filter(i => i.projectId === p.id)
  }))

  const first = [today, ...rows.map(r => r.start)].reduce((a, b) => (a < b ? a : b))
  const last = [today, ...rows.map(r => r.end)].reduce((a, b) => (a > b ? a : b))
  const origin = monthOf(first)
  const stop = monthOf(last, 1)
  const trackW = dayDiff(origin, stop) * DAY_W
  const x = (d: string) => dayDiff(origin, d) * DAY_W
  const todayX = x(today)

  const months: { key: string; label: string; x: number; w: number }[] = []
  for (let m = origin; m < stop; m = monthOf(m, 1)) {
    months.push({
      key: m,
      label: parseISO(m).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      x: x(m),
      w: dayDiff(m, monthOf(m, 1)) * DAY_W
    })
  }

  return (
    <div className="view roadmap">
      <Row label="Project" width={trackW} className="tl-head">
        {months.map(m => (
          <div key={m.key} className="tl-day month" style={{ left: m.x, width: m.w }}>
            {m.label}
          </div>
        ))}
      </Row>

      {rows.map(({ project: p, start, end, issues }) => {
        const pr = progress(issues)
        const left = x(start)
        return (
          <Row
            key={p.id}
            className="roadmap-row"
            width={trackW}
            todayX={todayX}
            label={
              <>
                <div className="proj-name">
                  <span className="dot" style={{ background: p.color }} />
                  {p.name} <span className="muted">{pr.pct}%</span>
                </div>
                <div className="date-pair">
                  <input
                    type="date"
                    value={p.startDate ?? ''}
                    onChange={e => dispatch({ type: 'patchProject', id: p.id, patch: { startDate: e.target.value || undefined } })}
                  />
                  →
                  <input
                    type="date"
                    value={p.targetDate ?? ''}
                    onChange={e => dispatch({ type: 'patchProject', id: p.id, patch: { targetDate: e.target.value || undefined } })}
                  />
                </div>
              </>
            }
          >
            <div className="rm-bar" style={{ left, width: Math.max(DAY_W * 4, x(end) - left), borderColor: p.color }}>
              <div className="rm-fill" style={{ width: `${pr.pct}%`, background: p.color }} />
            </div>
          </Row>
        )
      })}
    </div>
  )
}
