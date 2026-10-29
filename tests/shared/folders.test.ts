import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData } from '../../src/shared/types'

const base = (): AppData => ({
  ...emptyData(),
  spaces: [{ id: 's1', name: 'Work', color: '#000000', folders: [{ id: 'f1', name: 'Q1' }] }],
  projects: [
    blankProject({ id: 'p1', spaceId: 's1', name: 'Alpha', key: 'ALP', color: '#000000', folderId: 'f1' }),
    blankProject({ id: 'p2', spaceId: 's1', name: 'Beta', key: 'BET', color: '#000000' })
  ]
})

describe('folders', () => {
  test('addFolder appends to the space', () => {
    const out = reducer(base(), { type: 'addFolder', spaceId: 's1', folder: { id: 'f2', name: 'Q2' } })
    assert.deepEqual(out.spaces[0].folders, [{ id: 'f1', name: 'Q1' }, { id: 'f2', name: 'Q2' }])
  })

  test('addFolder creates the list in a space without folders', () => {
    const data: AppData = { ...emptyData(), spaces: [{ id: 's1', name: 'Work', color: '#000000' }] }
    const out = reducer(data, { type: 'addFolder', spaceId: 's1', folder: { id: 'f1', name: 'Q1' } })
    assert.deepEqual(out.spaces[0].folders, [{ id: 'f1', name: 'Q1' }])
  })

  test('renameFolder changes only the name', () => {
    const out = reducer(base(), { type: 'renameFolder', spaceId: 's1', folderId: 'f1', name: 'Quarter 1' })
    assert.deepEqual(out.spaces[0].folders, [{ id: 'f1', name: 'Quarter 1' }])
  })

  test('toggleFolder flips collapsed both ways', () => {
    const once = reducer(base(), { type: 'toggleFolder', spaceId: 's1', folderId: 'f1' })
    assert.equal(once.spaces[0].folders?.[0].collapsed, true)
    const twice = reducer(once, { type: 'toggleFolder', spaceId: 's1', folderId: 'f1' })
    assert.equal(twice.spaces[0].folders?.[0].collapsed, false)
  })

  test('deleteFolder moves its projects to the root and keeps them', () => {
    const out = reducer(base(), { type: 'deleteFolder', spaceId: 's1', folderId: 'f1' })
    assert.deepEqual(out.spaces[0].folders, [])
    assert.equal(out.projects.length, 2)
    assert.equal(out.projects.find(p => p.id === 'p1')?.folderId, undefined)
    assert.equal(out.projects.find(p => p.id === 'p2')?.folderId, undefined)
  })

  test('moveProjectToFolder sets and clears the folder', () => {
    const into = reducer(base(), { type: 'moveProjectToFolder', projectId: 'p2', folderId: 'f1' })
    assert.equal(into.projects.find(p => p.id === 'p2')?.folderId, 'f1')
    const root = reducer(into, { type: 'moveProjectToFolder', projectId: 'p2', folderId: null })
    assert.equal(root.projects.find(p => p.id === 'p2')?.folderId, undefined)
  })

  test('moveProjectToFolder ignores a folder from another space', () => {
    const data: AppData = {
      ...base(),
      spaces: [...base().spaces, { id: 's2', name: 'Home', color: '#111111', folders: [{ id: 'f9', name: 'Chores' }] }],
      projects: [...base().projects, blankProject({ id: 'p3', spaceId: 's2', name: 'Gamma', key: 'GAM', color: '#000000' })]
    }
    const out = reducer(data, { type: 'moveProjectToFolder', projectId: 'p2', folderId: 'f9' })
    assert.equal(out, data)
  })

  test('a space without folders still works', () => {
    const data: AppData = {
      ...emptyData(),
      spaces: [{ id: 's1', name: 'Work', color: '#000000' }],
      projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Alpha', key: 'ALP', color: '#000000' })]
    }
    const out = reducer(data, { type: 'moveProjectToFolder', projectId: 'p1', folderId: null })
    assert.equal(out.projects[0].folderId, undefined)
    const del = reducer(data, { type: 'deleteFolder', spaceId: 's1', folderId: 'missing' })
    assert.equal(del.projects.length, 1)
    assert.deepEqual(del.spaces[0].folders, [])
  })
})
