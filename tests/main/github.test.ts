import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import { GitHubError, GitPoller, HttpGitHubClient, type GhPull, type GitHubClient, type PullsResult, type RateInfo } from '../../src/main/github'
import { reducer, createIssue, type Action } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData } from '../../src/shared/types'

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/github', name), 'utf8'))
const page1 = fixture<GhPull[]>('pulls-page1.json')
const page2 = fixture<GhPull[]>('pulls-page2.json')
const user = fixture<{ login: string }>('user.json')

const rate: RateInfo = { remaining: 4000, limit: 5000, reset: 1_900_000_000 }

const headersOf = (init?: RequestInit) => (init?.headers ?? {}) as Record<string, string>

// Fake fetch that records each call and answers with the given response.
function fakeFetch(respond: (url: URL) => Response) {
  const calls: { url: URL; headers: Record<string, string> }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, headers: headersOf(init) })
    return respond(url)
  }) as typeof fetch
  return { fetchImpl, calls }
}

const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const rateHeaders = { 'x-ratelimit-remaining': '4000', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1900000000' }

describe('HttpGitHubClient', () => {
  test('viewer calls /user on api.github.com with the token and fixed headers', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(user))
    const client = new HttpGitHubClient(async () => 'ghp_test', fetchImpl)
    assert.deepEqual(await client.viewer(), { login: 'ashden-lilley' })
    assert.equal(calls[0].url.origin, 'https://api.github.com')
    assert.equal(calls[0].url.pathname, '/user')
    assert.equal(calls[0].headers.Authorization, 'Bearer ghp_test')
    assert.equal(calls[0].headers.Accept, 'application/vnd.github+json')
    assert.equal(calls[0].headers['X-GitHub-Api-Version'], '2022-11-28')
    assert.equal(calls[0].headers['User-Agent'], 'Prometheus')
    assert.equal(calls[0].headers['If-None-Match'], undefined)
  })

  test('listPulls parses rate headers, the next link and the etag', async () => {
    const link = '<https://api.github.com/repositories/1/pulls?page=2>; rel="next"'
    const { fetchImpl, calls } = fakeFetch(() => json(page1, { ...rateHeaders, etag: 'W/"abc"', link }))
    const client = new HttpGitHubClient(async () => 'ghp_test', fetchImpl)
    const res = await client.listPulls('acme', 'app', { page: 1 })
    assert.equal(calls[0].url.origin, 'https://api.github.com')
    assert.equal(calls[0].url.pathname, '/repos/acme/app/pulls')
    assert.equal(calls[0].url.searchParams.get('state'), 'all')
    assert.equal(calls[0].url.searchParams.get('sort'), 'updated')
    assert.equal(calls[0].url.searchParams.get('direction'), 'desc')
    assert.equal(calls[0].url.searchParams.get('per_page'), '50')
    assert.equal(calls[0].url.searchParams.get('page'), '1')
    assert.equal(res.status, 200)
    if (res.status !== 200) return
    assert.equal(res.pulls.length, 3)
    assert.equal(res.etag, 'W/"abc"')
    assert.equal(res.hasNext, true)
    assert.deepEqual(res.rate, rate)
  })

  test('sends If-None-Match and returns 304 with rate info', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(null, { status: 304, headers: rateHeaders }))
    const client = new HttpGitHubClient(async () => 'ghp_test', fetchImpl)
    const res = await client.listPulls('acme', 'app', { etag: 'W/"abc"' })
    assert.equal(calls[0].headers['If-None-Match'], 'W/"abc"')
    assert.deepEqual(res, { status: 304, rate })
  })

  test('hasNext is false without a next link', async () => {
    const { fetchImpl } = fakeFetch(() => json(page2, rateHeaders))
    const res = await new HttpGitHubClient(async () => 'ghp_test', fetchImpl).listPulls('acme', 'app', { page: 2 })
    assert.equal(res.status === 200 && res.hasNext, false)
  })

  test('a 401 throws GitHubError with status 401', async () => {
    const { fetchImpl } = fakeFetch(() => json({ message: 'Bad credentials' }, {}, 401))
    const client = new HttpGitHubClient(async () => 'ghp_bad', fetchImpl)
    await assert.rejects(client.viewer(), (err: unknown) => err instanceof GitHubError && err.status === 401 && err.message === 'Token rejected')
  })

  test('without a token nothing is requested', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(user))
    await assert.rejects(new HttpGitHubClient(async () => null, fetchImpl).viewer(), GitHubError)
    assert.equal(calls.length, 0)
  })
})

// Client that answers from a script, one entry per call. Errors are thrown.
function scripted(script: (PullsResult | Error)[]) {
  const calls: { etag?: string; page?: number }[] = []
  const client: GitHubClient = {
    viewer: async () => user,
    listPulls: async (_owner, _name, opts) => {
      calls.push({ ...opts })
      const next = script.shift()
      if (!next) throw new Error('no scripted response')
      if (next instanceof Error) throw next
      return next
    }
  }
  return { client, calls }
}

// Project p1 linked to acme/app with issue i1 (OS-1), which page 1's PR #12 mentions.
const data = (): AppData => {
  const project = blankProject({ id: 'p1', spaceId: 's1', name: 'App', key: 'OS', color: '#000000', repos: [{ provider: 'github', owner: 'acme', name: 'app' }] })
  return { ...emptyData(), projects: [project], issues: [createIssue(emptyData(), 'p1', 'Fix login', { id: 'i1', number: 1, status: 'todo' })] }
}

// Poller over a shared state, applying each action with the real reducer.
function poller(script: (PullsResult | Error)[], opts: { now?: () => number } = {}) {
  let state = data()
  const applied: Action[] = []
  const { client, calls } = scripted(script)
  const p = new GitPoller({
    client,
    read: () => state,
    apply: a => {
      applied.push(a)
      state = reducer(state, a)
    },
    now: opts.now,
    intervalMs: 60_000
  })
  return { p, calls, applied, state: () => state }
}

const ok = (pulls: GhPull[], extra: Partial<Extract<PullsResult, { status: 200 }>> = {}): PullsResult => ({
  status: 200,
  pulls,
  etag: 'W/"v1"',
  hasNext: false,
  rate,
  ...extra
})

describe('GitPoller', () => {
  test('links PRs through apply', async () => {
    const { p, applied, state } = poller([ok(page1)])
    await p.pollOnce()
    assert.equal(applied.length, 1)
    assert.equal(state().gitLinks?.length, 1)
    assert.equal(state().gitLinks![0].id, 'i1:acme/app#12')
    assert.equal(state().issues[0].prState, 'open')
    assert.equal(p.status().error, null)
    assert.equal(p.status().repos, 1)
  })

  test('reuses the stored ETag and makes no apply on 304', async () => {
    const { p, calls, applied } = poller([ok(page1), { status: 304, rate }])
    await p.pollOnce()
    await p.pollOnce()
    assert.equal(calls[0].etag, undefined)
    assert.equal(calls[1].etag, 'W/"v1"')
    assert.equal(applied.length, 1)
  })

  test('low quota backs off until the reset time', async () => {
    let now = 0
    const low: RateInfo = { remaining: 10, limit: 5000, reset: 1000 }
    const { p, calls } = poller([ok(page1, { rate: low }), ok(page1)], { now: () => now })
    await p.pollOnce()
    assert.equal(calls.length, 1)
    assert.equal(p.status().backoffUntil, 1_000_000)
    now = 500_000
    await p.pollOnce()
    assert.equal(calls.length, 1)
    now = 1_000_000
    await p.pollOnce()
    assert.equal(calls.length, 2)
    assert.equal(p.status().backoffUntil, null)
  })

  test('a 403 with no quota left backs off until reset', async () => {
    let now = 0
    const exhausted = new GitHubError(403, 'rate limited', { remaining: 0, limit: 5000, reset: 2000 })
    const { p, calls } = poller([exhausted, ok(page1)], { now: () => now })
    await p.pollOnce()
    assert.equal(p.status().error, 'rate limited')
    assert.equal(p.status().backoffUntil, 2_000_000)
    now = 2_000_000
    await p.pollOnce()
    assert.equal(calls.length, 2)
  })

  test('a 401 records the error and stops polling', async () => {
    const { p, calls } = poller([new GitHubError(401, 'Token rejected'), ok(page1)])
    await p.pollOnce()
    assert.equal(p.status().error, 'Token rejected')
    await p.pollOnce()
    assert.equal(calls.length, 1)
  })

  test('network errors are recorded and retried next time', async () => {
    const { p, calls, state } = poller([new TypeError('fetch failed'), ok(page1)])
    await p.pollOnce()
    assert.match(p.status().error ?? '', /fetch failed/)
    await p.pollOnce()
    assert.equal(calls.length, 2)
    assert.equal(state().gitLinks?.length, 1)
    assert.equal(p.status().error, null)
  })

  test('paging stops at pulls older than the last poll', async () => {
    const first = Date.parse('2026-10-05T00:00:00Z')
    let now = first
    const { p, calls } = poller([ok(page1, { hasNext: true }), ok(page2), ok(page1, { hasNext: true })], { now: () => now })
    await p.pollOnce()
    assert.deepEqual(
      calls.map(c => c.page),
      [1, 2]
    )
    now = Date.parse('2026-10-06T00:00:00Z')
    await p.pollOnce()
    assert.deepEqual(
      calls.slice(2).map(c => c.page),
      [1]
    )
  })
})
