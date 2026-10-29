import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { describeRecurrence, nextOccurrence } from '../../src/shared/recurrence'
import { createIssue, reducer, runRecurrences } from '../../src/shared/model'
import { migrate } from '../../src/shared/migrate'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Issue, Recurrence } from '../../src/shared/types'

const rule = (r: Omit<Recurrence, 'next'>): Recurrence => ({ next: '', ...r })

// Walks the rule forward from `start`, collecting the next `count` dates.
function chain(r: Recurrence, start: string, count: number): string[] {
  const out: string[] = []
  let at = start
  for (let n = 0; n < count; n++) {
    at = nextOccurrence(r, at)
    out.push(at)
  }
  return out
}

const withData = (issue: Issue): AppData => ({
  ...emptyData(),
  projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000' })],
  issues: [issue]
})

// createIssue numbers from the data passed in, so the source is always issue 1.
const source = (patch: Partial<Issue> = {}): Issue =>
  createIssue(emptyData(), 'p1', 'Water plants', {
    number: 1,
    description: 'Ferns and the balcony pots',
    labels: ['home', 'chores'],
    priority: 2,
    assignee: 'Ann',
    estimate: 3,
    recurrence: rule({ kind: 'weekly', weekdays: [4], dueInDays: 2 }),
    ...patch
  })

describe('nextOccurrence', () => {
  test('daily is the following day', () => {
    assert.equal(nextOccurrence(rule({ kind: 'daily' }), '2026-10-29'), '2026-10-30')
  })

  test('weekly with several weekdays from a Thursday gives the next Monday, then Thursday', () => {
    const r = rule({ kind: 'weekly', weekdays: [1, 4] })
    assert.deepEqual(chain(r, '2026-10-29', 3), ['2026-11-02', '2026-11-05', '2026-11-09'])
  })

  test('weekly stays on its weekdays across the Australian DST change (2026-10-04)', () => {
    const r = rule({ kind: 'weekly', weekdays: [1, 4] })
    assert.deepEqual(chain(r, '2026-10-01', 3), ['2026-10-05', '2026-10-08', '2026-10-12'])
  })

  test('weekly stays on its weekdays across the US DST change (2026-03-08)', () => {
    const r = rule({ kind: 'weekly', weekdays: [1, 4] })
    assert.deepEqual(chain(r, '2026-03-05', 3), ['2026-03-09', '2026-03-12', '2026-03-16'])
  })

  test('weekly with no weekdays behaves like every 7 days', () => {
    assert.equal(nextOccurrence(rule({ kind: 'weekly' }), '2026-10-29'), '2026-11-05')
  })

  test('monthly on the 31st clamps to the last day of short months, then returns to 31', () => {
    const r = rule({ kind: 'monthly', monthDay: 31 })
    assert.deepEqual(chain(r, '2026-01-31', 3), ['2026-02-28', '2026-03-31', '2026-04-30'])
  })

  test('monthly on the 31st in a leap February clamps to 29 Feb 2028', () => {
    assert.equal(nextOccurrence(rule({ kind: 'monthly', monthDay: 31 }), '2028-01-31'), '2028-02-29')
    assert.equal(nextOccurrence(rule({ kind: 'monthly', monthDay: 31 }), '2027-01-31'), '2027-02-28')
  })

  test('monthly on the 29th in February 2028 lands on the leap day, not the 1st of March', () => {
    assert.equal(nextOccurrence(rule({ kind: 'monthly', monthDay: 29 }), '2028-01-29'), '2028-02-29')
    assert.equal(nextOccurrence(rule({ kind: 'monthly', monthDay: 29 }), '2028-02-29'), '2028-03-29')
  })

  test('monthly rolls over the year end', () => {
    assert.equal(nextOccurrence(rule({ kind: 'monthly', monthDay: 5 }), '2026-12-20'), '2027-01-05')
  })

  test('every 3 days', () => {
    assert.deepEqual(chain(rule({ kind: 'interval', every: 3 }), '2026-10-29', 2), ['2026-11-01', '2026-11-04'])
  })

  test('interval below 1 is treated as 1', () => {
    assert.equal(nextOccurrence(rule({ kind: 'interval', every: 0 }), '2026-10-29'), '2026-10-30')
  })
})

describe('describeRecurrence', () => {
  test('describes each kind', () => {
    assert.equal(describeRecurrence(rule({ kind: 'daily' })), 'Every day')
    assert.equal(describeRecurrence(rule({ kind: 'weekly', weekdays: [4, 1] })), 'Weekly on Mon, Thu')
    assert.equal(describeRecurrence(rule({ kind: 'weekly' })), 'Weekly')
    assert.equal(describeRecurrence(rule({ kind: 'monthly', monthDay: 31 })), 'Monthly on day 31')
    assert.equal(describeRecurrence(rule({ kind: 'interval', every: 3 })), 'Every 3 days')
  })
})

describe('runRecurrences', () => {
  test('creates one copy with the copied fields and due date, then advances the rule', () => {
    const data = withData(source())
    const out = runRecurrences(data, '2026-10-29')
    assert.equal(out.issues.length, 2)
    const copy = out.issues[1]
    assert.equal(copy.title, 'Water plants')
    assert.equal(copy.description, 'Ferns and the balcony pots')
    assert.deepEqual(copy.labels, ['home', 'chores'])
    assert.equal(copy.priority, 2)
    assert.equal(copy.assignee, 'Ann')
    assert.equal(copy.estimate, 3)
    assert.equal(copy.dueDate, '2026-10-31')
    assert.equal(copy.recurrence, undefined)
    assert.equal(copy.number, 2)
    assert.equal(copy.status, 'backlog')
    assert.match(copy.activity[0].text, /Created from HOME-1/)
    assert.equal(out.issues[0].recurrence?.next, '2026-11-05')
  })

  test('a second run on the same day creates nothing and returns the same reference', () => {
    const once = runRecurrences(withData(source()), '2026-10-29')
    assert.equal(runRecurrences(once, '2026-10-29'), once)
  })

  test('after 10 missed days a long gap creates exactly one copy, then the next future date', () => {
    const data = withData(source({ recurrence: rule({ kind: 'daily' }) }))
    data.issues[0].recurrence!.next = '2026-10-19'
    const out = runRecurrences(data, '2026-10-29')
    assert.equal(out.issues.length, 2)
    assert.equal(out.issues[0].recurrence?.next, '2026-10-30')
    assert.equal(runRecurrences(out, '2026-10-29'), out)
    assert.equal(runRecurrences(out, '2026-10-30').issues.length, 3)
  })

  test('no recurrence returns the same reference', () => {
    const data = withData(source({ recurrence: undefined }))
    assert.equal(runRecurrences(data, '2026-10-29'), data)
  })

  test('no dueInDays leaves the copy without a due date', () => {
    const out = runRecurrences(withData(source({ recurrence: rule({ kind: 'daily' }) })), '2026-10-29')
    assert.equal(out.issues[1].dueDate, undefined)
  })

  test('the tick action creates the copy', () => {
    const out = reducer(withData(source()), { type: 'tick', today: '2026-10-29' })
    assert.equal(out.issues.length, 2)
  })

  test('an old issue without a recurrence field loads and ticks unchanged', () => {
    const old = withData(source({ recurrence: undefined }))
    const loaded = migrate(old)
    const ticked = reducer(loaded, { type: 'tick', today: '2026-10-29' })
    assert.deepEqual(ticked.issues, old.issues)
  })
})
