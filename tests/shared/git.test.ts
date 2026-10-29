import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { branchName, mentionsKey, parseRepo, prStateOf, summaryState, matchIssues } from '../../src/shared/git'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, GitPull, Project } from '../../src/shared/types'

const pull = (number: number, patch: Partial<GitPull> = {}): GitPull => ({
  number,
  title: 'Something',
  body: null,
  url: `https://github.com/acme/app/pull/${number}`,
  state: 'open',
  branch: 'feature',
  updatedAt: '2026-10-01T00:00:00Z',
  ...patch
})

// Project p1 (key OS) with issue i1 = OS-1 and a team-keyed issue i2 = ENG-5 in the same project.
const base = (extra: Partial<Project> = {}): AppData => {
  const project = blankProject({ id: 'p1', spaceId: 's1', name: 'App', key: 'OS', color: '#000000', ...extra })
  return {
    ...emptyData(),
    projects: [project],
    issues: [
      createIssue(emptyData(), 'p1', 'Fix login', { id: 'i1', number: 1, status: 'todo' }),
      createIssue(emptyData(), 'p1', 'Team key', { id: 'i2', number: 5, key: 'ENG', status: 'todo' })
    ]
  }
}

describe('branchName', () => {
  test('lower case slug with the key first', () => {
    assert.equal(branchName('OS-123', 'Short Title!'), 'os-123-short-title')
  })
  test('strips diacritics and turns other characters into dashes', () => {
    assert.equal(branchName('OS-1', 'Café déjà vu — ünïcode'), 'os-1-cafe-deja-vu-unicode')
  })
  test('emoji and punctuation collapse to single dashes', () => {
    assert.equal(branchName('OS-2', '🚀 fix: the   "thing" (now)'), 'os-2-fix-the-thing-now')
  })
  test('cuts long slugs on a dash and never ends with a dash', () => {
    const name = branchName('OS-3', 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu')
    assert.ok(name.length <= 60, name)
    assert.ok(!name.endsWith('-'))
    assert.equal(name, 'os-3-alpha-beta-gamma-delta-epsilon-zeta-eta-theta-iota')
  })
  test('cuts a single long word hard when there is no dash to cut at', () => {
    const name = branchName('OS-4', 'x'.repeat(100))
    assert.equal(name.length, 60)
  })
  test('empty title gives just the key', () => {
    assert.equal(branchName('OS-123', ''), 'os-123')
    assert.equal(branchName('OS-123', '🚀'), 'os-123')
  })
  test('prefix is sanitised and not counted in the 60', () => {
    const title = 'x'.repeat(55)
    const name = branchName('OS-5', title, 'Ashden Lilley')
    assert.equal(name, `ashden-lilley/os-5-${title}`)
    assert.equal(branchName('OS-5', 'Hi', ''), 'os-5-hi')
  })
})

describe('mentionsKey', () => {
  test('matches the key as a whole word, any case', () => {
    for (const text of ['OS-123', 'os-123-fix-thing', 'Fixes OS-123', '[OS-123]', 'feature/os-123']) {
      assert.ok(mentionsKey(text, 'OS-123'), text)
    }
  })
  test('does not match longer numbers, prefixed keys or shorter numbers', () => {
    for (const text of ['XOS-123', 'OS-1234', 'OS-12', 'OS-1235 and OS-12']) {
      assert.ok(!mentionsKey(text, 'OS-123'), text)
    }
  })
})

describe('prStateOf and summaryState', () => {
  test('maps GitHub fields to a state', () => {
    assert.equal(prStateOf({ state: 'open', draft: false, merged_at: null }), 'open')
    assert.equal(prStateOf({ state: 'open', draft: true, merged_at: null }), 'draft')
    assert.equal(prStateOf({ state: 'closed', draft: false, merged_at: '2026-10-01T00:00:00Z' }), 'merged')
    assert.equal(prStateOf({ state: 'closed', draft: false, merged_at: null }), 'closed')
  })
  test('summary precedence is open > draft > merged > closed', () => {
    assert.equal(summaryState(['closed', 'merged', 'draft', 'open']), 'open')
    assert.equal(summaryState(['closed', 'merged', 'draft']), 'draft')
    assert.equal(summaryState(['closed', 'merged']), 'merged')
    assert.equal(summaryState(['closed']), 'closed')
    assert.equal(summaryState([]), undefined)
  })
})

describe('parseRepo', () => {
  test('accepts owner/name and github.com URLs', () => {
    const want = { provider: 'github', owner: 'acme', name: 'app.v2' }
    assert.deepEqual(parseRepo('acme/app.v2'), want)
    assert.deepEqual(parseRepo(' https://github.com/acme/app.v2.git/ '), want)
    assert.deepEqual(parseRepo('https://www.github.com/acme/app.v2'), want)
  })
  test('rejects other hosts, extra paths and bad characters', () => {
    for (const bad of ['', 'acme', 'acme/app/pull/3', 'https://gitlab.com/acme/app', 'acme/ap p', 'ac$me/app', 'acme/']) {
      assert.equal(parseRepo(bad), null, bad)
    }
  })
})

describe('matchIssues', () => {
  test('matches by branch, title or body within the project', () => {
    const data = base()
    assert.deepEqual(matchIssues(data, { title: 'x', body: null, branch: 'os-1-fix' }, 'p1').map(i => i.id), ['i1'])
    assert.deepEqual(matchIssues(data, { title: 'Fixes OS-1', body: null, branch: 'b' }, 'p1').map(i => i.id), ['i1'])
    assert.deepEqual(matchIssues(data, { title: 'x', body: 'closes [OS-1]', branch: 'b' }, 'p1').map(i => i.id), ['i1'])
    assert.deepEqual(matchIssues(data, { title: 'XOS-1 and OS-10', body: null, branch: 'b' }, 'p1'), [])
  })
  test('team keys match with the stored key', () => {
    const data = base()
    assert.deepEqual(matchIssues(data, { title: 'ENG-5 done', body: null, branch: 'b' }, 'p1').map(i => i.id), ['i2'])
  })
})

describe('syncGitPulls', () => {
  const sync = (data: AppData, pulls: GitPull[], at = '2026-10-02T00:00:00Z') =>
    reducer(data, { type: 'syncGitPulls', projectId: 'p1', repo: 'acme/app', pulls, at })
  const issue = (data: AppData, id: string) => data.issues.find(i => i.id === id)!

  test('creates links, logs activity and summarises prState', () => {
    const out = sync(base(), [pull(12, { title: 'Fix it', branch: 'os-1-fix' })])
    assert.equal(out.gitLinks?.length, 1)
    assert.deepEqual(out.gitLinks![0], {
      id: 'i1:acme/app#12',
      issueId: 'i1',
      provider: 'github',
      repo: 'acme/app',
      number: 12,
      title: 'Fix it',
      url: 'https://github.com/acme/app/pull/12',
      state: 'open',
      branch: 'os-1-fix',
      updatedAt: '2026-10-01T00:00:00Z'
    })
    assert.equal(issue(out, 'i1').prState, 'open')
    assert.equal(issue(out, 'i1').activity.at(-1)?.text, 'Linked PR acme/app#12: Fix it')
    assert.equal(issue(out, 'i2').prState, undefined)
  })

  test('updates state and logs the change; summary follows the links', () => {
    let data = sync(base(), [pull(12, { branch: 'os-1' }), pull(13, { branch: 'os-1-b' })])
    assert.equal(issue(data, 'i1').prState, 'open')
    data = sync(data, [pull(12, { branch: 'os-1', state: 'merged', updatedAt: '2026-10-03T00:00:00Z' }), pull(13, { branch: 'os-1-b', state: 'closed' })])
    assert.equal(issue(data, 'i1').prState, 'merged')
    assert.ok(issue(data, 'i1').activity.some(a => a.text === 'PR acme/app#12 merged'))
    assert.equal(data.gitLinks!.length, 2)
  })

  test('removeGitLink unlinks and recomputes prState', () => {
    const linked = sync(base(), [pull(12, { branch: 'os-1' }), pull(13, { branch: 'os-1-b', state: 'merged' })])
    const out = reducer(linked, { type: 'removeGitLink', id: 'i1:acme/app#12' })
    assert.equal(out.gitLinks!.length, 1)
    assert.equal(issue(out, 'i1').prState, 'merged')
    assert.equal(reducer(out, { type: 'removeGitLink', id: 'nope' }), out)
  })

  test('onOpen moves the issue once, logs the PR url, and records the key', () => {
    const data = base({ gitAutomation: { onOpen: 'in_progress' } })
    const out = sync(data, [pull(12, { branch: 'os-1' })])
    assert.equal(issue(out, 'i1').status, 'in_progress')
    assert.deepEqual(issue(out, 'i1').firedAutomations, ['git:acme/app#12:open'])
    assert.ok(issue(out, 'i1').activity.some(a => a.text === 'Moved by PR https://github.com/acme/app/pull/12'))
  })

  test('draft PRs do not trigger onOpen', () => {
    const data = base({ gitAutomation: { onOpen: 'in_progress' } })
    const out = sync(data, [pull(12, { branch: 'os-1', state: 'open' })])
    const draft = sync(data, [pull(12, { branch: 'os-1', state: 'draft' })])
    assert.equal(issue(out, 'i1').status, 'in_progress')
    assert.equal(issue(draft, 'i1').status, 'todo')
    assert.equal(issue(draft, 'i1').prState, 'draft')
  })

  test('onMerge moves to its status; a manual move back is respected', () => {
    const data = base({ gitAutomation: { onOpen: 'in_progress', onMerge: 'done' } })
    let out = sync(data, [pull(12, { branch: 'os-1' })])
    out = sync(out, [pull(12, { branch: 'os-1', state: 'merged' })])
    assert.equal(issue(out, 'i1').status, 'done')
    out = reducer(out, { type: 'patchIssue', id: 'i1', patch: { status: 'todo' } })
    const again = sync(out, [pull(12, { branch: 'os-1', state: 'merged' })])
    assert.equal(issue(again, 'i1').status, 'todo')
    assert.equal(again, out)
  })

  test('automations are off by default', () => {
    const out = sync(base(), [pull(12, { branch: 'os-1', state: 'merged' })])
    assert.equal(issue(out, 'i1').status, 'todo')
    assert.equal(issue(out, 'i1').firedAutomations, undefined)
  })

  test('an issue already in the target status records the key without a move', () => {
    const data = base({ gitAutomation: { onOpen: 'in_progress' } })
    const started = reducer(data, { type: 'patchIssue', id: 'i1', patch: { status: 'in_progress' } })
    const out = sync(started, [pull(12, { branch: 'os-1' })])
    assert.deepEqual(issue(out, 'i1').firedAutomations, ['git:acme/app#12:open'])
    assert.equal(issue(out, 'i1').activity.some(a => a.text.startsWith('Moved by PR')), false)
  })

  test('a second identical call returns the same object', () => {
    const data = base({ gitAutomation: { onOpen: 'in_progress' } })
    const pulls = [pull(12, { branch: 'os-1' }), pull(99, { branch: 'nothing' })]
    const first = sync(data, pulls)
    assert.notEqual(first, data)
    assert.equal(sync(first, pulls), first)
    assert.equal(sync(data, [pull(99, { branch: 'nothing' })]), data)
  })
})
