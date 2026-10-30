// Sign-in pages. The GET page only shows a button; only the POST from that button verifies the link,
// so email link scanners that pre-fetch URLs cannot consume it.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

function page(body: string, status = 200): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Prometheus sign-in</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto">${body}</body>`
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store'
    }
  })
}

// Approximate place from Cloudflare's geo fields. Either may be missing.
export const placeOf = (city: string | null | undefined, country: string | null | undefined) =>
  [city, country].filter(Boolean).join(', ') || 'an unknown location'

export const confirmPage = (token: string, i: { deviceName: string; country: string | null; city: string | null; startedAt: number }) =>
  page(
    `<h1>Confirm sign-in</h1>` +
      `<p>Sign in to Prometheus on ${escapeHtml(i.deviceName)} from ${escapeHtml(placeOf(i.city, i.country))}, started ${new Date(i.startedAt).toUTCString()}.</p>` +
      `<form method="post" action="/auth/verify"><input type="hidden" name="t" value="${escapeHtml(token)}">` +
      `<label>Enter the code shown in Prometheus on the device you're signing in<br>` +
      `<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label> ` +
      `<button type="submit">Confirm sign-in</button></form>` +
      `<p>If you didn't just try to sign in, close this page.</p>`
  )

export const signedInPage = () =>
  page('<h1>Signed in</h1><p>Signed in. You can close this tab and return to Prometheus.</p>')

export const invalidLinkPage = () =>
  page('<h1>Link invalid</h1><p>This sign-in link is invalid or has expired. Start sign-in again in Prometheus.</p>', 400)

export const inviteConfirmPage = (token: string, info: { email: string; role: string }) =>
  page(
    `<h1>Join Prometheus</h1><p>${escapeHtml(info.email)} is invited to Prometheus sync as a ${escapeHtml(info.role)}.</p>` +
      `<form method="post" action="/invite"><input type="hidden" name="t" value="${escapeHtml(token)}">` +
      `<button type="submit">Accept invite</button></form>`
  )

export const inviteAcceptedPage = (email: string, publicUrl: string) =>
  page(
    `<h1>Invite accepted</h1><p>Next, open Prometheus, go to Settings &gt; Cloud sync, enter the server address ${escapeHtml(publicUrl)} ` +
      `and sign in with ${escapeHtml(email)}.</p>`
  )

export const invalidInvitePage = () =>
  page('<h1>Invite invalid</h1><p>This invite is invalid, has already been used or has expired. Ask the owner for a new one.</p>', 400)
