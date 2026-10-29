import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FixtureGitHubClient, GitHubError, type GhPull } from '../../src/main/github'

const pull: GhPull = {
  number: 7,
  title: 'OS-12 fix',
  body: null,
  html_url: 'https://github.com/acme/app/pull/7',
  state: 'open',
  draft: false,
  merged_at: null,
  updated_at: '2026-10-01T00:00:00Z',
  head: { ref: 'os-12-fix' }
}

const dir = mkdtempSync(join(tmpdir(), 'fixture-gh-'))
writeFileSync(join(dir, 'user.json'), JSON.stringify({ login: 'fixture-login' }))
writeFileSync(join(dir, 'pulls-acme-app.json'), JSON.stringify([pull]))

describe('FixtureGitHubClient', () => {
  test('serves the user and pulls from the fixture directory', async () => {
    const client = new FixtureGitHubClient(dir, async () => 'ghp_any')
    assert.deepEqual(await client.viewer(), { login: 'fixture-login' })
    const res = await client.listPulls('acme', 'app')
    assert.equal(res.status, 200)
    assert.deepEqual(res.status === 200 && res.pulls, [pull])
  })

  test('a repo with no fixture file has no pulls', async () => {
    const res = await new FixtureGitHubClient(dir, async () => 'ghp_any').listPulls('acme', 'missing')
    assert.equal(res.status === 200 && res.pulls.length, 0)
  })

  test("rejects the token 'bad' with a 401", async () => {
    const client = new FixtureGitHubClient(dir, async () => 'bad')
    await assert.rejects(client.viewer(), (err: unknown) => err instanceof GitHubError && err.status === 401)
    await assert.rejects(client.listPulls('acme', 'app'),(err: unknown) => err instanceof GitHubError && err.status === 401)
  })

  test('no saved token is a 401', async () => {
    await assert.rejects(new FixtureGitHubClient(dir, async () => null).viewer(), (err: unknown) => err instanceof GitHubError && err.status === 401)
  })
})
