import type { Issue, Project } from '@shared/types'
import { issueKey, useStore } from '../store'
import { fmtDate } from '../util'
import { PriorityText, StatusDot } from './fields'
import { FavGutter } from './FavGutter'

export function IssueRow({ issue, onOpen, fav = true }: { issue: Issue; onOpen: (id: string) => void; fav?: boolean }) {
  const { data } = useStore()
  const project = data.projects.find(p => p.id === issue.projectId) as Project | undefined
  const status = project?.statuses.find(s => s.id === issue.status)
  return (
    <div className="row fav-host" onClick={() => onOpen(issue.id)}>
      {fav && <FavGutter issue={issue} />}
      {status && <StatusDot status={status} />}
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
