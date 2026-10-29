import { useState } from 'react'
import type { Automation, AutomationAction, AutomationTrigger, Project, ProjectStatus, StatusCategory, StatusDef } from '@shared/types'
import { issueKey, useStore } from '../store'
import { fieldOptions } from './FilterBar'
import type { Initiative, Operator, TriageRule } from '@shared/types'
import { RECIPES, recipeAutomation, type Blank, type Recipe } from '@shared/recipes'
import { ICONS } from './icons'
import { askText, Modal } from './ui'
import { LABEL_COLORS } from '../columns'
import { uid, clsx, todayISO, fmtDate } from '../util'

type Tab = 'general' | 'statuses' | 'milestones' | 'updates' | 'automations' | 'triage' | 'templates' | 'archive'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'statuses', label: 'Statuses' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'updates', label: 'Updates' },
  { id: 'automations', label: 'Automations' },
  { id: 'triage', label: 'Triage rules' },
  { id: 'templates', label: 'Templates' },
  { id: 'archive', label: 'Archive' }
]

const PROJECT_STATUS: { value: ProjectStatus; label: string }[] = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' }
]

const CATEGORIES: StatusCategory[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled']

// Project configuration in one place: general, statuses, milestones, updates, automations, templates.
export function ProjectSettings({ project, onClose }: { project: Project; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general')
  return (
    <Modal title={`${project.name} settings`} onClose={onClose}>
      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={clsx('tab', tab === t.id && 'on')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'general' && <General project={project} />}
      {tab === 'statuses' && <Statuses project={project} />}
      {tab === 'milestones' && <Milestones project={project} />}
      {tab === 'updates' && <Updates project={project} />}
      {tab === 'automations' && <Automations project={project} />}
      {tab === 'triage' && <TriageRules project={project} />}
      {tab === 'templates' && <Templates project={project} />}
      {tab === 'archive' && <Archive project={project} />}
    </Modal>
  )
}

function General({ project }: { project: Project }) {
  const { data, dispatch } = useStore()
  const [members, setMembers] = useState(project.members.join(', '))
  const patch = (p: Partial<Project>) => dispatch({ type: 'patchProject', id: project.id, patch: p })
  const initiatives = data.initiatives.filter(i => i.spaceId === project.spaceId)
  const canceled = project.statuses.filter(s => s.category === 'canceled')
  return (
    <div className="settings-form">
      <label className="check-field">
        <input
          type="checkbox"
          aria-label="Auto-subscribe to new issues"
          checked={project.autoSubscribe !== false}
          onChange={e => patch({ autoSubscribe: e.target.checked })}
        />
        Auto-subscribe me to new issues
      </label>
      <label className="field">
        Status
        <select className="field-input" value={project.status} onChange={e => patch({ status: e.target.value as ProjectStatus })}>
          {PROJECT_STATUS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Lead
        <input className="field-input" value={project.lead} onChange={e => patch({ lead: e.target.value })} />
      </label>
      <label className="field">
        Estimate scale
        <select className="field-input" aria-label="Estimate scale" value={project.estimateScale ?? 'points'} onChange={e => patch({ estimateScale: e.target.value as Project['estimateScale'] })}>
          <option value="points">Points</option>
          <option value="tshirt">T-shirt (XS–XL)</option>
        </select>
      </label>
      <label className="field">
        Members (comma separated, used for People columns and assignee suggestions)
        <input
          className="field-input"
          value={members}
          onChange={e => setMembers(e.target.value)}
          onBlur={() => patch({ members: members.split(',').map(s => s.trim()).filter(Boolean) })}
        />
      </label>
      <label className="field">
        Initiative
        <select className="field-input" value={project.initiativeId ?? ''} onChange={e => patch({ initiativeId: e.target.value || undefined })}>
          <option value="">None</option>
          {initiatives.map(i => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          Start
          <input className="field-input" type="date" value={project.startDate ?? ''} onChange={e => patch({ startDate: e.target.value || undefined })} />
        </label>
        <label className="field">
          Target
          <input className="field-input" type="date" value={project.targetDate ?? ''} onChange={e => patch({ targetDate: e.target.value || undefined })} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          Auto-close after (days)
          <input
            className="field-input num"
            type="number"
            min={1}
            aria-label="Auto-close days"
            placeholder="Off"
            value={project.autoClose?.days ?? ''}
            onChange={e =>
              patch({ autoClose: e.target.value === '' ? undefined : { days: Number(e.target.value), status: project.autoClose?.status ?? canceled[0]?.id ?? '' } })
            }
          />
        </label>
        <label className="field">
          Close as
          <select
            className="field-input"
            aria-label="Auto-close status"
            disabled={!project.autoClose}
            value={project.autoClose?.status ?? ''}
            onChange={e => project.autoClose && patch({ autoClose: { ...project.autoClose, status: e.target.value } })}
          >
            {canceled.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Auto-archive after (days)
        <input
          className="field-input num"
          type="number"
          min={1}
          aria-label="Auto-archive days"
          placeholder="Off"
          value={project.autoArchive?.days ?? ''}
          onChange={e => patch({ autoArchive: e.target.value === '' ? undefined : { days: Number(e.target.value) } })}
        />
      </label>
      <div className="section-title-row small">
        <h3>Initiatives</h3>
        <button
          className="btn subtle"
          onClick={async () => {
            const name = await askText('Initiative name')
            if (!name) return
            dispatch({
              type: 'addInitiative',
              initiative: { id: uid(), spaceId: project.spaceId, name, color: LABEL_COLORS[initiatives.length % LABEL_COLORS.length], status: 'active' }
            })
          }}
        >
          {ICONS.plus} New initiative
        </button>
      </div>
      <div className="muted small">{initiatives.map(i => i.name).join(', ') || 'No initiatives in this space yet.'}</div>
    </div>
  )
}

function Archive({ project }: { project: Project }) {
  const { data, dispatch } = useStore()
  const archived = data.issues.filter(i => i.projectId === project.id && i.archivedAt).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
  return (
    <div className="settings-form">
      {archived.map(i => (
        <div key={i.id} className="option-row">
          <span className="grow small">
            {issueKey(data, i)} {i.title} <span className="muted">· {fmtDate(i.archivedAt!.slice(0, 10))}</span>
          </span>
          <button className="btn subtle" aria-label={`Unarchive ${issueKey(data, i)}`} onClick={() => dispatch({ type: 'patchIssue', id: i.id, patch: { archivedAt: undefined } })}>
            Unarchive
          </button>
        </div>
      ))}
      {archived.length === 0 && <div className="muted small">No archived issues</div>}
    </div>
  )
}

function Statuses({ project }: { project: Project }) {
  const { data, dispatch } = useStore()
  const save = (statuses: StatusDef[]) => dispatch({ type: 'patchProject', id: project.id, patch: { statuses } })
  const update = (id: string, patch: Partial<StatusDef>) => save(project.statuses.map(s => (s.id === id ? { ...s, ...patch } : s)))
  const remove = (id: string) => {
    if (data.issues.some(i => i.projectId === project.id && i.status === id)) {
      return window.alert('Move the issues out of this status before removing it.')
    }
    save(project.statuses.filter(s => s.id !== id))
  }
  return (
    <div className="settings-form">
      <p className="muted small">Categories drive progress: Completed counts as done, Canceled is excluded, the rest are open.</p>
      {project.statuses.map(s => (
        <div key={s.id} className="option-row">
          <input className="color-swatch" type="color" value={s.color} onChange={e => update(s.id, { color: e.target.value })} aria-label="Status colour" />
          <input className="field-input" value={s.label} onChange={e => update(s.id, { label: e.target.value })} />
          <select className="field-input" value={s.category} onChange={e => update(s.id, { category: e.target.value as StatusCategory })}>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            className="field-input num"
            type="number"
            min={0}
            placeholder="WIP limit"
            title="Work-in-progress limit for the board column"
            value={project.wipLimits[s.id] ?? ''}
            onChange={e => {
              const next = { ...project.wipLimits }
              if (e.target.value === '') delete next[s.id]
              else next[s.id] = Number(e.target.value)
              dispatch({ type: 'patchProject', id: project.id, patch: { wipLimits: next } })
            }}
          />
          <button className="icon-btn" aria-label="Remove status" onClick={() => remove(s.id)} disabled={project.statuses.length <= 1}>{ICONS.close}</button>
        </div>
      ))}
      <button
        className="btn subtle"
        onClick={async () => {
          const label = await askText('Status name')
          if (!label) return
          save([...project.statuses, { id: uid(), label, color: LABEL_COLORS[project.statuses.length % LABEL_COLORS.length], category: 'unstarted' }])
        }}
      >
        {ICONS.plus} Add status
      </button>
    </div>
  )
}

function Milestones({ project }: { project: Project }) {
  const { dispatch } = useStore()
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const save = (milestones: Project['milestones']) => dispatch({ type: 'patchProject', id: project.id, patch: { milestones } })
  return (
    <div className="settings-form">
      {project.milestones.map(m => (
        <div key={m.id} className="option-row">
          <input type="checkbox" checked={m.done} onChange={e => save(project.milestones.map(x => (x.id === m.id ? { ...x, done: e.target.checked } : x)))} aria-label="Done" />
          <input className="field-input" value={m.name} onChange={e => save(project.milestones.map(x => (x.id === m.id ? { ...x, name: e.target.value } : x)))} />
          <input className="field-input" type="date" value={m.date ?? ''} onChange={e => save(project.milestones.map(x => (x.id === m.id ? { ...x, date: e.target.value || undefined } : x)))} />
          <button className="icon-btn" aria-label="Remove milestone" onClick={() => save(project.milestones.filter(x => x.id !== m.id))}>{ICONS.close}</button>
        </div>
      ))}
      <div className="option-row">
        <input className="field-input" placeholder="Milestone name" value={name} onChange={e => setName(e.target.value)} />
        <input className="field-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <button
          className="btn subtle"
          disabled={!name.trim()}
          onClick={() => {
            save([...project.milestones, { id: uid(), name: name.trim(), date: date || undefined, done: false }])
            setName('')
            setDate('')
          }}
        >
          {ICONS.plus} Add
        </button>
      </div>
    </div>
  )
}

function Updates({ project }: { project: Project }) {
  const { dispatch } = useStore()
  const [body, setBody] = useState('')
  const [health, setHealth] = useState<'on_track' | 'at_risk' | 'off_track'>('on_track')
  const post = () => {
    if (!body.trim()) return
    dispatch({
      type: 'patchProject',
      id: project.id,
      patch: { updates: [{ id: uid(), at: todayISO(), health, body: body.trim() }, ...project.updates] }
    })
    setBody('')
  }
  const labels = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' }
  return (
    <div className="settings-form">
      <div className="option-row">
        <select className="field-input" value={health} onChange={e => setHealth(e.target.value as typeof health)}>
          {Object.entries(labels).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input className="field-input grow" placeholder="Post a project update" value={body} onChange={e => setBody(e.target.value)} />
        <button className="btn primary" onClick={post} disabled={!body.trim()}>Post</button>
      </div>
      {project.updates.map(u => (
        <div key={u.id} className="update">
          <div className="small">
            <span className={clsx('health', u.health)}>{labels[u.health]}</span> <span className="muted">{u.at}</span>
          </div>
          <div>{u.body}</div>
        </div>
      ))}
    </div>
  )
}

const TRIGGERS: { value: AutomationTrigger['type']; label: string }[] = [
  { value: 'status_changed', label: 'Status changes to' },
  { value: 'priority_changed', label: 'Priority changes to' },
  { value: 'assignee_changed', label: 'Assignee changes' },
  { value: 'due_passed', label: 'Due date is set in the past' },
  { value: 'column_changed', label: 'Column changes' },
  { value: 'project_status_changed', label: 'Project status changes to' },
  { value: 'cycle_started', label: 'Cycle starts' },
  { value: 'cycle_ended', label: 'Cycle ends' },
  { value: 'initiative_status_changed', label: 'Initiative status changes to' }
]

// Object triggers act on a set of issues, so they only offer the actions that make sense for that
const OBJECT_TRIGGERS: AutomationTrigger['type'][] = ['project_status_changed', 'cycle_started', 'cycle_ended', 'initiative_status_changed']
const OBJECT_ACTIONS: AutomationAction['type'][] = ['notify', 'set_status', 'set_priority', 'set_assignee', 'add_label']
const INITIATIVE_STATUSES: Initiative['status'][] = ['planned', 'active', 'done']

const ACTIONS: { value: AutomationAction['type']; label: string }[] = [
  { value: 'set_status', label: 'Set status to' },
  { value: 'set_priority', label: 'Set priority to' },
  { value: 'set_assignee', label: 'Set assignee to' },
  { value: 'add_label', label: 'Add label' },
  { value: 'move_to_cycle', label: 'Move to the current cycle' },
  { value: 'create_issue', label: 'Create follow-up sub-issue' },
  { value: 'notify', label: 'Notify me' }
]

function Automations({ project }: { project: Project }) {
  const { data, dispatch } = useStore()
  const rules = data.automations.filter(a => a.projectId === project.id)
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<AutomationTrigger['type']>('status_changed')
  const [triggerValue, setTriggerValue] = useState(project.statuses[project.statuses.length - 1]?.id ?? '')
  const [action, setAction] = useState<AutomationAction['type']>('set_status')
  const [actionValue, setActionValue] = useState('')
  const [actionProject, setActionProject] = useState('')
  const [triggerColumn, setTriggerColumn] = useState(project.columns[0]?.id ?? '')
  const [triggerColumnValue, setTriggerColumnValue] = useState('')
  const [triggerProjectStatus, setTriggerProjectStatus] = useState<ProjectStatus | ''>('')
  const [triggerInitiative, setTriggerInitiative] = useState<Initiative['status'] | ''>('')
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [answers, setAnswers] = useState<Partial<Record<Blank, string>>>({})

  const buildTrigger = (): AutomationTrigger => {
    switch (trigger) {
      case 'status_changed':
        return { type: 'status_changed', to: triggerValue }
      case 'priority_changed':
        return { type: 'priority_changed', to: Number(triggerValue) }
      case 'assignee_changed':
        return { type: 'assignee_changed' }
      case 'due_passed':
        return { type: 'due_passed' }
      case 'column_changed':
        return { type: 'column_changed', columnId: triggerColumn, to: triggerColumnValue.trim() || undefined }
      case 'project_status_changed':
        return { type: 'project_status_changed', to: triggerProjectStatus || undefined }
      case 'cycle_started':
        return { type: 'cycle_started' }
      case 'cycle_ended':
        return { type: 'cycle_ended' }
      case 'initiative_status_changed':
        return { type: 'initiative_status_changed', to: triggerInitiative || undefined }
    }
  }

  const buildAction = (): AutomationAction => {
    switch (action) {
      case 'set_status':
        return { type: 'set_status', status: actionValue }
      case 'set_priority':
        return { type: 'set_priority', priority: Number(actionValue) }
      case 'set_assignee':
        return { type: 'set_assignee', assignee: actionValue }
      case 'add_label':
        return { type: 'add_label', label: actionValue }
      case 'move_to_cycle':
        return { type: 'move_to_cycle' }
      case 'create_issue':
        return { type: 'create_issue', title: actionValue || 'Follow up', projectId: actionProject || undefined }
      case 'notify':
        return { type: 'notify', message: actionValue || 'Automation ran' }
    }
  }

  const create = () => {
    if (!name.trim()) return
    const automation: Automation = { id: uid(), projectId: project.id, name: name.trim(), enabled: true, createdAt: new Date().toISOString(), trigger: buildTrigger(), action: buildAction() }
    dispatch({ type: 'addAutomation', automation })
    setName('')
  }

  const addRecipe = () => {
    if (!recipe) return
    dispatch({ type: 'addAutomation', automation: recipeAutomation(recipe, project, answers, uid()) })
    setRecipe(null)
    setAnswers({})
  }


  return (
    <div className="settings-form">
      {rules.map(r => (
        <div key={r.id} className="option-row">
          <label className="check-field">
            <input type="checkbox" checked={r.enabled} onChange={e => dispatch({ type: 'patchAutomation', id: r.id, patch: { enabled: e.target.checked } })} />
          </label>
          <span className="grow small">{r.name}</span>
          <button className="icon-btn" aria-label="Delete automation" onClick={() => dispatch({ type: 'deleteAutomation', id: r.id })}>{ICONS.trash}</button>
        </div>
      ))}
      {rules.length === 0 && <div className="muted small">No automations. Rules run on every change in this project.</div>}

      <div className="field">
        <div className="muted small">Recipes</div>
        {RECIPES.map(r => (
          <div key={r.id} className="option-row">
            <span className="grow small">{r.sentence}</span>
            <button className="btn" aria-label={`Use recipe: ${r.sentence}`} onClick={() => { setRecipe(r); setAnswers({}) }}>Use</button>
          </div>
        ))}
        {recipe && (
          <div className="field-row">
            {recipe.blanks.includes('status') && (
              <select aria-label="Recipe status" className="field-input" value={answers.status ?? ''} onChange={e => setAnswers({ ...answers, status: e.target.value })}>
                <option value="">Done (default)</option>
                {project.statuses.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
            {recipe.blanks.includes('priority') && (
              <select aria-label="Recipe priority" className="field-input" value={answers.priority ?? ''} onChange={e => setAnswers({ ...answers, priority: e.target.value })}>
                <option value="">Urgent (default)</option>
                {['1', '2', '3', '4'].map((p, n) => (
                  <option key={p} value={p}>{['Urgent', 'High', 'Medium', 'Low'][n]}</option>
                ))}
              </select>
            )}
            {recipe.blanks.includes('label') && (
              <input aria-label="Recipe label" className="field-input" placeholder="Label" value={answers.label ?? ''} onChange={e => setAnswers({ ...answers, label: e.target.value })} />
            )}
            {recipe.blanks.includes('message') && (
              <input aria-label="Recipe message" className="field-input" placeholder="Message" value={answers.message ?? ''} onChange={e => setAnswers({ ...answers, message: e.target.value })} />
            )}
            {recipe.blanks.includes('project') && (
              <select aria-label="Recipe project" className="field-input" value={answers.project ?? ''} onChange={e => setAnswers({ ...answers, project: e.target.value })}>
                <option value="">This project</option>
                {data.projects.filter(p => p.spaceId === project.spaceId && p.id !== project.id).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button className="btn primary" aria-label="Add recipe automation" onClick={addRecipe}>Add</button>
          </div>
        )}
        <input className="field-input" placeholder="Rule name" value={name} onChange={e => setName(e.target.value)} />
        <div className="field-row">
          <select
            className="field-input"
            value={trigger}
            onChange={e => {
              const next = e.target.value as AutomationTrigger['type']
              setTrigger(next)
              if (OBJECT_TRIGGERS.includes(next) && !OBJECT_ACTIONS.includes(action)) setAction('notify')
            }}
          >
            {TRIGGERS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {trigger === 'status_changed' && (
            <select className="field-input" value={triggerValue} onChange={e => setTriggerValue(e.target.value)}>
              {project.statuses.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}
          {trigger === 'priority_changed' && (
            <select className="field-input" value={triggerValue} onChange={e => setTriggerValue(e.target.value)}>
              {['1', '2', '3', '4'].map((p, n) => (
                <option key={p} value={p}>{['Urgent', 'High', 'Medium', 'Low'][n]}</option>
              ))}
            </select>
          )}
          {trigger === 'column_changed' && (
            <>
              <select aria-label="Trigger column" className="field-input" value={triggerColumn} onChange={e => setTriggerColumn(e.target.value)}>
                {project.columns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input aria-label="Trigger column value" className="field-input" placeholder="Any value" value={triggerColumnValue} onChange={e => setTriggerColumnValue(e.target.value)} />
            </>
          )}
          {trigger === 'project_status_changed' && (
            <select aria-label="Trigger project status" className="field-input" value={triggerProjectStatus} onChange={e => setTriggerProjectStatus(e.target.value as ProjectStatus | '')}>
              <option value="">Any</option>
              {PROJECT_STATUS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          )}
          {trigger === 'initiative_status_changed' && (
            <select aria-label="Trigger initiative status" className="field-input" value={triggerInitiative} onChange={e => setTriggerInitiative(e.target.value as Initiative['status'] | '')}>
              <option value="">Any</option>
              {INITIATIVE_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
        <div className="field-row">
          <select className="field-input" value={action} onChange={e => setAction(e.target.value as AutomationAction['type'])}>
            {(OBJECT_TRIGGERS.includes(trigger) ? ACTIONS.filter(a => OBJECT_ACTIONS.includes(a.value)) : ACTIONS).map(a => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          {action === 'create_issue' && (
            <select aria-label="Target project" className="field-input" value={actionProject} onChange={e => setActionProject(e.target.value)}>
              <option value="">This project</option>
              {data.projects.filter(p => p.spaceId === project.spaceId && p.id !== project.id).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {action === 'set_status' && (
            <select className="field-input" value={actionValue} onChange={e => setActionValue(e.target.value)}>
              <option value="">Choose status</option>
              {project.statuses.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}
          {action === 'set_priority' && (
            <select className="field-input" value={actionValue} onChange={e => setActionValue(e.target.value)}>
              <option value="">Choose priority</option>
              {['1', '2', '3', '4', '0'].map((p, n) => (
                <option key={p} value={p}>{['Urgent', 'High', 'Medium', 'Low', 'None'][n]}</option>
              ))}
            </select>
          )}
          {(action === 'set_assignee' || action === 'add_label' || action === 'notify' || action === 'create_issue') && (
            <input
              className="field-input"
              placeholder={{ notify: 'Message', add_label: 'Label', set_assignee: 'Person', create_issue: 'Sub-issue title' }[action]}
              value={actionValue}
              onChange={e => setActionValue(e.target.value)}
            />
          )}
        </div>
        <button className="btn primary" onClick={create} disabled={!name.trim()}>Add automation</button>
      </div>
    </div>
  )
}

const CONDITION_OPS: { value: Operator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'empty', label: 'is empty' },
  { value: 'not_empty', label: 'is not empty' }
]

// Triage rules: when a new triage item matches, set fields on it. The item stays in triage.
function TriageRules({ project }: { project: Project }) {
  const { data, dispatch } = useStore()
  const rules = data.triageRules.filter(r => r.projectId === project.id)
  const [name, setName] = useState('')
  const [field, setField] = useState('name')
  const [op, setOp] = useState<Operator>('contains')
  const [value, setValue] = useState('')
  const [setAssignee, setSetAssignee] = useState('')
  const [setStatus, setSetStatus] = useState('')
  const [setPriority, setSetPriority] = useState('')
  const [setLabel, setSetLabel] = useState('')
  const fields = fieldOptions(project)

  const create = () => {
    if (!name.trim()) return
    const set: TriageRule['set'] = {}
    if (setAssignee.trim()) set.assignee = setAssignee.trim()
    if (setStatus) set.status = setStatus
    if (setPriority) set.priority = Number(setPriority)
    if (setLabel.trim()) set.labels = [setLabel.trim()]
    const rule: TriageRule = {
      id: uid(),
      projectId: project.id,
      name: name.trim(),
      enabled: true,
      when: { match: 'all', conditions: [{ key: field, op, value: value || undefined }] },
      set
    }
    dispatch({ type: 'addTriageRule', rule })
    setName('')
    setValue('')
  }

  return (
    <div className="settings-form">
      {rules.map(r => (
        <div key={r.id} className="option-row">
          <label className="check-field">
            <input type="checkbox" checked={r.enabled} onChange={e => dispatch({ type: 'patchTriageRule', id: r.id, patch: { enabled: e.target.checked } })} />
          </label>
          <span className="grow small">{r.name}</span>
          <button className="icon-btn" aria-label="Delete triage rule" onClick={() => dispatch({ type: 'deleteTriageRule', id: r.id })}>{ICONS.trash}</button>
        </div>
      ))}
      {rules.length === 0 && <div className="muted small">No triage rules. Matching new items get the fields set below.</div>}

      <div className="field">
        <input className="field-input" placeholder="Rule name" value={name} onChange={e => setName(e.target.value)} />
        <div className="field-row">
          <select className="field-input" value={field} onChange={e => setField(e.target.value)}>
            {fields.map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <select className="field-input" value={op} onChange={e => setOp(e.target.value as Operator)}>
            {CONDITION_OPS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {op !== 'empty' && op !== 'not_empty' && (
          <input className="field-input" placeholder="Value" value={value} onChange={e => setValue(e.target.value)} />
        )}
        <div className="field-row">
          <input className="field-input" placeholder="Set assignee" value={setAssignee} onChange={e => setSetAssignee(e.target.value)} />
          <input className="field-input" placeholder="Add label" value={setLabel} onChange={e => setSetLabel(e.target.value)} />
        </div>
        <div className="field-row">
          <select className="field-input" value={setStatus} onChange={e => setSetStatus(e.target.value)}>
            <option value="">Keep status</option>
            {project.statuses.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <select className="field-input" value={setPriority} onChange={e => setSetPriority(e.target.value)}>
            <option value="">Keep priority</option>
            {['1', '2', '3', '4'].map((p, n) => (
              <option key={p} value={p}>{['Urgent', 'High', 'Medium', 'Low'][n]}</option>
            ))}
          </select>
        </div>
        <button className="btn primary" onClick={create} disabled={!name.trim()}>Add triage rule</button>
      </div>
    </div>
  )
}

function Templates({ project }: { project: Project }) {
  const { data, dispatch } = useStore()
  const templates = data.templates.filter(t => t.projectId === project.id)
  return (
    <div className="settings-form">
      {templates.map(t => (
        <div key={t.id} className="option-row">
          <span className="grow small">{t.name} <span className="muted">· {t.title}</span></span>
          <button className="icon-btn" aria-label="Delete template" onClick={() => dispatch({ type: 'deleteTemplate', id: t.id })}>{ICONS.trash}</button>
        </div>
      ))}
      {templates.length === 0 && <div className="muted small">Open an item and choose Save as template.</div>}
    </div>
  )
}
