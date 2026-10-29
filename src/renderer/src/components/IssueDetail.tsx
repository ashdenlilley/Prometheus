import { useEffect, useRef, useState } from 'react'
import type { ActivityEntry, Comment, Issue, Relation, RelationType } from '@shared/types'
import { childrenOf, progress } from '@shared/query'
import { DRAWER_SHORTCUTS, drawerShortcut } from '@shared/shortcuts'
import { createIssue, issueKey, useStore, withValue } from '../store'
import { inverseRelations } from '@shared/model'
import { nextOccurrence } from '@shared/recurrence'
import type { Recurrence } from '@shared/types'
import { CellEditor } from './cells'
import { EstimateSelect, PrioritySelect, StatusDot, StatusSelect } from './fields'
import { ICONS } from './icons'
import { askText, useEscape } from './ui'
import { clsx, fmtDate, parseISO, todayISO, uid } from '../util'

const REL_LABEL: Record<RelationType | 'blocked_by' | 'duplicated_by', string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  duplicate: 'Duplicate of',
  duplicated_by: 'Duplicated by',
  related: 'Related'
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const toNum = (v: string) => (v === '' ? undefined : Number(v))

// Issue drawer: every field, sub-issues, relations, comments and activity.
export function IssueDetail({ issueId, onClose, onOpen }: { issueId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const issue = data.issues.find(i => i.id === issueId)
  const project = data.projects.find(p => p.id === issue?.projectId)
  const [comment, setComment] = useState('')
  const [subTitle, setSubTitle] = useState('')
  const [relType, setRelType] = useState<RelationType>('blocks')
  const [relTarget, setRelTarget] = useState('')
  const labelsRef = useRef<HTMLInputElement>(null)
  const assigneeRef = useRef<HTMLInputElement>(null)
  useEscape(onClose)

  // Single-key shortcuts while not typing (see DRAWER_SHORTCUTS): s status, p priority, f favourite, l labels, a assignee.
  useEffect(() => {
    if (!issue || !project) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const key = drawerShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, typing: !!t.closest('input, textarea, select, [contenteditable]') })
      if (!key) return
      const statuses = project.statuses
      if (key === 's') {
        const at = statuses.findIndex(s => s.id === issue.status)
        dispatch({ type: 'patchIssue', id: issue.id, patch: { status: statuses[(at + 1) % statuses.length].id } })
      }
      if (key === 'p') dispatch({ type: 'patchIssue', id: issue.id, patch: { priority: (issue.priority + 1) % 5 } })
      if (key === 'f') dispatch({ type: 'patchIssue', id: issue.id, patch: { favourite: !issue.favourite } })
      // preventDefault stops the letter being typed into the field we just focused.
      if (key === 'l' || key === 'a') {
        e.preventDefault()
        const input = key === 'l' ? labelsRef.current : assigneeRef.current
        input?.focus()
        input?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [issue, project, dispatch])

  if (!issue || !project) return null

  const patch = (p: Partial<Issue>) => dispatch({ type: 'patchIssue', id: issue.id, patch: p })
  const rec = issue.recurrence
  const today = todayISO()
  // Any rule change re-derives `next` from today, so a match today counts only on the next run.
  const setRepeat = (r?: Recurrence) => patch({ recurrence: r && { ...r, next: nextOccurrence(r, today) } })
  const editRepeat = (p: Partial<Recurrence>) => rec && setRepeat({ ...rec, ...p })
  const pickKind = (kind: Recurrence['kind'] | 'none') => {
    if (kind === 'none') return setRepeat()
    const day = parseISO(today)
    setRepeat({ kind, next: today, weekdays: [day.getDay()], monthDay: day.getDate(), every: 2, dueInDays: rec?.dueInDays })
  }
  const toggleDay = (d: number) => {
    const days = rec?.weekdays ?? []
    editRepeat({ weekdays: days.includes(d) ? days.filter(x => x !== d) : [...days, d] })
  }
  const cycles = data.cycles.filter(c => c.projectId === project.id)
  const milestones = project.milestones
  const children = childrenOf(data.issues, issue.id)
  const childPct = progress(children, project.statuses)
  const parent = data.issues.find(i => i.id === issue.parentId)
  const inverse = inverseRelations(data, issue.id)
  const pool = data.issues.filter(i => i.id !== issue.id)
  const key = (i: Issue) => issueKey(data, i)

  const remove = () => {
    if (!window.confirm(`Delete ${key(issue)}?`)) return
    dispatch({ type: 'deleteIssue', id: issue.id })
    onClose()
  }

  const accept = () => patch({ triage: false })
  const decline = () => {
    if (!window.confirm(`Decline ${key(issue)} and delete it?`)) return
    dispatch({ type: 'deleteIssue', id: issue.id })
    onClose()
  }

  const saveTemplate = async () => {
    const name = await askText('Template name', issue.title)
    if (!name) return
    dispatch({
      type: 'addTemplate',
      template: {
        id: uid(),
        projectId: project.id,
        name,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        labels: issue.labels,
        estimate: issue.estimate
      }
    })
  }

  const addComment = () => {
    const body = comment.trim()
    if (!body) return
    dispatch({
      type: 'addComment',
      issueId: issue.id,
      comment: { id: uid(), author: data.me, body, at: new Date().toISOString() }
    })
    setComment('')
  }

  const addSub = () => {
    const title = subTitle.trim()
    if (!title) return
    dispatch({
      type: 'addIssue',
      issue: createIssue(data, project.id, title, { parentId: issue.id })
    })
    setSubTitle('')
  }

  const addRelation = () => {
    if (!relTarget) return
    const relation: Relation = { type: relType, targetId: relTarget }
    dispatch({ type: 'addRelation', issueId: issue.id, relation })
    setRelTarget('')
  }

  const timeline: { at: string; kind: 'activity' | 'comment'; item: ActivityEntry | Comment }[] = [
    ...issue.activity.map(a => ({ at: a.at, kind: 'activity' as const, item: a })),
    ...issue.comments.map(c => ({ at: c.at, kind: 'comment' as const, item: c }))
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div className="overlay drawer-overlay" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={e => e.stopPropagation()}>
        <div className="panel-head">
          <span className="muted key">{key(issue)}</span>
          <div className="row-gap">
            <button
              className={clsx('icon-btn', issue.favourite && 'on')}
              title={issue.favourite ? 'Remove from favourites (f)' : 'Add to favourites (f)'}
              onClick={() => patch({ favourite: !issue.favourite })}
              aria-pressed={!!issue.favourite}
            >
              {issue.favourite ? '★' : '☆'}
            </button>
            <button className="btn ghost" onClick={saveTemplate}>Save as template</button>
            <button className="btn danger" onClick={remove}>{ICONS.trash} Delete</button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">{ICONS.close}</button>
          </div>
        </div>
        <div className="muted small drawer-keys">
          {DRAWER_SHORTCUTS.map((s, i) => (
            <span key={s.key}>
              {i > 0 && ' · '}
              <kbd>{s.key}</kbd> {s.label}
            </span>
          ))}
        </div>

        {parent && (
          <button className="crumb-link" onClick={() => onOpen(parent.id)}>↑ {key(parent)} {parent.title}</button>
        )}

        {issue.triage && (
          <div className="triage-banner">
            <span>In triage.</span>
            <button className="btn primary" onClick={accept}>Accept</button>
            <button className="btn danger" onClick={decline}>Decline</button>
          </div>
        )}

        {issue.archivedAt && (
          <div className="triage-banner">
            <span>Archived {fmtDate(issue.archivedAt.slice(0, 10))}</span>
            <button className="btn primary" onClick={() => patch({ archivedAt: undefined })}>Unarchive</button>
          </div>
        )}

        <input className="title-input" value={issue.title} onChange={e => patch({ title: e.target.value })} />
        <textarea
          className="field-input area desc"
          placeholder="Add description"
          value={issue.description}
          onChange={e => patch({ description: e.target.value })}
        />

        <div className="fields">
          <label>
            Status
            <StatusSelect value={issue.status} statuses={project.statuses} onChange={status => patch({ status })} />
          </label>
          <label>
            Priority
            <PrioritySelect value={issue.priority} onChange={priority => patch({ priority })} />
          </label>
          <label>
            Assignee
            <input ref={assigneeRef} aria-label="Assignee" className="field-input" list={`people-${project.id}`} value={issue.assignee} onChange={e => patch({ assignee: e.target.value })} />
            <datalist id={`people-${project.id}`}>
              {project.members.map(m => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label>
            Labels
            <input
              ref={labelsRef}
              aria-label="Labels"
              className="field-input"
              defaultValue={issue.labels.join(', ')}
              placeholder="bug, ui"
              onBlur={e => patch({ labels: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            />
          </label>
          <label>
            Estimate
            {project.estimateScale === 'tshirt' ? (
              <EstimateSelect className="field-input" value={issue.estimate} onChange={estimate => patch({ estimate })} />
            ) : (
              <input
                className="field-input"
                type="number"
                min={0}
                value={issue.estimate ?? ''}
                onChange={e => patch({ estimate: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            )}
          </label>
          <label>
            Cycle
            <select className="field-input" value={issue.cycleId ?? ''} onChange={e => patch({ cycleId: e.target.value || undefined })}>
              <option value="">None</option>
              {cycles.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Milestone
            <select className="field-input" value={issue.milestoneId ?? ''} onChange={e => patch({ milestoneId: e.target.value || undefined })}>
              <option value="">None</option>
              {milestones.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label>
            Parent
            <select className="field-input" value={issue.parentId ?? ''} onChange={e => patch({ parentId: e.target.value || undefined })}>
              <option value="">None</option>
              {data.issues.filter(i => i.projectId === project.id && i.id !== issue.id).map(i => (
                <option key={i.id} value={i.id}>{key(i)} {i.title}</option>
              ))}
            </select>
          </label>
          <label>
            Start
            <input className="field-input" type="date" value={issue.startDate ?? ''} onChange={e => patch({ startDate: e.target.value || undefined })} />
          </label>
          <label>
            Due
            <input className="field-input" type="date" value={issue.dueDate ?? ''} onChange={e => patch({ dueDate: e.target.value || undefined })} />
          </label>
          <label className="wide">
            Repeat
            <div className="repeat-row">
              <select
                aria-label="Repeat"
                className="field-input"
                value={rec?.kind ?? 'none'}
                onChange={e => pickKind(e.target.value as Recurrence['kind'] | 'none')}
              >
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="interval">Every N days</option>
              </select>
              {rec?.kind === 'weekly' &&
                WEEKDAYS.map((d, n) => (
                  <button
                    key={d}
                    type="button"
                    aria-label={`Repeat on ${d}`}
                    aria-pressed={!!rec.weekdays?.includes(n)}
                    className={clsx('repeat-day', rec.weekdays?.includes(n) && 'on')}
                    onClick={() => toggleDay(n)}
                  >
                    {d}
                  </button>
                ))}
              {rec?.kind === 'monthly' && (
                <input
                  aria-label="Day of month"
                  className="field-input"
                  type="number"
                  min={1}
                  max={31}
                  value={rec.monthDay ?? ''}
                  onChange={e => editRepeat({ monthDay: toNum(e.target.value) })}
                />
              )}
              {rec?.kind === 'interval' && (
                <input
                  aria-label="Every N days"
                  className="field-input"
                  type="number"
                  min={1}
                  value={rec.every ?? ''}
                  onChange={e => editRepeat({ every: toNum(e.target.value) })}
                />
              )}
              {rec && <span className="muted small">Due after (days)</span>}
              {rec && (
                <input
                  aria-label="Due after days"
                  className="field-input"
                  type="number"
                  min={0}
                  placeholder="Due after (days)"
                  value={rec.dueInDays ?? ''}
                  onChange={e => editRepeat({ dueInDays: toNum(e.target.value) })}
                />
              )}
            </div>
            {rec && <span className="muted small">Next: {fmtDate(rec.next)}</span>}
          </label>
          {project.columns.map(col => (
            <label key={col.id} className={col.type === 'long_text' ? 'wide' : undefined}>
              {col.name}
              <CellEditor
                column={col}
                project={project}
                issue={issue}
                value={issue.values[col.id]}
                onChange={v => patch({ values: withValue(issue.values, col.id, v) })}
              />
            </label>
          ))}
        </div>

        <section className="drawer-section">
          <div className="section-title-row small">
            <h3>Sub-issues</h3>
            {children.length > 0 && <span className="muted small">{childPct.done}/{childPct.total} done</span>}
          </div>
          {children.length > 0 && <div className="bar"><div className="bar-fill" style={{ width: `${childPct.pct}%` }} /></div>}
          {children.map(c => {
            const s = project.statuses.find(x => x.id === c.status)
            return (
              <button key={c.id} className="link-row" onClick={() => onOpen(c.id)}>
                {s && <StatusDot status={s} />}
                <span className="muted key">{key(c)}</span>
                <span className="grow ellipsis">{c.title}</span>
              </button>
            )
          })}
          <input className="quick-add" placeholder="+ Add sub-issue" value={subTitle} onChange={e => setSubTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSub()} />
        </section>

        <section className="drawer-section">
          <div className="section-title-row small">
            <h3>Relations</h3>
          </div>
          {issue.relations.map((r, n) => {
            const target = data.issues.find(i => i.id === r.targetId)
            return (
              <div key={`${r.type}-${r.targetId}-${n}`} className="link-row">
                <span className="muted small">{REL_LABEL[r.type]}</span>
                <button className="link-btn grow ellipsis" onClick={() => target && onOpen(target.id)}>
                  {target ? `${key(target)} ${target.title}` : 'Deleted issue'}
                </button>
                <button className="icon-btn" aria-label="Remove relation" onClick={() => dispatch({ type: 'removeRelation', issueId: issue.id, index: n })}>{ICONS.close}</button>
              </div>
            )
          })}
          {inverse.map((r, n) => (
            <div key={`inv-${r.type}-${n}`} className="link-row">
              <span className="muted small">{REL_LABEL[r.type]}</span>
              <button className="link-btn grow ellipsis" onClick={() => onOpen(r.issue.id)}>{key(r.issue)} {r.issue.title}</button>
            </div>
          ))}
          <div className="relation-add">
            <select className="field-input" value={relType} onChange={e => setRelType(e.target.value as RelationType)}>
              <option value="blocks">Blocks</option>
              <option value="duplicate">Duplicate of</option>
              <option value="related">Related</option>
            </select>
            <select className="field-input grow" value={relTarget} onChange={e => setRelTarget(e.target.value)}>
              <option value="">Choose issue</option>
              {pool.map(i => (
                <option key={i.id} value={i.id}>{key(i)} {i.title}</option>
              ))}
            </select>
            <button className="btn" onClick={addRelation} disabled={!relTarget}>Add</button>
          </div>
        </section>

        <section className="drawer-section">
          <div className="section-title-row small">
            <h3>Activity</h3>
          </div>
          {timeline.map((t, n) =>
            t.kind === 'activity' ? (
              <div key={`a-${n}`} className="activity-row muted small">
                {(t.item as ActivityEntry).text} · {fmtDate(t.at.slice(0, 10))}
              </div>
            ) : (
              <div key={(t.item as Comment).id} className="comment">
                <div className="comment-head small">
                  <b>{(t.item as Comment).author}</b>
                  <span className="muted">{new Date(t.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <button className="icon-btn" aria-label="Delete comment" onClick={() => dispatch({ type: 'deleteComment', issueId: issue.id, commentId: (t.item as Comment).id })}>{ICONS.close}</button>
                </div>
                <div className="comment-body">{(t.item as Comment).body}</div>
              </div>
            )
          )}
          <textarea
            className="field-input area"
            rows={2}
            placeholder="Write a comment. Use @You to notify."
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment()
            }}
          />
          <div className="actions">
            <button className="btn primary" onClick={addComment} disabled={!comment.trim()}>Comment</button>
          </div>
        </section>
      </aside>
    </div>
  )
}
