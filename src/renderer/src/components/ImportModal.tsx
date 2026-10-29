import { useState } from 'react'
import type { Project } from '@shared/types'
import { buildImport, unknownStatuses, type ImportRow } from '@shared/importers'
import { useStore } from '../store'
import { Modal } from './ui'

// Preview of a Jira or Asana import. Status names the project does not have can be mapped to its statuses first.
export function ImportModal({ rows, project, onClose }: { rows: ImportRow[]; project: Project; onClose: () => void }) {
  const { data, dispatch } = useStore()
  const [statusMap, setStatusMap] = useState<Record<string, string>>({})
  const unknown = unknownStatuses(rows, project)

  const run = () => {
    const startNumber = data.issues.filter(i => i.projectId === project.id).reduce((m, i) => Math.max(m, i.number), 0) + 1
    const issues = buildImport(rows, project, statusMap, { newId: () => crypto.randomUUID(), startNumber, now: new Date().toISOString() })
    dispatch({ type: 'addIssues', issues })
    onClose()
  }

  return (
    <Modal title={`Import into ${project.name}`} onClose={onClose}>
      <p className="muted small">{rows.length} issues found</p>
      <ul className="small">
        {rows.slice(0, 10).map((r, n) => (
          <li key={n}>{r.title}</li>
        ))}
      </ul>
      {rows.length > 10 && <p className="muted small">and {rows.length - 10} more</p>}
      {unknown.map(s => (
        <label key={s} className="field">
          <span className="small">Status “{s}”</span>
          <select className="field-input" aria-label={`Map status ${s}`} value={statusMap[s] ?? ''} onChange={e => setStatusMap(m => ({ ...m, [s]: e.target.value }))}>
            <option value="">Default</option>
            {project.statuses.map(st => (
              <option key={st.id} value={st.id}>{st.label}</option>
            ))}
          </select>
        </label>
      ))}
      <div className="option-row">
        <button className="btn primary" onClick={run}>Import {rows.length} issues</button>
      </div>
    </Modal>
  )
}
