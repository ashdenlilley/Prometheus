// src/email.ts bundled with esbuild and called with fake envs. The send_email binding and console are faked here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const src = fileURLToPath(new URL('../src/email.ts', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'email-bundle-'))
const outfile = join(dir, 'email.mjs')
await esbuild.build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile, logLevel: 'silent' })
const { emailSender, sendMagicLink } = await import(pathToFileURL(outfile).href)
const LINK = 'https://sync.example/auth/verify?t=abc123'

test.after(() => rmSync(dir, { recursive: true, force: true }))

test('cloudflare sends through the send_email binding with no REST call', async () => {
  const sent = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('no fetch expected')
  }
  try {
    const env = { EMAIL_PROVIDER: 'cloudflare', EMAIL_FROM: 'Prometheus <signin@example.com>', EMAIL: { send: async m => (sent.push(m), { messageId: 'm1' }) } }
    await sendMagicLink(env, 'owner@prometheus.test', LINK)
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'owner@prometheus.test')
  assert.equal(sent[0].from, 'Prometheus <signin@example.com>')
  assert.equal(sent[0].subject, 'Sign in to Prometheus')
  assert.ok(sent[0].text.includes(LINK))
  assert.ok(sent[0].html.includes('Sign in'))
})

test('cloudflare errors carry the code only, never the link', async () => {
  const env = {
    EMAIL_PROVIDER: 'cloudflare',
    EMAIL: {
      send: async () => {
        throw Object.assign(new Error(`sender not verified for ${LINK}`), { code: 'E_SENDER_NOT_VERIFIED' })
      }
    }
  }
  await assert.rejects(sendMagicLink(env, 'owner@prometheus.test', LINK), err => {
    assert.equal(err.message, 'email send failed: E_SENDER_NOT_VERIFIED')
    assert.equal(err.message.includes(LINK), false)
    return true
  })
})

test('unknown provider and missing binding throw', () => {
  assert.throws(() => emailSender({ EMAIL_PROVIDER: 'smtp' }), /EMAIL_PROVIDER/)
  assert.throws(() => emailSender({}), /EMAIL_PROVIDER/)
  return sendMagicLink({ EMAIL_PROVIDER: 'cloudflare' }, 'owner@prometheus.test', LINK).then(
    () => assert.fail('expected a rejection'),
    err => assert.match(err.message, /EMAIL/)
  )
})

test('log refuses a non-local PUBLIC_URL', () => {
  for (const PUBLIC_URL of ['https://sync.example', 'https://127.0.0.1.evil.example', undefined]) {
    assert.throws(() => emailSender({ EMAIL_PROVIDER: 'log', PUBLIC_URL }), /EMAIL_PROVIDER=log/)
  }
})

test('log prints the link to the console on a local PUBLIC_URL and sends nothing', async () => {
  const lines = []
  const realLog = console.log
  console.log = (...a) => lines.push(a.join(' '))
  try {
    for (const PUBLIC_URL of ['http://127.0.0.1:8787', 'http://localhost:8787']) {
      await sendMagicLink({ EMAIL_PROVIDER: 'log', PUBLIC_URL, EMAIL_FROM: 'Prometheus <signin@example.com>' }, 'owner@prometheus.test', LINK)
    }
  } finally {
    console.log = realLog
  }
  assert.deepEqual(lines, [`sign-in link for owner@prometheus.test: ${LINK}`, `sign-in link for owner@prometheus.test: ${LINK}`])
})
