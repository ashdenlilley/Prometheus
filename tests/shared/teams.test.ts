import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../../src/shared/migrate'
import { blankProject, emptyData } from '../../src/shared/seed'
import { createIssue, issueKey, reducer } from '../../src/shared/model'
import { canArchiveTeam, ensureTeams, resolveNumberClashes, validTeamKey } from '../../src/shared/teams'
import { DEFAULT_STATUSES, type AppData, type Project, type StatusDef, type Team } from '../../src/shared/types'

const proj = (id: string, key: string) => blankProject({ id, spaceId: 's1', name: id, key, color: '#000000' })
const team = (over: Partial<Team> = {}): Team => ({
  id: 'eng',
  spaceId: 's1',
  name: 'Engineering',
  key: 'ENG',
  color: '#000000',
  members: [],
  statuses: DEFAULT_STATUSES,
  nextNumber: 1,
  cycleLength: 14,
  autoCycles: false,
  ...over
})
const base = (projects: Project[]): AppData => ensureTeams({ ...emptyData(), spaces: [{ id: 's1', name: 'Work', color: '#000000' }], projects })

describe('teams: v4 to v5 migration', () => {
  const v4 = {
    version: 4,
    spaces: [{ id: 's1', name: 'Work', color: '#000000' }],
    projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Core', key: 'CORE', color: '#111111', cycleLength: 30, autoCycles: true })],
    issues: [createIssue(emptyData(), 'p1', 'First', { number: 1 }), createIssue(emptyData(), 'p1', 'Second', { number: 2 })],
    cycles: [{ id: 'c1', projectId: 'p1', name: 'Cycle 1', startDate: '2026-10-01', endDate: '2026-10-14' }]
  }

  test('a v4 file gets one team per project, with the project key and next free number', () => {
    const out = migrate(v4)
    assert.equal(out.version, 5)
    assert.equal(out.teams.length, 1)
    const [t] = out.teams
    assert.deepEqual([t.id, t.key, t.nextNumber, t.cycleLength, t.autoCycles], ['team-p1', 'CORE', 3, 30, true])
    assert.deepEqual(t.statuses, out.projects[0].statuses)
    assert.equal(out.projects[0].teamId, 'team-p1')
  })

  test('every issue keeps its displayed key and gets the key stamped', () => {
    const out = migrate(v4)
    assert.deepEqual(out.issues.map(i => issueKey(out, i)), ['CORE-1', 'CORE-2'])
    assert.deepEqual(out.issues.map(i => i.key), ['CORE', 'CORE'])
  })

  test('cycles get the teamId of their project', () => {
    assert.equal(migrate(v4).cycles[0].teamId, 'team-p1')
  })

  test('migrating twice, or ensuring teams twice, changes nothing', () => {
    const out = migrate(v4)
    assert.equal(migrate(out), out)
    assert.equal(ensureTeams(out), out)
  })
})

describe('teams: numbering', () => {
  test('two projects in one team share one number sequence', () => {
    let d = base([proj('p1', 'WEB'), proj('p2', 'API')])
    d = reducer(d, { type: 'addTeam', team: team() })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p1', teamId: 'eng' })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p2', teamId: 'eng' })
    d = reducer(d, { type: 'addIssue', issue: createIssue(d, 'p1', 'A') })
    d = reducer(d, { type: 'addIssue', issue: createIssue(d, 'p2', 'B') })
    assert.deepEqual(d.issues.map(i => issueKey(d, i)), ['ENG-1', 'ENG-2'])
  })

  test('moving a project keeps its old keys, and new issues use the new team key', () => {
    let d = base([proj('p1', 'WEB')])
    d = reducer(d, { type: 'addIssue', issue: createIssue(d, 'p1', 'Old') })
    d = reducer(d, { type: 'addTeam', team: team({ id: 'ops', key: 'OPS' }) })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p1', teamId: 'ops' })
    d = reducer(d, { type: 'addIssue', issue: createIssue(d, 'p1', 'New') })
    assert.deepEqual(d.issues.map(i => issueKey(d, i)), ['WEB-1', 'OPS-1'])
  })

  test('a kept WEB-12 and a new ENG-12 are different keys, so they do not clash', () => {
    let d = base([proj('p1', 'WEB'), proj('p2', 'API')])
    d = reducer(d, { type: 'addIssue', issue: { ...createIssue(d, 'p1', 'Kept'), number: 12 } })
    d = reducer(d, { type: 'addTeam', team: team({ nextNumber: 12 }) })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p2', teamId: 'eng' })
    d = reducer(d, { type: 'addIssue', issue: createIssue(d, 'p2', 'New') })
    assert.deepEqual(d.issues.map(i => issueKey(d, i)), ['WEB-12', 'ENG-12'])
    assert.equal(resolveNumberClashes(d), d)
  })

  test('a number clash keeps the earlier issue and renumbers the later one, the same way in any order', () => {
    let d = base([proj('p1', 'P1'), proj('p2', 'P2')])
    d = reducer(d, { type: 'addTeam', team: team() })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p1', teamId: 'eng' })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p2', teamId: 'eng' })
    const early = { ...createIssue(d, 'p1', 'Early'), id: 'a', number: 5, key: 'ENG', createdAt: '2026-10-01T00:00:00.000Z' }
    const late = { ...createIssue(d, 'p2', 'Late'), id: 'b', number: 5, key: 'ENG', createdAt: '2026-10-02T00:00:00.000Z' }
    const now = Date.parse('2026-10-02T00:00:10.000Z')
    const fwd = resolveNumberClashes({ ...d, issues: [early, late] }, now)
    const rev = resolveNumberClashes({ ...d, issues: [late, early] }, now)
    const numberOf = (x: AppData, id: string) => x.issues.find(i => i.id === id)?.number
    assert.deepEqual([numberOf(fwd, 'a'), numberOf(fwd, 'b')], [5, 6])
    assert.deepEqual([numberOf(rev, 'a'), numberOf(rev, 'b')], [5, 6])
    assert.equal(fwd.issues.find(i => i.id === 'b')?.activity[0].text, 'Renumbered from ENG-5 to ENG-6 after a sync clash')
    assert.equal(fwd.teams.find(t => t.id === 'eng')?.nextNumber, 7)
  })

  test('an old issue is never renumbered, even when it shares a kept key and number in its team', () => {
    let d = base([proj('p1', 'P1'), proj('p2', 'P2')])
    d = reducer(d, { type: 'addTeam', team: team() })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p1', teamId: 'eng' })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p2', teamId: 'eng' })
    const a = { ...createIssue(d, 'p1', 'A'), id: 'a', number: 3, key: 'WEB', createdAt: '2026-01-01T00:00:00.000Z' }
    const b = { ...createIssue(d, 'p2', 'B'), id: 'b', number: 3, key: 'WEB', createdAt: '2026-01-02T00:00:00.000Z' }
    const data = { ...d, issues: [a, b] }
    assert.equal(resolveNumberClashes(data, Date.parse('2026-10-29T00:00:00.000Z')), data)
  })

  test('issues in different teams with the same key and number are not a clash', () => {
    let d = base([proj('p1', 'P1'), proj('p2', 'P2')])
    const a = { ...createIssue(d, 'p1', 'A'), id: 'a', number: 1, key: 'DUP', createdAt: '2026-10-02T00:00:00.000Z' }
    const b = { ...createIssue(d, 'p2', 'B'), id: 'b', number: 1, key: 'DUP', createdAt: '2026-10-02T00:00:01.000Z' }
    const data = { ...d, issues: [a, b] }
    assert.equal(resolveNumberClashes(data, Date.parse('2026-10-02T00:00:05.000Z')), data)
  })

  test('resolveNumberClashes returns the same object when there is no clash', () => {
    let d = base([proj('p1', 'P1')])
    d = reducer(d, { type: 'addIssue', issue: createIssue(d, 'p1', 'Only') })
    assert.equal(resolveNumberClashes(d), d)
  })
})

describe('teams: keys, statuses and archiving', () => {
  test('a team key is 1 to 10 uppercase letters or digits, starts with a letter, and is unique in the workspace', () => {
    const d = { ...base([]), teams: [team()] }
    assert.equal(validTeamKey(d, 'OPS'), true)
    assert.equal(validTeamKey(d, 'ENG'), false)
    assert.equal(validTeamKey(d, 'ENG', 'eng'), true)
    assert.equal(validTeamKey(d, 'eng'), false)
    assert.equal(validTeamKey(d, '1OPS'), false)
    assert.equal(validTeamKey(d, 'A-B'), false)
    assert.equal(validTeamKey(d, ''), false)
    assert.equal(validTeamKey(d, 'ABCDEFGHIJ'), true)
    assert.equal(validTeamKey(d, 'ABCDEFGHIJK'), false)
  })

  test('patching statuses and cycle settings on a team writes them through to every project in it', () => {
    let d = base([proj('p1', 'WEB'), proj('p2', 'API')])
    d = reducer(d, { type: 'addTeam', team: team() })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p1', teamId: 'eng' })
    d = reducer(d, { type: 'moveProjectToTeam', projectId: 'p2', teamId: 'eng' })
    const statuses: StatusDef[] = [...DEFAULT_STATUSES, { id: 'qa', label: 'QA', color: '#000000', category: 'started' }]
    d = reducer(d, { type: 'patchTeam', id: 'eng', patch: { statuses, cycleLength: 21 } })
    assert.deepEqual(d.projects.map(p => p.statuses), [statuses, statuses])
    assert.deepEqual(d.projects.map(p => p.cycleLength), [21, 21])
  })

  test('a team can be archived only when no project uses it', () => {
    let d = base([proj('p1', 'WEB')])
    assert.equal(canArchiveTeam(d, 'team-p1'), false)
    d = reducer(d, { type: 'archiveTeam', id: 'team-p1' })
    assert.equal(d.teams[0].archivedAt, undefined)
    d = reducer(d, { type: 'addTeam', team: team() })
    assert.equal(canArchiveTeam(d, 'eng'), true)
    d = reducer(d, { type: 'archiveTeam', id: 'eng' })
    assert.ok(d.teams.find(t => t.id === 'eng')?.archivedAt)
  })
})
