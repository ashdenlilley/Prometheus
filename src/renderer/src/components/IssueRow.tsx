import type { Issue } from '@shared/types'
import { issueKey, useStore } from '../store'
import { fmtDate } from '../util'
import { PriorityText, StatusDot } from './fields'

export function IssueRow({ issue, onOpen }: { issue: Issue; onOpen: (id: string) => void }) {
  const { data } = useStore()
  return (
    <div className="row" onClick={() => onOpen(issue.id)}>
      <StatusDot status={issue.status} />
      <span className="muted key">{issueKey(data, issue)}</span>
      <span className="grow">{issue.title}</span>
      {issue.labels.map(l => (
        <span key={l} className="tag">{l}</span>
      ))}
      <PriorityText value={issue.priority} />
      {issue.dueDate && <span className="muted">{fmtDate(issue.dueDate)}</span>}
      <span className="muted assignee">{issue.assignee}</span>
    </div>
  )
}
