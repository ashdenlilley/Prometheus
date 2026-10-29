import type { Auth } from './auth'
import type { Workspace } from './workspace'

// Vars come from wrangler.toml [vars]; secrets (JWT_SECRET, EMAIL_API_KEY) from `wrangler secret put`.
export interface Env {
  AUTH: DurableObjectNamespace<Auth>
  WORKSPACE: DurableObjectNamespace<Workspace>
  OWNER_EMAIL?: string
  PUBLIC_URL?: string
  EMAIL_PROVIDER?: string
  EMAIL_FROM?: string
  EMAIL_API_KEY?: string
  CF_ACCOUNT_ID?: string
  JWT_SECRET?: string
  COMPACT_AT?: string
  COMPACT_KEEP?: string
  LINK_TTL_SECONDS?: string
}
