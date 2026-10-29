import type { Env } from './env'
import { escapeHtml } from './pages'

export interface EmailSender {
  send(msg: { to: string; from: string; subject: string; text: string; html: string; kind?: 'sign-in' | 'invite' }): Promise<void>
}

// Picks the sender by EMAIL_PROVIDER. Config problems throw; the messages never include a link or a provider reply.
export function emailSender(env: Env): EmailSender {
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      return resendSender(env)
    case 'cloudflare':
      return cloudflareSender(env)
    case 'log':
      return logSender(env)
    default:
      throw new Error('EMAIL_PROVIDER must be resend, cloudflare or log')
  }
}

function resendSender(env: Env): EmailSender {
  return {
    async send(msg) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html })
      })
      if (!res.ok) throw new Error(`email provider responded with HTTP ${res.status}`)
    }
  }
}

// Cloudflare Email Sending through the send_email binding (no API key). Its errors carry a code such as E_SENDER_NOT_VERIFIED.
function cloudflareSender(env: Env): EmailSender {
  return {
    async send(msg) {
      if (!env.EMAIL) throw new Error('send_email binding EMAIL is not configured')
      try {
        await env.EMAIL.send(msg)
      } catch (e) {
        const code = (e as { code?: unknown }).code
        throw new Error(typeof code === 'string' && /^E_[A-Z_]+$/.test(code) ? `email send failed: ${code}` : 'email send failed')
      }
    }
  }
}

// Local development only: prints the link to the console instead of sending it.
function logSender(env: Env): EmailSender {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(env.PUBLIC_URL ?? '')) {
    throw new Error('EMAIL_PROVIDER=log is only allowed when PUBLIC_URL starts with http://127.0.0.1 or http://localhost')
  }
  return {
    async send(msg) {
      console.log(`${msg.kind ?? 'sign-in'} link for ${msg.to}: ${msg.text.match(/https?:\/\/\S+/)?.[0]}`)
    }
  }
}

// Sends the sign-in link. Throws on a non-2xx reply; the message never includes the link or the reply body.
export async function sendMagicLink(env: Env, to: string, link: string): Promise<void> {
  const text = `Sign in to Prometheus sync:\n\n${link}\n\nThis link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`
  const html = `<p>Sign in to Prometheus sync:</p><p><a href="${escapeHtml(link)}">Sign in</a></p><p>This link works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`
  await emailSender(env).send({ from: env.EMAIL_FROM!, to, subject: 'Sign in to Prometheus', text, html })
}

// Sends the invite link. The link must stay the first URL in the text (the log sender and tests read it from there).
export async function sendInvite(env: Env, to: string, link: string, role: string): Promise<void> {
  const note = `The link works once and expires in 7 days. Then open Prometheus, go to Settings > Cloud sync, enter the server address ${env.PUBLIC_URL} and sign in with this email address.`
  const text = `You've been invited to Prometheus sync as a ${role}.\n\nAccept the invite:\n\n${link}\n\n${note}`
  const html = `<p>${escapeHtml(`You've been invited to Prometheus sync as a ${role}.`)}</p><p><a href="${escapeHtml(link)}">Accept the invite</a></p><p>${escapeHtml(note)}</p>`
  await emailSender(env).send({ from: env.EMAIL_FROM!, to, subject: "You're invited to Prometheus", text, html, kind: 'invite' })
}
