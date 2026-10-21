import { useState } from 'react'
import { STATUSES, type Status } from '@shared/types'
import { createIssue, issueKey, useStore } from '../store'
import { PriorityText, StatusDot } from '../components/fields'
import { QuickAdd } from '../components/ui'
import { clsx, fmtDate } from '../util'

export function BoardView({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const [target, setTarget] = useState<Status | null>(null)
  const issues = data.issues.filter(i => i.projectId === projectId)

  return (
    <div className="view">
      <div className="board">
        {STATUSES.map(s => {
          const items = issues.filter(i => i.status === s.id)
          return (
            <div
              key={s.id}
              className={clsx('column', target === s.id && 'drop-target')}
              onDragOver={e => {
                e.preventDefault()
                setTarget(s.id)
              }}
              onDragLeave={() => setTarget(null)}
              onDrop={e => {
                e.preventDefault()
                setTarget(null)
                const id = e.dataTransfer.getData('text/plain')
                if (id) dispatch({ type: 'patchIssue', id, patch: { status: s.id } })
              }}
            >
              <div className="column-head">
                <StatusDot status={s.id} />
                <span>{s.label}</span>
                <span className="count">{items.length}</span>
              </div>
              {items.map(i => (
                <div
                  key={i.id}
                  className="card"
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', i.id)}
                  onClick={() => onOpen(i.id)}
                >
                  <div className="card-title">{i.title}</div>
                  <div className="card-meta">
                    <span className="muted">{issueKey(data, i)}</span>
                    <PriorityText value={i.priority} />
                    {i.dueDate && <span className="muted">{fmtDate(i.dueDate)}</span>}
                    {i.assignee && <span className="muted">{i.assignee}</span>}
                  </div>
                </div>
              ))}
              <QuickAdd
                onAdd={title =>
                  dispatch({ type: 'addIssue', issue: createIssue(data, projectId, title, { status: s.id }) })
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
