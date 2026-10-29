import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CredentialStore } from '../../src/main/credentials'

const dir = () => mkdtempSync(join(tmpdir(), 'cred-'))

// Reversible stand-in for safeStorage: the sealed text never contains the plain value.
const keys = {
  seal: async (text: string) => `sealed:${Buffer.from(text).toString('base64')}`,
  open: async (sealed: string) => Buffer.from(sealed.slice('sealed:'.length), 'base64').toString()
}

describe('CredentialStore', () => {
  test('round trip without keys stores plain text', async () => {
    const file = join(dir(), 'credentials.json')
    const store = new CredentialStore(file)
    assert.equal(await store.get('github.token'), null)
    await store.set('github.token', 'ghp_plain')
    assert.equal(await store.get('github.token'), 'ghp_plain')
    assert.equal(await new CredentialStore(file).get('github.token'), 'ghp_plain')
    assert.ok(readFileSync(file, 'utf8').includes('ghp_plain'))
  })

  test('round trip with keys never writes the plain value', async () => {
    const file = join(dir(), 'credentials.json')
    const store = new CredentialStore(file, keys)
    await store.set('github.token', 'ghp_secret_value')
    assert.equal(await new CredentialStore(file, keys).get('github.token'), 'ghp_secret_value')
    assert.ok(!readFileSync(file, 'utf8').includes('ghp_secret_value'))
  })

  test('file is written with mode 0600', async () => {
    const file = join(dir(), 'credentials.json')
    await new CredentialStore(file, keys).set('a', 'b')
    assert.equal(statSync(file).mode & 0o777, 0o600)
  })

  test('has and delete', async () => {
    const file = join(dir(), 'credentials.json')
    const store = new CredentialStore(file, keys)
    await store.set('one', '1')
    await store.set('two', '2')
    assert.equal(await store.has('one'), true)
    await store.delete('one')
    assert.equal(await store.has('one'), false)
    assert.equal(await store.get('one'), null)
    assert.equal(await new CredentialStore(file, keys).get('two'), '2')
    await store.delete('missing')
  })
})
