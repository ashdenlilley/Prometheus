import { useState } from 'react'
import type { Project } from '@shared/types'
import { ACTIVITY_FIELDS, page, projectActivity } from '@shared/activity'
import { issueKey, useStore } from '../store'

const PAGE_SIZE = 50

// Project-wide activity log: every issue's history and comments, newest first.
export function ActivityView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data } = useStore()
  const [issueId, setIssueId] = useState('')
  const [field, setField] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const issues = data.issues.filter(i => i.projectId === project.id).sort((a, b) => a.number - b.number)
  const entries = projectActivity(data, project.id, { issueId: issueId || undefined, field: field || undefined, from: from || undefined, to: to || undefined })
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const current = Math.min(pageIndex, pages - 1)
  // A changed filter starts again from the newest page.
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v)
    setPageIndex(0)
  }

  return (
    <div className="view activity">
      <div className="toolbar">
        <select className="field-input" aria-label="Activity issue" value={issueId} onChange={e => filter(setIssueId)(e.target.value)}>
          <option value="">All issues</option>
          {issues.map(i => (
            <option key={i.id} value={i.id}>{issueKey(data, i)} {i.title}</option>
          ))}
        </select>
        <select className="field-input" aria-label="Activity field" value={field} onChange={e => filter(setField)(e.target.value)}>
          <option value="">All fields</option>
          {ACTIVITY_FIELDS.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <input className="field-input" type="date" aria-label="Activity from" value={from} onChange={e => filter(setFrom)(e.target.value)} />
        <input className="field-input" type="date" aria-label="Activity to" value={to} onChange={e => filter(setTo)(e.target.value)} />
      </div>

      {entries.length === 0 ? (
        <div className="muted small">No activity matches</div>
      ) : (
        <div className="widget-list">
          {page(entries, current, PAGE_SIZE).map((e, n) => (
            <div key={`${e.issueId}-${e.at}-${n}`} className="widget-row">
              <span className="muted small">{new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <button className="key-btn" onClick={() => onOpen(e.issueId)}>{e.key}</button>
              <span className="grow ellipsis">{e.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <button className="btn" disabled={current === 0} onClick={() => setPageIndex(current - 1)}>Newer</button>
        <span className="muted small">Page {current + 1} of {pages}</span>
        <button className="btn" disabled={current >= pages - 1} onClick={() => setPageIndex(current + 1)}>Older</button>
      </div>
    </div>
  )
}
