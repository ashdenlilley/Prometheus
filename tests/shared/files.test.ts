import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isImageFile, projectFiles } from '../../src/shared/files'
import { createIssue } from '../../src/shared/model'
import { emptyData } from '../../src/shared/seed'
import type { Column, FileRef } from '../../src/shared/types'

const col = (id: string, type: Column['type']): Column => ({ id, name: id, type })
const file = (name: string): FileRef => ({ name, size: 1, dataUrl: `data:application/octet-stream;base64,AA==` })

describe('projectFiles', () => {
  test('collects files from every files column and ignores other types', () => {
    const columns = [col('a', 'files'), col('t', 'text'), col('b', 'files')]
    const one = createIssue(emptyData(), 'p1', 'One', {
      values: { a: [file('x.pdf')], t: 'not a file', b: [file('y.png'), file('z.txt')] }
    })
    const two = createIssue(emptyData(), 'p1', 'Two', { values: { t: [file('ignored.pdf')] } })
    const out = projectFiles([one, two], columns)
    assert.deepEqual(
      out.map(f => [f.file.name, f.issueId, f.columnId]),
      [
        ['x.pdf', one.id, 'a'],
        ['y.png', one.id, 'b'],
        ['z.txt', one.id, 'b']
      ]
    )
  })

  test('includes comment attachments after column files', () => {
    const one = createIssue(emptyData(), 'p1', 'One', { values: { a: [file('x.pdf')] } })
    one.comments = [{ id: 'c1', author: 'me', body: 'see', at: '2026-01-01T00:00:00.000Z', files: [file('shot.png')] }]
    assert.deepEqual(
      projectFiles([one], [col('a', 'files')]).map(f => [f.file.name, f.columnId]),
      [['x.pdf', 'a'], ['shot.png', 'comment:c1']]
    )
  })

  test('isImageFile checks the extension or a data:image URL', () => {
    assert.equal(isImageFile({ name: 'Photo.JPG', size: 1, dataUrl: 'data:application/octet-stream;base64,AA==' }), true)
    assert.equal(isImageFile({ name: 'scan', size: 1, dataUrl: 'data:image/png;base64,AA==' }), true)
    assert.equal(isImageFile(file('notes.pdf')), false)
  })
})
