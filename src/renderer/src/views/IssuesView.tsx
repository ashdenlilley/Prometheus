import { applyFilter, groupIssues } from '@shared/query'
import { useState } from 'react'
import { createIssue, useStore } from '../store'
import { IssueRow } from '../components/IssueRow'
import { StatusDot } from '../components/fields'
import { FilterBar, useViewQuery } from '../components/FilterBar'
import { QuickAdd } from '../components/ui'
import { BulkBar } from '../components/BulkBar'
import { FavGutter } from '../components/FavGutter'
import type { Project } from '@shared/types'
import { clsx } from '../util'

// List view: grouped by status by default, any field on demand.
export function IssuesView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const query = useViewQuery(project, 'list')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const issues = applyFilter(
    data.issues.filter(i => i.projectId === project.id && !i.triage),
    query.filter,
    project
  )
  const sorted = query.sort
    ? [...issues].sort((a, b) => {
        const va = a[query.sort!.key as 'title'] ?? ''
        const vb = b[query.sort!.key as 'title'] ?? ''
        return (va < vb ? -1 : va > vb ? 1 : 0) * (query.sort!.dir === 'asc' ? 1 : -1)
      })
    : issues
  const groups = groupIssues(
    sorted,
    project,
    query.groupBy ?? 'status',
    id => data.cycles.find(c => c.id === id)?.name ?? '',
    id => project.milestones.find(m => m.id === id)?.name ?? ''
  )

  return (
    <div className="view">
      <div className="toolbar">
        <FilterBar project={project} kind="list" query={query} />
        <span className="muted">{issues.length} issues</span>
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

      {groups.map(g => {
        const status = (query.groupBy ?? 'status') === 'status' ? project.statuses.find(s => s.id === g.key) : undefined
        return (
          <section key={g.key} className="group">
            <div className="group-head">
              {status && <StatusDot status={status} />}
              <span>{g.label || 'All'}</span>
              <span className="count">{g.items.length}</span>
            </div>
            {g.items.map(i => (
              <div key={i.id} className={clsx('pick-row fav-host', i.parentId && 'sub-indent')}>
                <FavGutter issue={i} />
                <input
                  type="checkbox"
                  checked={picked.has(i.id)}
                  aria-label={`Select ${i.title}`}
                  onChange={() =>
                    setPicked(p => {
                      const next = new Set(p)
                      if (next.has(i.id)) next.delete(i.id)
                      else next.add(i.id)
                      return next
                    })
                  }
                />
                <div className="grow minw0">
                  <IssueRow issue={i} onOpen={onOpen} fav={false} />
                </div>
              </div>
            ))}
            <QuickAdd
              onAdd={title =>
                dispatch({
                  type: 'addIssue',
                  issue: createIssue(data, project.id, title, { status: status?.id ?? project.statuses[0].id })
                })
              }
            />
          </section>
        )
      })}
    </div>
  )
}
