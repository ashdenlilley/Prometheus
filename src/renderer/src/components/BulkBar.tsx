import type { Issue, Project } from '@shared/types'
import { activeAgents, agentAssignee } from '@shared/agents'
import { useStore } from '../store'

// Actions for a set of selected issues: status, priority, assignee, label, cycle, favourite, delete.
export function BulkBar({
  project,
  count,
  onPatch,
  onDelete,
  onClear
}: {
  project: Project
  count: number
  onPatch: (patch: Partial<Issue>) => void
  onDelete: () => void
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div className="bulk-bar">
      <span>{count} selected</span>
      <select className="input-sm" value="" onChange={e => e.target.value && onPatch({ status: e.target.value })}>
        <option value="">Set status…</option>
        {project.statuses.map(s => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <select className="input-sm" value="" onChange={e => e.target.value && onPatch({ priority: Number(e.target.value) })}>
        <option value="">Set priority…</option>
        {['No priority', 'Urgent', 'High', 'Medium', 'Low'].map((p, n) => (
          <option key={p} value={n}>{p}</option>
        ))}
      </select>
      <BulkAssignee project={project} onPatch={onPatch} />
      <BulkLabel onPatch={onPatch} />
      <button className="btn" onClick={() => onPatch({ favourite: true })}>Favourite</button>
      <button className="btn danger" onClick={onDelete}>Delete</button>
      <button className="btn ghost" onClick={onClear}>Clear</button>
    </div>
  )
}

function BulkAssignee({ project, onPatch }: { project: Project; onPatch: (p: Partial<Issue>) => void }) {
  const { data } = useStore()
  const agents = activeAgents(data)
  return (
    <select className="input-sm" value="" onChange={e => e.target.value && onPatch({ assignee: e.target.value === '-' ? '' : e.target.value })}>
      <option value="">Assign…</option>
      <option value="-">Unassigned</option>
      {project.members.map(m => (
        <option key={m} value={m}>{m}</option>
      ))}
      {agents.length > 0 && (
        <optgroup label="Agents">
          {agents.map(a => (
            <option key={a.id} value={agentAssignee(a.id)}>🤖 {a.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

function BulkLabel({ onPatch }: { onPatch: (p: Partial<Issue>) => void }) {
  return (
    <input
      className="input-sm"
      placeholder="Set label, Enter"
      onKeyDown={e => {
        const v = (e.target as HTMLInputElement).value.trim()
        if (e.key === 'Enter' && v) {
          onPatch({ labels: [v] })
          ;(e.target as HTMLInputElement).value = ''
        }
      }}
    />
  )
}
