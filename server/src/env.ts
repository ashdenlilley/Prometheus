import type { Auth } from './auth'
import type { Workspace } from './workspace'

// Vars come from wrangler.toml [vars]; secrets (JWT_SECRET, EMAIL_API_KEY) from `wrangler secret put`.
// EMAIL is the send_email binding, used only by EMAIL_PROVIDER = "cloudflare".
export interface Env {
  AUTH: DurableObjectNamespace<Auth>
  WORKSPACE: DurableObjectNamespace<Workspace>
  OWNER_EMAIL?: string
  PUBLIC_URL?: string
  EMAIL_PROVIDER?: string
  EMAIL_FROM?: string
  EMAIL_API_KEY?: string
  EMAIL?: { send(m: { to: string; from: string; subject: string; text: string; html: string }): Promise<{ messageId: string }> }
  JWT_SECRET?: string
  COMPACT_AT?: string
  COMPACT_KEEP?: string
  LINK_TTL_SECONDS?: string
  INVITE_TTL_SECONDS?: string
  // Edge limits (wrangler.toml [[ratelimits]]). Optional so local tests, which lack them, skip the check.
  AUTH_RL?: RateLimit
  AUTH_POLL_RL?: RateLimit
  // Caps on emails actually sent per hour and per day (defaults in auth.ts).
  EMAIL_CAP_HOUR?: string
  EMAIL_CAP_DAY?: string
}
