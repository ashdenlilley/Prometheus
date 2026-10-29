import { useState } from 'react'
import type { Issue, Project } from '@shared/types'
import { applyFilter, groupPatch, progress, swimlanes, withoutCompleted, type Group, type Lane } from '@shared/query'
import { createIssue, issueKey, useStore } from '../store'
import { PriorityText, StatusDot } from '../components/fields'
import { FilterBar, useViewQuery } from '../components/FilterBar'
import { BulkBar } from '../components/BulkBar'
import { QuickAdd } from '../components/ui'
import { FavGutter } from '../components/FavGutter'
import { ICONS } from '../components/icons'
import { clsx, fmtDate } from '../util'

export function BoardView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const query = useViewQuery(project, 'board')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const groupBy = query.groupBy ?? 'status'
  const filtered = applyFilter(data.issues.filter(i => i.projectId === project.id && !i.triage), query.filter, project)
  const issues = query.showCompleted ? filtered : withoutCompleted(filtered, project)
  const lanes = swimlanes(
    issues,
    project,
    groupBy,
    query.rowsBy,
    id => data.cycles.find(c => c.id === id)?.name ?? '',
    id => project.milestones.find(m => m.id === id)?.name ?? ''
  )
  // Columns accept drops when groupPatch could apply to groupBy, or when rows are on (lane patch).
  const canDrop = ['status', 'priority', 'assignee', 'cycle', 'milestone'].includes(groupBy) || !!query.rowsBy

  const columnTotals = new Map<string, number>()
  for (const lane of lanes) for (const c of lane.columns) columnTotals.set(c.key, (columnTotals.get(c.key) ?? 0) + c.items.length)

  const renderColumns = (lane: Lane) =>
    lane.columns.map(col => (
      <BoardColumn
        key={col.key}
        project={project}
        groupBy={groupBy}
        rowsBy={query.rowsBy}
        lane={lane}
        col={col}
        canDrop={canDrop}
        columnTotals={columnTotals}
        picked={picked}
        pick={id => setPicked(p => toggle(p, id))}
        onOpen={onOpen}
      />
    ))

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
      {query.rowsBy ? (
        <div className="lanes">
          {lanes.map(lane => {
            const open = !collapsed.has(lane.key)
            return (
              <section key={lane.key} className={clsx('lane', !open && 'collapsed')}>
                <button
                  className="lane-head"
                  aria-expanded={open}
                  onClick={() => setCollapsed(s => toggle(s, lane.key))}
                >
                  {ICONS.chevron}
                  <span>{lane.label || 'All'}</span>
                  <span className="count">{lane.count}</span>
                </button>
                {open && <div className="board">{renderColumns(lane)}</div>}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="board">{renderColumns(lanes[0])}</div>
      )}
    </div>
  )
}

// One cell: a column within one lane (the single lane when rows are off).
function BoardColumn({
  project,
  groupBy,
  rowsBy,
  lane,
  col,
  canDrop,
  columnTotals,
  picked,
  pick,
  onOpen
}: {
  project: Project
  groupBy: string
  rowsBy: string | null
  lane: Lane
  col: Group
  canDrop: boolean
  columnTotals: Map<string, number>
  picked: Set<string>
  pick: (id: string) => void
  onOpen: (id: string) => void
}) {
  const { data, dispatch } = useStore()
  const [hot, setHot] = useState(false)
  const status = groupBy === 'status' ? project.statuses.find(s => s.id === col.key) : undefined
  const limit = groupBy === 'status' ? project.wipLimits[col.key] : undefined
  // WIP limits apply to the whole column, across all lanes.
  const total = rowsBy ? (columnTotals.get(col.key) ?? 0) : col.items.length
  const over = limit !== undefined && total > limit
  const lanePatch = rowsBy ? groupPatch(rowsBy, lane.key, project, data.cycles) : null

  // One patch sets the column field and the row field; the row is skipped when the card is already in this lane.
  const drop = (issueId: string) => {
    const inLane = lane.columns.some(c => c.items.some(i => i.id === issueId))
    const patch = { ...groupPatch(groupBy, col.key, project, data.cycles), ...(inLane ? null : lanePatch) }
    if (Object.keys(patch).length) dispatch({ type: 'patchIssue', id: issueId, patch })
  }

  return (
    <div
      className={clsx('column', hot && 'drop-target', over && 'over-limit')}
      onDragOver={e => {
        if (!canDrop) return
        e.preventDefault()
        setHot(true)
      }}
      onDragLeave={() => setHot(false)}
      onDrop={e => {
        e.preventDefault()
        setHot(false)
        const id = e.dataTransfer.getData('text/plain')
        if (id) drop(id)
      }}
    >
      <div className="column-head">
        {status && <StatusDot status={status} />}
        <span>{col.label || 'All'}</span>
        <span className="count" title={rowsBy && limit !== undefined ? `${total} in column across lanes` : undefined}>
          {col.items.length}
          {limit !== undefined ? ` / ${limit}` : ''}
        </span>
      </div>
      {col.items.map(i => (
        <BoardCard
          key={i.id}
          issue={i}
          project={project}
          onOpen={onOpen}
          picked={picked.has(i.id)}
          onPick={() => pick(i.id)}
        />
      ))}
      {groupBy === 'status' && (
        <QuickAdd
          onAdd={title =>
            dispatch({
              type: 'addIssue',
              issue: createIssue(data, project.id, title, { status: col.key, ...lanePatch })
            })
          }
        />
      )}
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
