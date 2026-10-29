import type { LinkProvider } from '@shared/types'
import { PROVIDER_LABELS } from '@shared/integrations'

const COLORS: Record<LinkProvider, string> = {
  slack: '#4a154b',
  figma: '#a259ff',
  sentry: '#362d59',
  zendesk: '#03363d',
  jira: '#0052cc',
  google: '#4285f4',
  teams: '#5059c9',
  github: '#24292f',
  other: '#8a8f98'
}

// Letter badge for a provider. Inline, so there are no remote images.
export function ProviderBadge({ provider }: { provider: LinkProvider }) {
  return (
    <span className="provider-badge" style={{ background: COLORS[provider] }} title={PROVIDER_LABELS[provider]} aria-hidden="true">
      {PROVIDER_LABELS[provider][0]}
    </span>
  )
}
