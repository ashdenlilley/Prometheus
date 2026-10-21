import { useEffect } from 'react'
import type { Issue } from '@shared/types'
import { issueKey, useStore, withValue } from '../store'
import { CellEditor, PrioritySelect, StatusSelect } from './fields'

export function IssueDetail({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { data, dispatch } = useStore()
  const issue = data.issues.find(i => i.id === issueId)
  const project = data.projects.find(p => p.id === issue?.projectId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!issue || !project) return null

  const patch = (p: Partial<Issue>) => dispatch({ type: 'patchIssue', id: issue.id, patch: p })
  const cycles = data.cycles.filter(c => c.projectId === project.id)

  const remove = () => {
    if (!window.confirm(`Delete ${issueKey(data, issue)}?`)) return
    dispatch({ type: 'deleteIssue', id: issue.id })
    onClose()
  }

  return (
    <div className="overlay drawer-overlay" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={e => e.stopPropagation()}>
        <div className="panel-head">
          <span className="muted">{issueKey(data, issue)}</span>
          <div className="row-gap">
            <button className="btn danger" onClick={remove}>Delete</button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <input className="title-input" value={issue.title} onChange={e => patch({ title: e.target.value })} />
        <textarea
          className="desc"
          placeholder="Add description..."
          value={issue.description}
          onChange={e => patch({ description: e.target.value })}
        />

        <div className="fields">
          <label>
            Status
            <StatusSelect value={issue.status} onChange={status => patch({ status })} />
          </label>
          <label>
            Priority
            <PrioritySelect value={issue.priority} onChange={priority => patch({ priority })} />
          </label>
          <label>
            Assignee
            <input className="input-sm" value={issue.assignee} onChange={e => patch({ assignee: e.target.value })} />
          </label>
          <label>
            Labels
            <input
              className="input-sm"
              defaultValue={issue.labels.join(', ')}
              placeholder="bug, ui"
              onBlur={e => patch({ labels: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            />
          </label>
          <label>
            Cycle
            <select
              className="input-sm"
              value={issue.cycleId ?? ''}
              onChange={e => patch({ cycleId: e.target.value || undefined })}
            >
              <option value="">None</option>
              {cycles.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Start
            <input
              className="input-sm"
              type="date"
              value={issue.startDate ?? ''}
              onChange={e => patch({ startDate: e.target.value || undefined })}
            />
          </label>
          <label>
            Due
            <input
              className="input-sm"
              type="date"
              value={issue.dueDate ?? ''}
              onChange={e => patch({ dueDate: e.target.value || undefined })}
            />
          </label>
          {project.columns.map(col => (
            <label key={col.id}>
              {col.name}
              <CellEditor
                column={col}
                value={issue.values[col.id]}
                onChange={v => patch({ values: withValue(issue.values, col.id, v) })}
              />
            </label>
          ))}
        </div>
      </aside>
    </div>
  )
}
