import { sendMagicLink } from './email'
import { sha256Hex, verifyAccess } from './crypto'
import type { Env } from './env'
import { confirmPage, invalidLinkPage, signedInPage } from './pages'

export { Auth } from './auth'
export { Workspace } from './workspace'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const REQUIRED = ['OWNER_EMAIL', 'JWT_SECRET', 'PUBLIC_URL', 'EMAIL_FROM', 'EMAIL_PROVIDER'] as const

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const unauthorized = () => json({ error: 'unauthorized' }, 401)

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// The Auth stub is one instance; every call goes through this getter.
const auth = (env: Env) => env.AUTH.getByName('auth')

// Access token from `Authorization: Bearer`, checked for a signature, expiry and an active device.
async function bearerDevice(req: Request, env: Env): Promise<string | null> {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')
  const claims = m ? await verifyAccess(env.JWT_SECRET ?? '', m[1]) : null
  if (!claims) return null
  return (await auth(env).authorize(claims.dev)) ? claims.dev : null
}

async function startSignIn(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(req)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400)
  const deviceName = typeof body?.deviceName === 'string' && body.deviceName.trim() ? body.deviceName.trim().slice(0, 100) : 'Device'
  const owner = email === (env.OWNER_EMAIL ?? '').trim().toLowerCase()
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'

  const res = await auth(env).startSignIn({ emailKey: await sha256Hex(email), ip, owner, deviceName })
  if ('limited' in res) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(res.limited) })

  // Sent after the reply, so the response time does not reveal whether the owner's email matched.
  if (res.token) {
    const link = `${env.PUBLIC_URL!.replace(/\/$/, '')}/auth/verify?t=${res.token}`
    ctx.waitUntil(sendMagicLink(env, email, link).catch(e => console.error('magic link email failed:', e instanceof Error ? e.message : 'unknown')))
  }
  return json({ requestId: res.requestId, pollSecret: res.pollSecret, expiresAt: res.expiresAt })
}

async function verifyLink(req: Request, env: Env): Promise<Response> {
  // Form body, so the token never lands in a URL the browser or proxies log again.
  const t = new URLSearchParams(await req.text()).get('t') ?? ''
  const ok = t !== '' && t.length <= 200 && (await auth(env).verifyLink(await sha256Hex(t)))
  return ok ? signedInPage() : invalidLinkPage()
}

async function poll(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req)
  if (typeof body?.requestId !== 'string' || typeof body?.pollSecret !== 'string') return json({ error: 'bad_request' }, 400)
  const res = await auth(env).poll(body.requestId, await sha256Hex(body.pollSecret))
  switch (res.status) {
    case 'notfound':
      return json({ error: 'not_found' }, 404)
    case 'gone':
      return json({ error: 'gone' }, 410)
    case 'pending':
      return json({ status: 'pending' }, 202)
    case 'ok':
      return json({ refreshToken: res.refreshToken, accessToken: res.accessToken, accessExpiresAt: res.accessExpiresAt, deviceId: res.deviceId })
  }
}

async function refresh(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req)
  if (typeof body?.refreshToken !== 'string') return json({ error: 'bad_request' }, 400)
  const res = await auth(env).refresh(body.refreshToken)
  return res ? json(res) : unauthorized()
}

// Serves the sync WebSocket. The token comes from the Sec-WebSocket-Protocol header, or ?access_token= as fallback.
async function sync(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade_required' }, 426)
  const protocols = (req.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(p => p.trim())
  const fromHeader = protocols.find(p => p.startsWith('bearer.'))?.slice('bearer.'.length)
  const token = fromHeader ?? new URL(req.url).searchParams.get('access_token') ?? ''
  const claims = token ? await verifyAccess(env.JWT_SECRET ?? '', token) : null
  if (!claims || !(await auth(env).authorize(claims.dev))) return unauthorized()
  const headers = new Headers(req.headers)
  headers.set('X-Device-Id', claims.dev)
  return env.WORKSPACE.getByName('default').fetch(new Request(req, { headers }))
}

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url)
  const { pathname: p } = url
  const m = req.method

  if (m === 'POST' && p === '/auth/start') return startSignIn(req, env, ctx)
  if (m === 'GET' && p === '/auth/verify') {
    const t = url.searchParams.get('t')
    return t ? confirmPage(t) : invalidLinkPage()
  }
  if (m === 'POST' && p === '/auth/verify') return verifyLink(req, env)
  if (m === 'POST' && p === '/auth/poll') return poll(req, env)
  if (m === 'POST' && p === '/auth/refresh') return refresh(req, env)
  if (m === 'POST' && p === '/auth/signout-all') {
    if (!(await bearerDevice(req, env))) return unauthorized()
    await auth(env).revokeAll()
    return json({ ok: true })
  }
  if (m === 'GET' && p === '/devices') {
    const dev = await bearerDevice(req, env)
    return dev ? json(await auth(env).listDevices(dev)) : unauthorized()
  }
  const device = /^\/devices\/([\w-]{1,64})$/.exec(p)
  if (m === 'DELETE' && device) {
    if (!(await bearerDevice(req, env))) return unauthorized()
    return (await auth(env).revokeDevice(device[1])) ? json({ ok: true }) : json({ error: 'not_found' }, 404)
  }
  if (m === 'GET' && p === '/sync') return sync(req, env)
  return json({ error: 'not_found' }, 404)
}

// A deploy that still has the example values must not run: a known JWT secret would let anyone mint tokens.
function placeholder(env: Env): string | undefined {
  const vars = ['OWNER_EMAIL', 'PUBLIC_URL', 'EMAIL_FROM', 'EMAIL_API_KEY', 'JWT_SECRET'] as const
  const left = vars.find(k => /REPLACE_WITH|^replace-with-/i.test(env[k] ?? '') || env[k] === 'you@example.com')
  if (left) return `${left} (still the placeholder value)`
  if ((env.JWT_SECRET ?? '').length < 32) return 'JWT_SECRET (at least 32 characters)'
  return undefined
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'GET' && new URL(req.url).pathname === '/health') return json({ ok: true })

    // Names the setting only, never its value.
    const missing =
      REQUIRED.find(k => !env[k]) ??
      (['resend', 'cloudflare', 'log'].includes(env.EMAIL_PROVIDER!) ? undefined : 'EMAIL_PROVIDER (resend, cloudflare or log)') ??
      (env.EMAIL_PROVIDER === 'resend' && !env.EMAIL_API_KEY ? 'EMAIL_API_KEY' : undefined) ??
      (env.EMAIL_PROVIDER === 'cloudflare' && !env.EMAIL ? 'EMAIL (send_email binding)' : undefined) ??
      placeholder(env)
    if (missing) return json({ error: 'config_missing', message: `Missing setting: ${missing}` }, 500)

    try {
      return await route(req, env, ctx)
    } catch (e) {
      console.error('request failed:', e instanceof Error ? e.message : 'unknown')
      return json({ error: 'internal' }, 500)
    }
  }
}
