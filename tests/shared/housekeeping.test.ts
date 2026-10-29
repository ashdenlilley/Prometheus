import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createIssue, reducer, runHousekeeping } from '../../src/shared/model'
import { migrate } from '../../src/shared/migrate'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Issue, Project } from '../../src/shared/types'

const TODAY = '2026-10-29'
const OLD = '2026-09-01T10:00:00.000Z' // 58 days before TODAY
const RECENT = '2026-10-25T10:00:00.000Z' // 4 days before TODAY

// Project p1 (key HOME) with the given housekeeping settings, and issues built with createIssue.
const setup = (project: Partial<Project>, issues: Partial<Issue>[]): AppData => {
  let data: AppData = { ...emptyData(), projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000', ...project })] }
  issues.forEach((patch, n) => {
    data = { ...data, issues: [...data.issues, createIssue(data, 'p1', `Issue ${n + 1}`, { number: n + 1, updatedAt: OLD, createdAt: OLD, ...patch })] }
  })
  return data
}

const closeAfter30 = { autoClose: { days: 30, status: 'canceled' } }
const archiveAfter14 = { autoArchive: { days: 14 } }
const byTitle = (s: AppData, title: string) => s.issues.find(i => i.title === title)!

describe('auto-close', () => {
  test('closes an open issue untouched for N days: status, activity and notification', () => {
    const s = setup(closeAfter30, [{ status: 'todo' }])
    const out = runHousekeeping(s, TODAY)
    const issue = byTitle(out, 'Issue 1')
    assert.equal(issue.status, 'canceled')
    assert.deepEqual(
      issue.activity.map(a => a.text),
      ['Status: Todo → Canceled', 'Auto-closed after 30 days without updates']
    )
    assert.equal(out.notifications.length, 1)
    assert.equal(out.notifications[0].text, 'HOME-1 auto-closed after 30 days without updates')
    assert.equal(out.notifications[0].issueId, issue.id)
    assert.equal(out.notifications[0].read, false)
  })

  test('does not close before N days have passed', () => {
    const s = setup(closeAfter30, [{ status: 'todo', updatedAt: '2026-09-30T10:00:00.000Z' }])
    assert.equal(runHousekeeping(s, TODAY), s)
  })

  test('does not close completed, canceled, triage or archived issues', () => {
    const s = setup(closeAfter30, [{ status: 'done' }, { status: 'canceled' }, { status: 'todo', triage: true }, { status: 'todo', archivedAt: RECENT }])
    assert.equal(runHousekeeping(s, TODAY), s)
  })

  test('does nothing when the target status is not a canceled-category status', () => {
    const s = setup({ autoClose: { days: 30, status: 'done' } }, [{ status: 'todo' }])
    assert.equal(runHousekeeping(s, TODAY), s)
  })

  test('a second run changes nothing and returns the same reference', () => {
    const once = runHousekeeping(setup(closeAfter30, [{ status: 'todo' }]), TODAY)
    assert.equal(runHousekeeping(once, TODAY), once)
  })
})

describe('auto-archive', () => {
  test('archives completed and canceled issues untouched for N days, with an activity entry', () => {
    const s = setup(archiveAfter14, [{ status: 'done' }, { status: 'canceled' }, { status: 'done', updatedAt: RECENT }])
    const out = runHousekeeping(s, TODAY)
    assert.ok(byTitle(out, 'Issue 1').archivedAt)
    assert.ok(byTitle(out, 'Issue 2').archivedAt)
    assert.equal(byTitle(out, 'Issue 3').archivedAt, undefined)
    assert.equal(byTitle(out, 'Issue 1').updatedAt, OLD)
    assert.deepEqual(byTitle(out, 'Issue 1').activity.map(a => a.text), ['Archived automatically'])
    assert.equal(out.notifications.length, 0)
  })

  test('does not archive open issues', () => {
    const s = setup(archiveAfter14, [{ status: 'todo' }])
    assert.equal(runHousekeeping(s, TODAY), s)
  })

  test('a second run changes nothing and returns the same reference', () => {
    const once = runHousekeeping(setup(archiveAfter14, [{ status: 'done' }]), TODAY)
    assert.equal(runHousekeeping(once, TODAY), once)
  })

  test('an unarchived issue is not archived again on the same day', () => {
    const archived = runHousekeeping(setup(archiveAfter14, [{ status: 'done' }]), TODAY)
    const unarchived = reducer(archived, { type: 'patchIssue', id: byTitle(archived, 'Issue 1').id, patch: { archivedAt: undefined } })
    assert.equal(byTitle(unarchived, 'Issue 1').archivedAt, undefined)
    assert.deepEqual(byTitle(unarchived, 'Issue 1').activity.map(a => a.text).slice(-1), ['Unarchived'])
    // Unarchiving bumps updatedAt to now, so the same-day check is run on that day.
    const day = byTitle(unarchived, 'Issue 1').updatedAt.slice(0, 10)
    assert.equal(runHousekeeping(unarchived, day), unarchived)
  })
})

describe('housekeeping on old data', () => {
  test('a project without the settings is unchanged, even with old completed issues', () => {
    const s = setup({}, [{ status: 'todo' }, { status: 'done' }])
    assert.equal(runHousekeeping(s, TODAY), s)
  })

  test('v4 data without archivedAt loads and ticks unchanged', () => {
    const old = setup({ ...closeAfter30, ...archiveAfter14 }, [{ status: 'done', updatedAt: RECENT }, { status: 'in_progress', updatedAt: RECENT }])
    const loaded = migrate(structuredClone(old))
    assert.equal(loaded.issues.some(i => 'archivedAt' in i), false)
    assert.equal(runHousekeeping(loaded, TODAY), loaded)
  })

  test('the tick action runs housekeeping', () => {
    const s = setup({ ...closeAfter30, ...archiveAfter14 }, [{ status: 'todo' }, { status: 'done' }])
    const out = reducer(s, { type: 'tick', today: TODAY })
    assert.equal(byTitle(out, 'Issue 1').status, 'canceled')
    assert.ok(byTitle(out, 'Issue 2').archivedAt)
  })
})
