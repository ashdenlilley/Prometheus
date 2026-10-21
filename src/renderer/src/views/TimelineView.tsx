import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { STATUSES, type Issue, type Project } from '@shared/types'
import { issueKey, useStore } from '../store'
import { addDays, clsx, dayDiff, fmtDate, parseISO, todayISO } from '../util'

export const LABEL_W = 260
const DAY = 28
const DRAG_SLOP = 3

type Mode = 'start' | 'end' | 'move'

interface Drag {
  id: string
  mode: Mode
  x0: number
  start: string
  due: string
  days: number
  moved: boolean
}

// New [start, due] for a drag at its current day offset.
function applyDrag(d: Drag): [string, string] {
  if (d.mode === 'move') return [addDays(d.start, d.days), addDays(d.due, d.days)]
  if (d.mode === 'start') {
    const s = addDays(d.start, d.days)
    return [s > d.due ? d.due : s, d.due]
  }
  const e = addDays(d.due, d.days)
  return [d.start, e < d.start ? d.start : e]
}

// Shared row layout for timeline and roadmap: sticky label column plus a track.
export function Row({
  label,
  width,
  todayX,
  className,
  children
}: {
  label: ReactNode
  width: number
  todayX?: number
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={clsx('tl-row', className)} style={{ width: LABEL_W + width }}>
      <div className="tl-label">{label}</div>
      <div className="tl-track" style={{ width }}>
        {todayX !== undefined && <div className="tl-today" style={{ left: todayX }} />}
        {children}
      </div>
    </div>
  )
}

export function TimelineView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const scroller = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragging = drag !== null
  const today = todayISO()

  const issues = data.issues.filter(i => i.projectId === project.id)
  const dated = issues.filter(
    (i): i is Issue & { startDate: string; dueDate: string } => !!i.startDate && !!i.dueDate
  )
  const cycles = data.cycles.filter(c => c.projectId === project.id)

  // Bars show the drag preview while dragging, so the range must include it.
  const rangeOf = (i: Issue & { startDate: string; dueDate: string }): [string, string] =>
    drag?.id === i.id ? applyDrag(drag) : [i.startDate, i.dueDate]

  const starts = [today, ...dated.map(i => rangeOf(i)[0]), ...cycles.map(c => c.startDate)]
  const ends = [today, ...dated.map(i => rangeOf(i)[1]), ...cycles.map(c => c.endDate)]
  const first = starts.reduce((a, b) => (a < b ? a : b))
  const last = ends.reduce((a, b) => (a > b ? a : b))
  const origin = addDays(first, -3)
  const days = dayDiff(origin, addDays(last, 7)) + 1
  const width = days * DAY
  const x = (d: string) => dayDiff(origin, d) * DAY
  const span = (a: string, b: string) => (dayDiff(a, b) + 1) * DAY
  const todayX = x(today) + DAY / 2
  const dayCells = Array.from({ length: days }, (_, n) => addDays(origin, n))

  useLayoutEffect(() => {
    scroller.current?.scrollTo({ left: Math.max(0, LABEL_W + todayX - 400) })
  }, [project.id])

  // Window listeners exist only while a drag is in progress.
  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.x0
      const next = { ...d, days: Math.round(dx / DAY), moved: d.moved || Math.abs(dx) > DRAG_SLOP }
      dragRef.current = next
      setDrag(next)
    }
    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return
      if (!d.moved) {
        onOpen(d.id)
        return
      }
      const [start, due] = applyDrag(d)
      if (start !== d.start || due !== d.due) {
        dispatch({ type: 'patchIssue', id: d.id, patch: { startDate: start, dueDate: due } })
      }
    }
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [dragging])

  const begin = (e: ReactMouseEvent, i: Issue & { startDate: string; dueDate: string }, mode: Mode) => {
    e.preventDefault()
    e.stopPropagation()
    const d: Drag = { id: i.id, mode, x0: e.clientX, start: i.startDate, due: i.dueDate, days: 0, moved: false }
    dragRef.current = d
    setDrag(d)
  }

  return (
    <div className="timeline" ref={scroller}>
      <Row label="Item" width={width} className="tl-head">
        {dayCells.map((d, n) => {
          const d0 = parseISO(d)
          const showMonth = n === 0 || d0.getDate() === 1
          return (
            <div key={d} className="tl-day" style={{ left: n * DAY, width: DAY }}>
              {showMonth && <span className="tl-month">{d0.toLocaleDateString(undefined, { month: 'short' })}</span>}
              {d0.getDate()}
            </div>
          )
        })}
      </Row>

      {cycles.map(c => (
        <Row key={c.id} label={<b>{c.name}</b>} width={width} todayX={todayX}>
          <div className="tl-cycle" style={{ left: x(c.startDate), width: span(c.startDate, c.endDate) }} />
        </Row>
      ))}

      {dated.map(i => {
        const color = STATUSES.find(s => s.id === i.status)!.color
        const [s, e] = rangeOf(i)
        const active = drag?.id === i.id
        return (
          <Row
            key={i.id}
            label={
              <>
                <span className="muted">{issueKey(data, i)}</span> {i.title}
              </>
            }
            width={width}
            todayX={todayX}
          >
            <div
              className={clsx('tl-bar', active && 'dragging')}
              style={{ left: x(s), width: span(s, e), background: color }}
              onMouseDown={ev => begin(ev, i, 'move')}
              title={`${fmtDate(s)} – ${fmtDate(e)}`}
            >
              <span className="tl-handle left" onMouseDown={ev => begin(ev, i, 'start')} />
              <span className="tl-bar-label">{active ? `${fmtDate(s)} – ${fmtDate(e)}` : i.title}</span>
              <span className="tl-handle right" onMouseDown={ev => begin(ev, i, 'end')} />
            </div>
          </Row>
        )
      })}

      {issues.length > dated.length && (
        <div className="muted pad">{issues.length - dated.length} issues without start/due dates are not shown.</div>
      )}
    </div>
  )
}
