// Random ids, hashes and HS256 access tokens. Web Crypto only, so it runs in Workers and Miniflare.
const enc = new TextEncoder()
const dec = new TextDecoder()

// Access tokens live 15 minutes (exp is in seconds, per JWT).
const ACCESS_TTL_S = 15 * 60

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

export function randomId(bytes: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

// Uniform 000000-999999. Draws at or above the largest multiple of 10^6 below 2^32 are rejected, so no digit is favoured.
export function randomCode(): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000
  const n = new Uint32Array(1)
  do {
    crypto.getRandomValues(n)
  } while (n[0] >= limit)
  return String(n[0] % 1_000_000).padStart(6, '0')
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time string compare for secrets and hashes of equal length.
export function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const hmacKey = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])

// HMAC-SHA256 of text under secret, base64url. Deterministic, so it can be recomputed later instead of stored.
export async function hmacB64url(secret: string, text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(text))))
}

// Access-token claims: iss is the PUBLIC_URL origin, aud is fixed, sub is the user id. Header kid '1' marks this shape.
export const JWT_AUD = 'prometheus-sync'
const JWT_KID = '1'

export async function signAccess(
  secret: string,
  i: { iss: string; userId: string; deviceId: string }
): Promise<{ accessToken: string; accessExpiresAt: number }> {
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: JWT_KID })))
  const body = b64url(enc.encode(JSON.stringify({ iss: i.iss, aud: JWT_AUD, sub: i.userId, dev: i.deviceId, iat: now, exp: now + ACCESS_TTL_S })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`${head}.${body}`))
  return { accessToken: `${head}.${body}.${b64url(new Uint8Array(sig))}`, accessExpiresAt: (now + ACCESS_TTL_S) * 1000 }
}

// Returns the device id (and, for current tokens, the user id) when the token is a valid, unexpired HS256 token.
// secrets: the current JWT_SECRET first, then JWT_SECRET_PREVIOUS if set (verify-only, for rotation).
// Current tokens need kid '1', iss = expectedIss and aud = 'prometheus-sync'.
// Legacy tokens (no kid, sub 'owner', no iss/aud) from before this change are accepted only while their exp is at most
// one access-token lifetime (15 min) away, so they age out on their own. Remove that branch in a later release.
// crypto.subtle.verify compares signatures in constant time.
export async function verifyAccess(secrets: string[], expectedIss: string, token: string): Promise<{ dev: string; sub?: string } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(dec.decode(unb64url(parts[0])))
    if (header.alg !== 'HS256') return null
    const signed = enc.encode(`${parts[0]}.${parts[1]}`)
    const sig = unb64url(parts[2])
    let ok = false
    for (const secret of secrets) {
      if (!secret) continue
      if (await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, signed)) {
        ok = true
        break
      }
    }
    if (!ok) return null
    const claims = JSON.parse(dec.decode(unb64url(parts[1])))
    const nowMs = Date.now()
    if (typeof claims.dev !== 'string' || typeof claims.exp !== 'number' || !(claims.exp * 1000 > nowMs)) return null
    if (header.kid === JWT_KID) {
      if (claims.iss !== expectedIss || claims.aud !== JWT_AUD || typeof claims.sub !== 'string') return null
      return { dev: claims.dev, sub: claims.sub }
    }
    const legacy = header.kid === undefined && claims.sub === 'owner' && claims.iss === undefined && claims.aud === undefined
    if (legacy && claims.exp * 1000 - nowMs <= ACCESS_TTL_S * 1000) return { dev: claims.dev }
    return null
  } catch {
    return null
  }
}
