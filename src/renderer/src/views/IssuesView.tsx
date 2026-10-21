import { useState } from 'react'
import { STATUSES } from '@shared/types'
import { createIssue, useStore } from '../store'
import { IssueRow } from '../components/IssueRow'
import { StatusDot } from '../components/fields'
import { QuickAdd } from '../components/ui'
import { clsx } from '../util'

export function IssuesView({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const [allProjects, setAllProjects] = useState(false)
  const issues = data.issues.filter(i => allProjects || i.projectId === projectId)

  return (
    <div className="view">
      <div className="toolbar">
        <button
          className={clsx('btn', allProjects && 'primary')}
          onClick={() => setAllProjects(v => !v)}
        >
          {allProjects ? 'All projects' : 'Current project'}
        </button>
        <span className="muted">{issues.length} issues</span>
      </div>

      {STATUSES.map(s => {
        const items = issues.filter(i => i.status === s.id)
        return (
          <section key={s.id} className="group">
            <div className="group-head">
              <StatusDot status={s.id} />
              <span>{s.label}</span>
              <span className="count">{items.length}</span>
            </div>
            {items.map(i => (
              <IssueRow key={i.id} issue={i} onOpen={onOpen} />
            ))}
            {!allProjects && (
              <QuickAdd
                onAdd={title =>
                  dispatch({ type: 'addIssue', issue: createIssue(data, projectId, title, { status: s.id }) })
                }
              />
            )}
          </section>
        )
      })}
    </div>
  )
}
