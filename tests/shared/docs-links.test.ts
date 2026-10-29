import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkMentions } from '../../src/shared/docs'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'

test('linkMentions links known keys and skips fenced code', () => {
  const base = emptyData()
  const data = {
    ...base,
    projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Core', key: 'OS', color: '#000000' })],
    issues: [createIssue(base, 'p1', 'Docs', { id: 'i354', number: 354 })]
  }
  const link = '<a href="#issue:i354" class="issue-mention">OS-354</a>'
  assert.equal(linkMentions('See OS-354 and OS-999.', data), `See ${link} and OS-999.`)
  assert.equal(linkMentions('x\n```\nOS-354\n```\nOS-354', data), `x\n\`\`\`\nOS-354\n\`\`\`\n${link}`)
})
