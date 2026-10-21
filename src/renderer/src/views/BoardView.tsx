import { useState } from 'react'
import type { Issue, Project } from '@shared/types'
import { applyFilter, groupIssues, progress } from '@shared/query'
import { createIssue, issueKey, useStore } from '../store'
import { PriorityText, StatusDot } from '../components/fields'
import { FilterBar, useViewQuery } from '../components/FilterBar'
import { BulkBar } from '../components/BulkBar'
import { QuickAdd } from '../components/ui'
import { FavGutter } from '../components/FavGutter'
import { clsx, fmtDate } from '../util'

// Columns group by any field. Dragging a card onto a column sets that field.
const DROPPABLE = ['status', 'priority', 'assignee', 'cycle', 'milestone']

function patchFor(groupBy: string, key: string): Partial<Issue> | null {
  switch (groupBy) {
    case 'status':
      return { status: key }
    case 'priority':
      return { priority: key === 'No priority' ? 0 : ['No priority', 'Urgent', 'High', 'Medium', 'Low'].indexOf(key) }
    case 'assignee':
      return { assignee: key === 'None' ? '' : key }
    case 'cycle':
      return { cycleId: undefined }
    case 'milestone':
      return { milestoneId: undefined }
  }
  return null
}

export function BoardView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const query = useViewQuery(project, 'board')
  const [target, setTarget] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const groupBy = query.groupBy ?? 'status'
  const issues = applyFilter(data.issues.filter(i => i.projectId === project.id && !i.triage), query.filter, project)
  const groups = groupIssues(
    issues,
    project,
    groupBy,
    id => data.cycles.find(c => c.id === id)?.name ?? '',
    id => project.milestones.find(m => m.id === id)?.name ?? ''
  )
  const canDrop = DROPPABLE.includes(groupBy)

  const drop = (issueId: string, groupKey: string) => {
    const patch = patchFor(groupBy, groupKey)
    if (!patch) return
    dispatch({ type: 'patchIssue', id: issueId, patch })
  }

  return (
    <div className="view">
      <div className="toolbar">
        <FilterBar project={project} kind="board" query={query} />
      </div>
      <BulkBar
        project={project}
        count={picked.size}
        onPatch={patch => {
          dispatch({ type: 'patchIssues', ids: [...picked], patch })
          setPicked(new Set())
        }}
        onDelete={() => {
          if (!window.confirm(`Delete ${picked.size} issues?`)) return
          dispatch({ type: 'deleteIssues', ids: [...picked] })
          setPicked(new Set())
        }}
        onClear={() => setPicked(new Set())}
      />
      <div className="board">
        {groups.map(g => {
          const status = groupBy === 'status' ? project.statuses.find(s => s.id === g.key) : undefined
          const limit = groupBy === 'status' ? project.wipLimits[g.key] : undefined
          const over = limit !== undefined && g.items.length > limit
          return (
            <div
              key={g.key}
              className={clsx('column', target === g.key && 'drop-target', over && 'over-limit')}
              onDragOver={e => {
                if (!canDrop) return
                e.preventDefault()
                setTarget(g.key)
              }}
              onDragLeave={() => setTarget(null)}
              onDrop={e => {
                e.preventDefault()
                setTarget(null)
                const id = e.dataTransfer.getData('text/plain')
                if (id) drop(id, g.key)
              }}
            >
              <div className="column-head">
                {status && <StatusDot status={status} />}
                <span>{g.label || 'All'}</span>
                <span className="count">{g.items.length}{limit !== undefined ? ` / ${limit}` : ''}</span>
              </div>
              {g.items.map(i => (
                <BoardCard
                  key={i.id}
                  issue={i}
                  project={project}
                  onOpen={onOpen}
                  picked={picked.has(i.id)}
                  onPick={() => setPicked(p => toggle(p, i.id))}
                />
              ))}
              {groupBy === 'status' && (
                <QuickAdd
                  onAdd={title =>
                    dispatch({ type: 'addIssue', issue: createIssue(data, project.id, title, { status: g.key }) })
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const toggle = (set: Set<string>, id: string) => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function BoardCard({
  issue,
  project,
  onOpen,
  picked,
  onPick
}: {
  issue: Issue
  project: Project
  onOpen: (id: string) => void
  picked: boolean
  onPick: () => void
}) {
  const { data } = useStore()
  const subs = data.issues.filter(i => i.parentId === issue.id)
  const sub = subs.length ? progress(subs, project.statuses) : null
  return (
    <div className={clsx('card fav-host', picked && 'picked')} draggable onDragStart={e => e.dataTransfer.setData('text/plain', issue.id)} onClick={() => onOpen(issue.id)}>
      <div className="card-title">
        <FavGutter issue={issue} />
        <input
          type="checkbox"
          className="card-check"
          checked={picked}
          aria-label={`Select ${issueKey(data, issue)}`}
          onClick={e => e.stopPropagation()}
          onChange={onPick}
        />
        {issue.title}
      </div>
      <div className="card-meta">
        <span className="muted">{issueKey(data, issue)}</span>
        <PriorityText value={issue.priority} />
        {issue.dueDate && <span className="muted">{fmtDate(issue.dueDate)}</span>}
        {issue.assignee && <span className="muted">{issue.assignee}</span>}
        {issue.estimate !== undefined && <span className="muted">{issue.estimate} pts</span>}
        {sub && <span className="muted">{sub.done}/{sub.total} sub</span>}
        {issue.labels.map(l => (
          <span key={l} className="tag">{l}</span>
        ))}
      </div>
    </div>
  )
}
