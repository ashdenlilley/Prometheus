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

export const confirmPage = (token: string) =>
  page(
    `<h1>Confirm sign-in</h1><p>Confirm to sign this device in to Prometheus.</p>` +
      `<form method="post" action="/auth/verify"><input type="hidden" name="t" value="${escapeHtml(token)}">` +
      `<button type="submit">Confirm sign-in</button></form>`
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
