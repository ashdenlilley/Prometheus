import type { AppData } from '@shared/types'
import { agentIdOf, displayAssignee, isAgentAssignee } from '@shared/agents'

// An assignee: plain text for a person, a badge with the agent's colour for `agent:<id>`.
export function AgentBadge({ data, assignee }: { data: AppData; assignee: string }) {
  if (!assignee) return null
  if (!isAgentAssignee(assignee)) return <>{assignee}</>
  const agent = data.agents?.find(a => a.id === agentIdOf(assignee))
  return (
    <span className="agent-badge" data-testid="agent-badge" title="Agent" style={{ borderColor: agent?.color }}>
      <span aria-hidden="true">🤖</span>
      {displayAssignee(data, assignee)}
      {agent?.revokedAt && <span className="agent-badge-revoked">(revoked)</span>}
    </span>
  )
}
