import type { Env } from './env'
import { escapeHtml } from './pages'

// Sends the sign-in link. Throws on a non-2xx reply; the message never includes the link or the reply body.
export async function sendMagicLink(env: Env, to: string, link: string): Promise<void> {
  const text = `Sign in to Prometheus sync:\n\n${link}\n\nThis link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`
  const html = `<p>Sign in to Prometheus sync:</p><p><a href="${escapeHtml(link)}">Sign in</a></p><p>This link works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`
  const message = { from: env.EMAIL_FROM, to: [to], subject: 'Sign in to Prometheus', text, html }
  const auth = { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' }

  // Cloudflare Email Sending: confirm the exact endpoint and payload at setup (see docs/cloud-sync.md).
  const url =
    env.EMAIL_PROVIDER === 'cloudflare'
      ? `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`
      : 'https://api.resend.com/emails'
  const res = await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify(message) })
  if (!res.ok) throw new Error(`email provider responded with HTTP ${res.status}`)
}
