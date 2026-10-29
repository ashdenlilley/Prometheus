import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Action } from '../shared/model'
import { reducer } from '../shared/model'
import { prStateOf } from '../shared/git'
import type { AppData, GitPull } from '../shared/types'

// GitHub REST client and the poller that turns pull requests into GitLinks.

const API = 'https://api.github.com'
const MIN_MS = 60_000
const MAX_MS = 15 * 60_000
const DEFAULT_MS = 2 * 60_000
const MAX_PAGES = 5

export interface RateInfo {
  remaining: number
  limit: number
  reset: number // epoch seconds
}

export interface GhPull {
  number: number
  title: string
  body: string | null
  html_url: string
  state: 'open' | 'closed'
  draft: boolean
  merged_at: string | null
  updated_at: string
  head: { ref: string }
}

export type PullsResult = { status: 200; pulls: GhPull[]; etag?: string; hasNext: boolean; rate: RateInfo } | { status: 304; rate: RateInfo }

export interface GitHubClient {
  viewer(): Promise<{ login: string }>
  listPulls(owner: string, name: string, opts: { etag?: string; page?: number }): Promise<PullsResult>
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
    public rate?: RateInfo
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

const header = (res: Response, name: string) => Number(res.headers.get(name) ?? 0)
const rateOf = (res: Response): RateInfo => ({
  remaining: header(res, 'x-ratelimit-remaining'),
  limit: header(res, 'x-ratelimit-limit'),
  reset: header(res, 'x-ratelimit-reset')
})

export class HttpGitHubClient implements GitHubClient {
  constructor(
    private token: () => Promise<string | null>,
    private fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  // Only api.github.com is ever requested; the token goes nowhere else.
  private async get(path: string, etag?: string): Promise<Response> {
    const token = await this.token()
    if (!token) throw new GitHubError(401, 'No GitHub token saved')
    const url = new URL(path, API)
    if (url.origin !== API) throw new Error('Refusing to call a host other than api.github.com')
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Prometheus'
    }
    if (etag) headers['If-None-Match'] = etag
    return this.fetchImpl(url, { headers })
  }

  async viewer(): Promise<{ login: string }> {
    const res = await this.get('/user')
    if (!res.ok) throw failure(res)
    const body = (await res.json()) as { login: string }
    return { login: body.login }
  }

  async listPulls(owner: string, name: string, { etag, page = 1 }: { etag?: string; page?: number }): Promise<PullsResult> {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=all&sort=updated&direction=desc&per_page=50&page=${page}`
    const res = await this.get(path, etag)
    const rate = rateOf(res)
    if (res.status === 304) return { status: 304, rate }
    if (!res.ok) throw failure(res)
    return {
      status: 200,
      pulls: (await res.json()) as GhPull[],
      etag: res.headers.get('etag') ?? undefined,
      hasNext: /rel="next"/.test(res.headers.get('link') ?? ''),
      rate
    }
  }
}

function failure(res: Response): GitHubError {
  const message = res.status === 401 ? 'Token rejected' : `GitHub returned ${res.status}`
  return new GitHubError(res.status, message, rateOf(res))
}

// Test-only: serves the account and pull requests from a directory (PROMETHEUS_GITHUB_FIXTURES).
// Never touches the network. A token of 'bad' is rejected with 401, like GitHub does.
export class FixtureGitHubClient implements GitHubClient {
  constructor(
    private dir: string,
    private token: () => Promise<string | null>
  ) {}

  private async check() {
    const token = await this.token()
    if (!token) throw new GitHubError(401, 'No GitHub token saved')
    if (token === 'bad') throw new GitHubError(401, 'Token rejected')
  }

  private read<T>(name: string, fallback: T): T {
    const file = join(this.dir, name)
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  }

  async viewer(): Promise<{ login: string }> {
    await this.check()
    return this.read('user.json', { login: 'fixture-user' })
  }

  async listPulls(owner: string, name: string): Promise<PullsResult> {
    await this.check()
    const rate = { remaining: 5000, limit: 5000, reset: 0 }
    return { status: 200, pulls: this.read<GhPull[]>(`pulls-${owner}-${name}.json`, []), hasNext: false, rate }
  }
}

export interface PollerDeps {
  client: GitHubClient
  read(): AppData | null
  apply(action: Action): void
  now?: () => number
  intervalMs?: number
}

export interface PollStatus {
  lastPoll: number | null
  error: string | null
  backoffUntil: number | null
  repos: number
}

const clamp = (ms: number) => Math.min(Math.max(ms, MIN_MS), MAX_MS)

const mapPull = (p: GhPull): GitPull => ({
  number: p.number,
  title: p.title,
  body: p.body,
  url: p.html_url,
  state: prStateOf(p),
  branch: p.head.ref,
  updatedAt: p.updated_at
})

export class GitPoller {
  private etags = new Map<string, string>()
  // Last successful poll per repo: paging stops at pulls older than this
  private polled = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | null = null
  private interval: number
  private backoff: number | null = null
  private error: string | null = null
  private last: number | null = null
  private rejected = false
  private now: () => number

  constructor(private deps: PollerDeps) {
    this.now = deps.now ?? Date.now
    this.interval = clamp(deps.intervalMs ?? DEFAULT_MS)
  }

  start(intervalMs = this.interval) {
    this.interval = clamp(intervalMs)
    this.stop()
    this.timer = setInterval(() => void this.pollOnce(), this.interval)
    void this.pollOnce()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  setInterval(ms: number) {
    this.interval = clamp(ms)
    if (this.timer) this.start()
  }

  status(): PollStatus {
    const backoffUntil = this.limited() ? this.backoff : null
    const repos = new Set((this.deps.read()?.projects ?? []).flatMap(p => (p.repos ?? []).map(r => `${r.owner}/${r.name}`)))
    return { lastPoll: this.last, error: this.error, backoffUntil, repos: repos.size }
  }

  async pollOnce(): Promise<void> {
    const data = this.deps.read()
    if (this.rejected || !data) return
    if (this.limited()) return
    this.last = this.now()

    // A repo linked to several projects is fetched once, then applied to each project.
    const byRepo = new Map<string, string[]>()
    for (const p of data.projects) {
      for (const r of p.repos ?? []) byRepo.set(`${r.owner}/${r.name}`, [...(byRepo.get(`${r.owner}/${r.name}`) ?? []), p.id])
    }
    let failed: string | null = null
    for (const [repo, projectIds] of byRepo) {
      if (this.limited()) break
      try {
        await this.pollRepo(repo, projectIds)
      } catch (err) {
        failed = this.handle(err)
        if (this.rejected) break
      }
    }
    this.error = failed
  }

  private limited() {
    return this.backoff !== null && this.now() < this.backoff
  }

  private async pollRepo(repo: string, projectIds: string[]) {
    const [owner, name] = repo.split('/')
    const at = this.now()
    const since = this.polled.get(repo)
    const pulls: GitPull[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.deps.client.listPulls(owner, name, { etag: page === 1 ? this.etags.get(repo) : undefined, page })
      this.checkRate(res.rate)
      if (res.status === 304) return
      if (page === 1 && res.etag) this.etags.set(repo, res.etag)
      pulls.push(...res.pulls.map(mapPull))
      // Only keep paging while this page is all newer than the last poll
      const allNew = res.pulls.every(p => since === undefined || Date.parse(p.updated_at) > since)
      if (!res.hasNext || !allNew || this.limited()) break
    }
    for (const projectId of projectIds) {
      const action: Action = { type: 'syncGitPulls', projectId, repo, pulls, at: new Date(at).toISOString() }
      // Apply only what would change; the reducer hands back the same object otherwise.
      const data = this.deps.read()
      if (data && reducer(data, action) !== data) this.deps.apply(action)
    }
    this.polled.set(repo, at)
  }

  // Backs off until the reset time when the quota is nearly used up.
  private checkRate(rate: RateInfo) {
    if (rate.limit > 0 && rate.remaining < rate.limit * 0.1) this.backoff = rate.reset * 1000
  }

  // Returns the status message. A rejected token stops polling until a new poller is made.
  private handle(err: unknown): string {
    if (err instanceof GitHubError) {
      if (err.status === 401) {
        this.rejected = true
        this.stop()
        return 'Token rejected'
      }
      if ((err.status === 403 || err.status === 429) && err.rate?.remaining === 0) this.backoff = err.rate.reset * 1000
      return err.message
    }
    // Network errors are retried on the next interval
    return `Network error: ${err instanceof Error ? err.message : String(err)}`
  }
}
