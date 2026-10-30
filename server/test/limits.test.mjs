import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Bundled to plain JS so the test does not depend on TypeScript stripping (Node 22 in CI, from .nvmrc).
const OUT = new URL('../dist/test/limits.mjs', import.meta.url).pathname
await build({ entryPoints: [new URL('../src/limits.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'neutral', outfile: OUT, logLevel: 'silent' })
const { ipKey, ipLimit } = await import(OUT)

test('no client address shares the none bucket', () => {
  assert.equal(ipKey(null), 'none')
  assert.equal(ipKey(''), 'none')
})

test('the none bucket is limited to 5; any address to 20', () => {
  assert.equal(ipLimit(ipKey(null)), 5)
  assert.equal(ipLimit(ipKey('203.0.113.1')), 20)
  assert.equal(ipLimit(ipKey('2001:db8::1')), 20)
})

test('IPv4 is its own bucket, unchanged', () => {
  assert.equal(ipKey('203.0.113.1'), '203.0.113.1')
  assert.equal(ipKey('::ffff:203.0.113.1'), '203.0.113.1')
})

test('IPv6 addresses in one /64 share a normalised key', () => {
  for (const ip of ['2001:db8::1', '2001:db8:0:0:ffff::1', '2001:DB8::', '2001:db8:0:0:1:2:3:4', '2001:0db8:0000:0000:0000:0000:0000:0001']) {
    assert.equal(ipKey(ip), '2001:0db8:0000:0000::/64', ip)
  }
})

test('IPv6 addresses in different /64s get different keys', () => {
  assert.notEqual(ipKey('2001:db8:0:1::1'), ipKey('2001:db8::1'))
})
