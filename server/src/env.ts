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
  // Verify-only: the previous JWT_SECRET during a rotation. Tokens are always signed with JWT_SECRET.
  JWT_SECRET_PREVIOUS?: string
  // Days a device may go without refreshing before its refresh token stops working (default 60).
  REFRESH_IDLE_DAYS?: string
  COMPACT_AT?: string
  COMPACT_KEEP?: string
  LINK_TTL_SECONDS?: string
  INVITE_TTL_SECONDS?: string
  SYNC_TICKET_TTL_SECONDS?: string
  // Edge limits (wrangler.toml [[ratelimits]]). Optional so local tests, which lack them, skip the check.
  AUTH_RL?: RateLimit
  AUTH_POLL_RL?: RateLimit
  // Caps on emails actually sent per hour and per day (defaults in auth.ts).
  EMAIL_CAP_HOUR?: string
  EMAIL_CAP_DAY?: string
  // Push quota per user: pushes and ops per window (defaults in workspace.ts; tests override).
  PUSH_WINDOW_MS?: string
  PUSH_MAX?: string
  OPS_WINDOW_MS?: string
  OPS_MAX?: string
  // Database size in bytes above which non-owners cannot push (default 1 GB in workspace.ts).
  WORKSPACE_FULL_BYTES?: string
}

// Access-token issuer: the origin of PUBLIC_URL ('' if it is not a URL; the Worker refuses to run without a valid one).
export function issuer(env: Env): string {
  try {
    return new URL(env.PUBLIC_URL ?? '').origin
  } catch {
    return ''
  }
}

export function refreshIdleDays(env: Env): number {
  const n = Number(env.REFRESH_IDLE_DAYS ?? 60)
  return Number.isFinite(n) && n > 0 ? n : 60
}
