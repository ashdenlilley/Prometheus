import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { issuesFromRows, issuesToCSV, issuesToRows, parseCSV, sheetText } from '../../src/shared/query'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Project } from '../../src/shared/types'

// Node entry points of the same packages the renderer imports from /browser. CommonJS and node10 resolution can't see the subpath exports.
const writeXlsxFile = require('write-excel-file/node')
const { readSheet } = require('read-excel-file/node')

const project: Project = blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000' })
const data: AppData = { ...emptyData(), projects: [project] }

const a = createIssue(data, 'p1', 'Water plants, "ferns"', {
  number: 1,
  status: 'todo',
  priority: 2,
  assignee: 'Ann',
  labels: ['home', 'chores'],
  startDate: '2026-10-30',
  dueDate: '2026-11-03',
  estimate: 2.5
})
const b = createIssue(data, 'p1', 'Pay rent', { number: 2, status: 'done', priority: 1 })
const issues = [a, b]

describe('xlsx round trip', () => {
  test('the xlsx rows equal the CSV rows', async () => {
    const buffer = await writeXlsxFile(issuesToRows(data, project, issues)).toBuffer()
    const sheet = await readSheet(buffer)
    assert.deepEqual(sheetText(sheet), parseCSV(issuesToCSV(data, project, issues)))
  })

  test('importing the xlsx gives back the same issues', async () => {
    const buffer = await writeXlsxFile(issuesToRows(data, project, issues)).toBuffer()
    const back = issuesFromRows(data, project, sheetText(await readSheet(buffer)))
    const fields = (i: typeof a) => [i.title, i.status, i.priority, i.assignee, i.dueDate, i.estimate]
    assert.deepEqual(back.map(fields), issues.map(fields))
  })

  test('the Start column comes back too', { todo: 'the import mapping ignores the Start column (pre-existing, CSV and XLSX)' }, () => {
    const back = issuesFromRows(data, project, sheetText(parseCSV(issuesToCSV(data, project, issues))))
    assert.deepEqual(back.map(i => i.startDate), issues.map(i => i.startDate))
  })

  test('a file without a Title column imports nothing', () => {
    assert.deepEqual(issuesFromRows(data, project, [['Key', 'Status'], ['HOME-1', 'Todo']]), [])
  })
})

describe('sheetText', () => {
  test('dates become local YYYY-MM-DD and empty cells become empty text', () => {
    assert.deepEqual(sheetText([[new Date(2026, 10, 3), null, 4, true]]), [['2026-11-03', '', '4', 'true']])
  })
})
