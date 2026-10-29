import { issueKey } from './model'
import type { AppData, Issue, PrState, RepoRef } from './types'

// Branch names, PR-to-issue matching and PR state. Pure: no node or Electron imports.

const KEY_MAX = 60

// Order here is the order the filter and the summary use.
export const PR_STATE_LABEL: Record<PrState, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' }

const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// `os-123-short-title`, at most 60 characters, cut at a dash where possible. With a prefix: `prefix/os-123-...`.
export function branchName(key: string, title: string, prefix?: string): string {
  const head = slugify(key)
  let name = slugify(`${key} ${title}`)
  if (name.length > KEY_MAX) {
    let cut = name.slice(0, KEY_MAX)
    const dash = cut.lastIndexOf('-')
    if (dash > head.length) cut = cut.slice(0, dash)
    name = cut.replace(/-+$/, '')
  }
  const user = prefix ? slugify(prefix) : ''
  return user ? `${user}/${name}` : name
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Whole-word match: OS-123 matches "os-123-fix" and "[OS-123]" but not OS-1234 or XOS-123.
export function keyPattern(key: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(key)}\\b`, 'i')
}

export function mentionsKey(text: string, key: string): boolean {
  return keyPattern(key).test(text)
}

// Issues of the project whose key appears in the PR's branch, title or body.
export function matchIssues(data: AppData, pr: { title: string; body: string | null; branch: string }, projectId: string): Issue[] {
  const texts = [pr.branch, pr.title, pr.body ?? '']
  return data.issues.filter(i => i.projectId === projectId && texts.some(t => mentionsKey(t, issueKey(data, i))))
}

// Draft is checked before merged and closed, so a draft PR never reads as merged.
export function prStateOf(pr: { state: 'open' | 'closed'; draft: boolean; merged_at: string | null }): PrState {
  if (pr.merged_at) return 'merged'
  if (pr.state === 'closed') return 'closed'
  return pr.draft ? 'draft' : 'open'
}

// The one state an issue shows for all its PRs: open > draft > merged > closed. Undefined with no PRs.
export function summaryState(states: PrState[]): PrState | undefined {
  return (['open', 'draft', 'merged', 'closed'] as const).find(s => states.includes(s))
}

// 'owner/name' or a github.com URL. Anything else (other hosts, deeper paths) is null.
export function parseRepo(input: string): RepoRef | null {
  const m = input
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .match(/^(?:https?:\/\/(?:www\.)?github\.com\/|github\.com\/)?([^/\s]+)\/([^/\s]+)$/i)
  if (!m || !/^[A-Za-z0-9_.-]+$/.test(m[1]) || !/^[A-Za-z0-9_.-]+$/.test(m[2])) return null
  return { provider: 'github', owner: m[1], name: m[2] }
}
