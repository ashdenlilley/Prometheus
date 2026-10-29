import { issueKey } from './model'
import type { AppData, Doc } from './types'

// Pure helpers for Markdown docs (OS-354). No fs, no Electron.

export const DOC_WARN_BYTES = 256 * 1024
export const DOC_MAX_BYTES = 512 * 1024

const encoder = new TextEncoder()
export const docBytes = (body: string) => encoder.encode(body).length

// KEY-N, e.g. OS-354. Same shape as the issue keys formed by issueKey().
const MENTION = /\b([A-Z][A-Z0-9]{0,9})-(\d+)\b/g
// Fenced code (``` or ~~~) is not prose, so mentions inside it do not count.
const FENCE = /(```|~~~)[\s\S]*?\1/g

/** Issue ids mentioned in a body. Unknown keys are ignored. */
export function findMentions(body: string, data: AppData): string[] {
  const byKey = new Map(data.issues.map(i => [issueKey(data, i), i.id]))
  const out = new Set<string>()
  for (const m of body.replace(FENCE, '').matchAll(MENTION)) {
    const id = byKey.get(m[0])
    if (id) out.add(id)
  }
  return [...out]
}

/** Live docs (not archived, not templates) that mention the issue. */
export function backlinks(issueId: string, data: AppData): Doc[] {
  return (data.docs ?? []).filter(d => !d.archivedAt && !d.template && findMentions(d.body, data).includes(issueId))
}

export function newDoc(init: Partial<Doc> & Pick<Doc, 'spaceId' | 'title'>): Doc {
  const now = Date.now()
  return { id: crypto.randomUUID(), body: '', createdAt: now, updatedAt: now, ...init }
}

/** A new doc from a template: copies its title and body. The result is never a template itself. */
export function docFromTemplate(template: Doc, init: Partial<Doc> & Pick<Doc, 'spaceId'>): Doc {
  return newDoc({ ...init, title: template.title, body: template.body, template: false })
}

/** Title matches come first. Archived docs are left out. Empty queries match nothing. */
export function searchDocs(data: AppData, q: string): Doc[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const hits = (data.docs ?? []).filter(d => !d.archivedAt && (d.title.toLowerCase().includes(needle) || d.body.toLowerCase().includes(needle)))
  const inTitle = (d: Doc) => d.title.toLowerCase().includes(needle)
  return [...hits.filter(inTitle), ...hits.filter(d => !inTitle(d))]
}

/**
 * New body for a doc. Throws when the body is over DOC_MAX_BYTES; callers show the error, nothing is saved.
 * rev is a fresh id for every edit. baseRev is the rev this edit started from, set when another session
 * made the last edit. Successive edits from one session keep the baseRev they started with.
 */
export function editBody(doc: Doc, body: string, session: string, now = Date.now()): Doc {
  if (docBytes(body) > DOC_MAX_BYTES) throw new Error(`Doc body is over ${DOC_MAX_BYTES} bytes`)
  return {
    ...doc,
    body,
    updatedAt: now,
    rev: crypto.randomUUID(),
    ...(doc.revBy === session ? {} : { baseRev: doc.rev, revBy: session })
  }
}

// The body fields an incoming sync op carries. Only the ones present in the op are set.
export type IncomingBody = Partial<Pick<Doc, 'body' | 'rev' | 'baseRev' | 'revBy' | 'title' | 'updatedAt'>>

/**
 * Conflict when both sides edited from a common base on different sessions. Returns the losing side's body
 * as a new doc. Its id comes from the loser's rev, so both devices build the same copy.
 */
export function docConflictCopy(local: Doc, incoming: IncomingBody, incomingWins: boolean): Doc | null {
  if (!local.rev || !incoming.rev) return null
  if (local.rev === incoming.rev || local.rev === incoming.baseRev || local.revBy === incoming.revBy) return null
  const loserRev = incomingWins ? local.rev : incoming.rev
  // Timestamps come from the losing side too, so both devices build the same copy.
  const loser = incomingWins
    ? { body: local.body, title: local.title, updatedAt: local.updatedAt }
    : { body: incoming.body ?? '', title: incoming.title ?? local.title, updatedAt: incoming.updatedAt ?? local.updatedAt }
  return {
    id: `${local.id}~${loserRev}`,
    spaceId: local.spaceId,
    projectId: local.projectId,
    teamId: local.teamId,
    title: `${loser.title} (conflicted copy)`,
    body: loser.body,
    createdAt: local.createdAt,
    updatedAt: loser.updatedAt,
    rev: loserRev,
    conflictOf: local.id
  }
}

/**
 * Body with KEY-N mentions of existing issues turned into '#issue:<id>' links. Fenced code and unknown keys are left as they are.
 * One pass over fences and mentions together, so a mention inside a fence is never matched.
 */
export function linkMentions(body: string, data: AppData): string {
  const byKey = new Map(data.issues.map(i => [issueKey(data, i), i.id]))
  const pattern = new RegExp(FENCE.source + '|' + MENTION.source, 'g')
  return body.replace(pattern, m => {
    const id = byKey.get(m)
    return id ? `<a href="#issue:${id}" class="issue-mention">${m}</a>` : m
  })
}
