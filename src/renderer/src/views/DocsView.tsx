import { useMemo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { DOC_MAX_BYTES, DOC_WARN_BYTES, docBytes, docFromTemplate, editBody, newDoc } from '@shared/docs'
import type { Doc, Project, Space } from '@shared/types'
import { ICONS } from '../components/icons'
import { useStore } from '../store'
import type { Route } from '../route'
import { renderMarkdown } from '../markdown'
import { clsx, uid } from '../util'

// Identifies this app session to editBody, so edits from other sessions can be told apart (see docConflictCopy).
const SESSION = uid()

interface DocsViewProps {
  space: Space
  project?: Project
  docId: string | null
  onNavigate: (route: Route) => void
  onOpen: (issueId: string) => void
}

// Docs under a space (no project) or under one project. Templates and archived docs are not listed.
export function DocsView({ space, project, docId, onNavigate, onOpen }: DocsViewProps) {
  const { data, dispatch } = useStore()
  const [filter, setFilter] = useState('space') // 'space', 'all' or a project id
  const docs = data.docs ?? []
  const goto = (id: string | null) => onNavigate({ spaceId: space.id, projectId: project?.id ?? null, view: 'docs', docId: id })

  const live = docs.filter(d => d.spaceId === space.id && !d.archivedAt && !d.template)
  const shown = project
    ? live.filter(d => d.projectId === project.id)
    : live.filter(d => filter === 'all' || (filter === 'space' ? !d.projectId : d.projectId === filter))
  const templates = docs.filter(d => d.spaceId === space.id && d.template && !d.archivedAt)
  const doc = docs.find(d => d.id === docId)

  const newPage = () => {
    const page = newDoc({ spaceId: space.id, projectId: project?.id, title: 'Untitled' })
    dispatch({ type: 'addDoc', doc: page })
    goto(page.id)
  }

  const fromTemplate = (id: string) => {
    const template = templates.find(t => t.id === id)
    if (!template) return
    const page = docFromTemplate(template, { spaceId: space.id, projectId: project?.id })
    dispatch({ type: 'addDoc', doc: page })
    goto(page.id)
  }

  return (
    <div className="docs-view">
      <aside className="docs-list">
        <div className="docs-list-head">
          <button className="btn primary" onClick={newPage}>{ICONS.plus} New doc</button>
          <select aria-label="From template" value="" onChange={e => fromTemplate(e.target.value)}>
            <option value="">From template</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          {!project && (
            <select aria-label="Show docs" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="space">Space docs</option>
              <option value="all">All docs</option>
              {data.projects.filter(p => p.spaceId === space.id).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
        {shown.map(d => (
          <button key={d.id} className={clsx('doc-item', d.id === docId && 'active')} onClick={() => goto(d.id)}>
            {d.title || 'Untitled'}
          </button>
        ))}
        {shown.length === 0 && <p className="muted small">No docs here yet.</p>}
      </aside>

      <section className="docs-main">
        {doc ? <DocEditor key={doc.id} doc={doc} onOpen={onOpen} goto={goto} /> : <p className="muted">Pick a doc, or create one.</p>}
      </section>
    </div>
  )
}

interface DocEditorProps {
  doc: Doc
  onOpen: (issueId: string) => void
  goto: (id: string | null) => void
}

// The editor for one doc. Keyed by doc id, so switching docs remounts it with a fresh draft.
function DocEditor({ doc, onOpen, goto }: DocEditorProps) {
  const { data, dispatch } = useStore()
  const [draft, setDraft] = useState(doc.body)
  const [error, setError] = useState('')
  const docRef = useRef(doc)
  docRef.current = doc
  const pending = useRef<string | null>(null)
  const timer = useRef(0)

  const save = (body: string) => {
    if (body === docRef.current.body) return
    try {
      const next = editBody(docRef.current, body, SESSION)
      dispatch({ type: 'patchDoc', id: doc.id, patch: { body: next.body, rev: next.rev, baseRev: next.baseRev, revBy: next.revBy } })
      setError('')
    } catch {
      setError(`This doc is over ${DOC_MAX_BYTES / 1024} KB. The last edit was not saved.`)
      setDraft(docRef.current.body)
    }
  }

  // Body edits are saved after a short pause. A pending save is flushed when the editor unmounts.
  const onBody = (text: string) => {
    if (docBytes(text) > DOC_MAX_BYTES) {
      setError(`This doc is over ${DOC_MAX_BYTES / 1024} KB. Edits are refused.`)
      return
    }
    setError('')
    setDraft(text)
    pending.current = text
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      pending.current = null
      save(text)
    }, 300)
  }

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (pending.current !== null) save(pending.current)
    },
    []
  )

  const html = useMemo(() => renderMarkdown(draft, data), [draft, data])
  const original = data.docs?.find(d => d.id === doc.conflictOf)

  // Links in the preview: issue mentions open the issue, http(s) links open outside the app. Nothing else is followed.
  const openLink = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const href = (e.target as HTMLElement).closest('a')?.getAttribute('href') ?? ''
    if (href.startsWith('#issue:')) onOpen(href.slice('#issue:'.length))
    else if (/^https?:\/\//i.test(href)) window.api.openExternal(href)
  }

  const duplicate = () => {
    const id = uid()
    dispatch({ type: 'duplicateDoc', id: doc.id, newId: id })
    goto(id)
  }

  const remove = () => {
    dispatch({ type: 'deleteDoc', id: doc.id })
    goto(null)
  }

  return (
    <div className="doc-page">
      <div className="doc-head">
        <input
          aria-label="Doc title"
          className="doc-title"
          value={doc.title}
          onChange={e => dispatch({ type: 'patchDoc', id: doc.id, patch: { title: e.target.value } })}
        />
        <button className="btn ghost" onClick={duplicate}>Duplicate</button>
        <button className="btn ghost" onClick={() => dispatch({ type: 'saveDocAsTemplate', id: doc.id, newId: uid() })}>Save as template</button>
        <button className="btn ghost" onClick={remove}>{ICONS.trash} Delete</button>
      </div>
      {doc.conflictOf && (
        <p className="doc-note">{original ? `Conflicted copy of ${original.title}` : 'Conflicted copy'}</p>
      )}
      {docBytes(draft) >= DOC_WARN_BYTES && (
        <p className="doc-note">This doc is over {DOC_WARN_BYTES / 1024} KB. Large text belongs in files.</p>
      )}
      {error && <p className="doc-error" role="alert">{error}</p>}
      <div className="doc-split">
        <textarea aria-label="Doc body" value={draft} onChange={e => onBody(e.target.value)} />
        <div className="doc-preview" data-testid="doc-preview" onClick={openLink} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
