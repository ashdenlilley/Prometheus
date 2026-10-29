import { useState } from 'react'
import type { IntakeForm, Project } from '@shared/types'
import { issueKey, useStore } from '../store'
import { PriorityText } from '../components/fields'
import { QuickAdd } from '../components/ui'
import { isLive } from '@shared/live'
import { createIssue } from '@shared/model'
import { ICONS } from '../components/icons'
import { fmtDate } from '../util'
import { FavGutter } from '../components/FavGutter'
import { FormModal } from '../components/FormModal'

// Inbox for new items. Accept moves an item into the project. Decline deletes it. Duplicate links it.
export function TriageView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const [dupOf, setDupOf] = useState<Record<string, string>>({})
  const items = data.issues.filter(i => i.projectId === project.id && i.triage && isLive(i))
  const pool = data.issues.filter(i => i.projectId === project.id && !i.triage && isLive(i))

  const accept = (id: string, status: string) => dispatch({ type: 'patchIssue', id, patch: { triage: false, status } })
  const decline = (id: string) => dispatch({ type: 'deleteIssue', id })
  const [picking, setPicking] = useState(false)
  const [openForm, setOpenForm] = useState<IntakeForm | null>(null)
  const duplicate = (id: string) => {
    const target = dupOf[id]
    if (!target) return
    dispatch({ type: 'addRelation', issueId: id, relation: { type: 'duplicate', targetId: target } })
    dispatch({ type: 'patchIssue', id, patch: { triage: false } })
  }

  return (
    <div className="view">
      <div className="toolbar">
        <span className="muted">{items.length} to triage</span>
        <div className="menu">
          <button className="btn" aria-label="Open intake form" onClick={() => setPicking(p => !p)}>Forms</button>
          {picking && (
            <div className="popover right" role="menu">
              {(project.forms ?? []).map(f => (
                <button key={f.id} role="menuitem" className="popover-item" onClick={() => { setPicking(false); setOpenForm(f) }}>{f.name}</button>
              ))}
              {(project.forms ?? []).length === 0 && <div className="popover-item muted small">No forms yet</div>}
            </div>
          )}
        </div>
      </div>
      {openForm && <FormModal form={openForm} project={project} onClose={() => setOpenForm(null)} />}

      {items.length === 0 && <div className="empty-block"><p>Triage is clear.</p></div>}

      {items.map(i => (
        <div key={i.id} className="triage-row fav-host">
          <FavGutter issue={i} />
          <button className="key-btn" onClick={() => onOpen(i.id)}>{issueKey(data, i)}</button>
          <span className="grow ellipsis">{i.title}</span>
          <PriorityText value={i.priority} />
          <span className="muted small">{fmtDate(i.createdAt.slice(0, 10))}</span>
          <button className="btn primary" onClick={() => accept(i.id, project.statuses[0].id)}>{ICONS.plus} Accept</button>
          <select className="input-sm" value={dupOf[i.id] ?? ''} onChange={e => setDupOf(d => ({ ...d, [i.id]: e.target.value }))} aria-label="Duplicate of">
            <option value="">Duplicate of…</option>
            {pool.map(p => (
              <option key={p.id} value={p.id}>{issueKey(data, p)} {p.title}</option>
            ))}
          </select>
          <button className="btn" disabled={!dupOf[i.id]} onClick={() => duplicate(i.id)}>Mark duplicate</button>
          <button className="btn danger ghost" onClick={() => decline(i.id)}>Decline</button>
        </div>
      ))}

      <QuickAdd
        placeholder="+ Add to triage"
        onAdd={title => dispatch({ type: 'addIssue', issue: createIssue(data, project.id, title, { triage: true, status: project.statuses[0].id }) })}
      />
    </div>
  )
}
