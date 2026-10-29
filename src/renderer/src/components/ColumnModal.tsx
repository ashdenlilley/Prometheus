import { useState } from 'react'
import { PRIORITIES, type AutomationAction, type Column, type ColumnType, type Project, type SelectOption } from '@shared/types'
import { hasColumnRules, type Role } from '@shared/permissions'
import { useStore } from '../store'
import { useRole } from '../useRole'
import { COLUMN_TYPE_INFO, HAS_OPTIONS, LABEL_COLORS } from '../columns'
import { ICONS } from './icons'
import { Modal } from './ui'
import { uid } from '../util'

const STATUS_DEFAULTS: SelectOption[] = [
  { id: 'working', label: 'Working on it', color: '#fdab3d' },
  { id: 'done', label: 'Done', color: '#00c875' },
  { id: 'stuck', label: 'Stuck', color: '#e2445c' },
  { id: 'idle', label: 'Not started', color: '#c4c4c4' }
]

// OS-464: roles a column rule can name. The owner always has full access, so it is not listed.
type RuleRole = Exclude<Role, 'owner'>
const RULE_ROLES: { role: RuleRole; label: string }[] = [
  { role: 'member', label: 'Members' },
  { role: 'guest', label: 'Guests' },
  { role: 'viewer', label: 'Viewers' }
]
const toggleRole = (list: RuleRole[], r: RuleRole) => (list.includes(r) ? list.filter(x => x !== r) : [...list, r])

// Button "On click": count only, or one automation action. Mirrors AutomationAction, which the reducer runs.
type ButtonKind = 'count' | NonNullable<Column['buttonAction']>['type']

const actionText = (a?: AutomationAction) =>
  a?.type === 'add_label' ? a.label : a?.type === 'notify' ? a.message : a?.type === 'create_issue' ? a.title : ''

// Add a new column (no `column`) or edit an existing one.
export function ColumnModal({ project, column, onClose }: { project: Project; column?: Column; onClose: () => void }) {
  const { data, dispatch } = useStore()
  const role = useRole()
  const [name, setName] = useState(column?.name ?? '')
  const [type, setType] = useState<ColumnType>(column?.type ?? 'text')
  const [description, setDescription] = useState(column?.description ?? '')
  const [options, setOptions] = useState<SelectOption[]>(
    column?.options ?? (type === 'status' ? STATUS_DEFAULTS : [])
  )
  const [numberFormat, setNumberFormat] = useState<NonNullable<Column['numberFormat']>>(column?.numberFormat ?? 'plain')
  const [currency, setCurrency] = useState(column?.currency ?? 'USD')
  const [includeTime, setIncludeTime] = useState(!!column?.includeTime)
  const [footer, setFooter] = useState<NonNullable<Column['footer']> | ''>(column?.footer ?? '')
  const [formula, setFormula] = useState(column?.formula ?? '')
  const [progressMode, setProgressMode] = useState<NonNullable<Column['progressMode']>>(column?.progressMode ?? 'manual')
  const [linkProjectId, setLinkProjectId] = useState(column?.linkProjectId ?? '')
  const [relationColumnId, setRelationColumnId] = useState(column?.relationColumnId ?? '')
  const [mirrorField, setMirrorField] = useState(column?.mirrorField ?? 'title')
  const [required, setRequired] = useState(!!column?.required)
  const [buttonLabel, setButtonLabel] = useState(column?.buttonLabel ?? '')
  const [buttonKind, setButtonKind] = useState<ButtonKind>(column?.buttonAction?.type ?? 'count')
  const [buttonText, setButtonText] = useState(actionText(column?.buttonAction))
  const [buttonStatus, setButtonStatus] = useState(column?.buttonAction?.type === 'set_status' ? column.buttonAction.status : project.statuses[0]?.id ?? '')
  const [buttonPriority, setButtonPriority] = useState(column?.buttonAction?.type === 'set_priority' ? column.buttonAction.priority : 1)
  const [readOnlyFor, setReadOnlyFor] = useState<RuleRole[]>(column?.access?.readOnlyFor ?? [])
  const [hiddenFor, setHiddenFor] = useState<RuleRole[]>(column?.access?.hiddenFor ?? [])
  // Only the owner changes a column that has rules. A local workspace (no role) edits everything.
  const locked = !!column && role !== null && role !== 'owner' && hasColumnRules([column])

  const hasOptions = HAS_OPTIONS.includes(type)
  const space = data.projects.filter(p => p.spaceId === project.spaceId && p.id !== project.id)
  const relationCols = project.columns.filter(c => c.type === 'board_relation' && c.id !== column?.id)
  const linked = data.projects.find(p => p.id === (linkProjectId || relationCols.find(c => c.id === relationColumnId)?.linkProjectId))

  const changeType = (next: ColumnType) => {
    setType(next)
    if (HAS_OPTIONS.includes(next) && options.length === 0) {
      setOptions(next === 'status' ? STATUS_DEFAULTS : [{ id: uid(), label: 'Option 1', color: LABEL_COLORS[0] }])
    }
  }

  // Empty text leaves the action unset, so the button only counts clicks.
  const buttonAction = (): AutomationAction | undefined => {
    const text = buttonText.trim()
    switch (buttonKind) {
      case 'set_status': return { type: 'set_status', status: buttonStatus }
      case 'set_priority': return { type: 'set_priority', priority: buttonPriority }
      case 'move_to_cycle': return { type: 'move_to_cycle' }
      case 'add_label': return text ? { type: 'add_label', label: text } : undefined
      case 'notify': return text ? { type: 'notify', message: text } : undefined
      case 'create_issue': return text ? { type: 'create_issue', title: text } : undefined
      default: return undefined
    }
  }

  const save = () => {
    if (!name.trim() || locked) return
    const action = type === 'button' ? buttonAction() : undefined
    const patch: Partial<Column> = {
      buttonAction: action,
      buttonLabel: action && buttonLabel.trim() ? buttonLabel.trim() : undefined,
      name: name.trim(),
      type,
      description: description || undefined,
      options: hasOptions ? options.filter(o => o.label.trim()) : undefined,
      numberFormat: type === 'number' ? numberFormat : undefined,
      currency: type === 'number' && numberFormat === 'currency' ? currency : undefined,
      includeTime: type === 'date' && includeTime ? true : undefined,
      footer: footer || undefined,
      formula: type === 'formula' ? formula : undefined,
      progressMode: type === 'progress' && progressMode === 'subissues' ? progressMode : undefined,
      linkProjectId: type === 'board_relation' ? linkProjectId || undefined : undefined,
      relationColumnId: type === 'mirror' ? relationColumnId || undefined : undefined,
      mirrorField: type === 'mirror' ? mirrorField : undefined,
      required: required || undefined,
      // Empty lists are left out; with no rules at all, access is unset
      access: readOnlyFor.length || hiddenFor.length
        ? { readOnlyFor: readOnlyFor.length ? readOnlyFor : undefined, hiddenFor: hiddenFor.length ? hiddenFor : undefined }
        : undefined
    }
    if (column) {
      dispatch({ type: 'patchColumn', projectId: project.id, columnId: column.id, patch })
    } else {
      dispatch({ type: 'addColumn', projectId: project.id, column: { id: uid(), ...patch, name: patch.name!, type } })
    }
    onClose()
  }

  const updateOption = (id: string, patch: Partial<SelectOption>) =>
    setOptions(opts => opts.map(o => (o.id === id ? { ...o, ...patch } : o)))

  const groups = [...new Set(COLUMN_TYPE_INFO.map(t => t.group))]

  return (
    <Modal title={column ? 'Edit column' : 'Add column'} onClose={onClose}>
      <label className="field">
        Name
        <input className="field-input" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      </label>

      <div className="field">
        Type
        {groups.map(g => (
          <div key={g} className="type-group">
            <div className="muted small">{g}</div>
            <div className="type-grid">
              {COLUMN_TYPE_INFO.filter(t => t.group === g).map(t => (
                <button
                  key={t.type}
                  type="button"
                  className={`type-tile${type === t.type ? ' on' : ''}`}
                  onClick={() => changeType(t.type)}
                >
                  <span className="type-glyph">{t.glyph}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <label className="field">
        Description
        <input className="field-input" value={description} onChange={e => setDescription(e.target.value)} />
      </label>

      {type === 'number' && (
        <div className="field-row">
          <label className="field">
            Format
            <select className="field-input" value={numberFormat} onChange={e => setNumberFormat(e.target.value as typeof numberFormat)}>
              <option value="plain">Plain</option>
              <option value="decimal">Decimal (2 dp)</option>
              <option value="currency">Currency</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          {numberFormat === 'currency' && (
            <label className="field">
              Currency
              <input className="field-input" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} />
            </label>
          )}
        </div>
      )}

      {type === 'date' && (
        <label className="field-row">
          <input type="checkbox" aria-label="Include time" checked={includeTime} onChange={e => setIncludeTime(e.target.checked)} />
          Include time
        </label>
      )}

      {type === 'formula' && (
        <label className="field">
          Formula
          <input className="field-input" value={formula} placeholder="Estimate * 2" onChange={e => setFormula(e.target.value)} />
          <span className="muted small">Names of number columns, with + - * / ^ % and brackets. Functions: SUM, AVG, MIN, MAX, ABS, ROUND, IF. Comparisons: &lt; &gt; = &lt;= &gt;= &lt;&gt;.</span>
        </label>
      )}

      {type === 'board_relation' && (
        <label className="field">
          Connect to project
          <select className="field-input" value={linkProjectId} onChange={e => setLinkProjectId(e.target.value)}>
            <option value="">Choose project</option>
            <option value={project.id}>{project.name} (this project)</option>
            {space.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}

      {type === 'mirror' && (
        <div className="field-row">
          <label className="field">
            Through column
            <select className="field-input" value={relationColumnId} onChange={e => setRelationColumnId(e.target.value)}>
              <option value="">Choose connect column</option>
              {relationCols.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Show
            <select className="field-input" value={mirrorField} onChange={e => setMirrorField(e.target.value)}>
              <option value="title">Title</option>
              <option value="status">Status</option>
              {linked?.columns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {hasOptions && (
        <div className="field">
          Labels
          <div className="option-list">
            {options.map(o => (
              <div key={o.id} className="option-row">
                <input
                  className="color-swatch"
                  type="color"
                  value={o.color}
                  onChange={e => updateOption(o.id, { color: e.target.value })}
                  aria-label="Label colour"
                />
                <input className="field-input" value={o.label} onChange={e => updateOption(o.id, { label: e.target.value })} />
                <button className="icon-btn" onClick={() => setOptions(opts => opts.filter(x => x.id !== o.id))} aria-label="Remove label">
                  {ICONS.close}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn subtle"
              onClick={() => setOptions(opts => [...opts, { id: uid(), label: `Option ${opts.length + 1}`, color: LABEL_COLORS[opts.length % LABEL_COLORS.length] }])}
            >
              {ICONS.plus} Add label
            </button>
          </div>
        </div>
      )}

      {type === 'progress' && (
        <label className="field">
          Progress source
          <select className="field-input" aria-label="Progress source" value={progressMode} onChange={e => setProgressMode(e.target.value as typeof progressMode)}>
            <option value="manual">Manual</option>
            <option value="subissues">From sub-issues</option>
          </select>
        </label>
      )}

      {type === 'button' && (
        <>
          <label className="field">
            Button label
            <input className="field-input" aria-label="Button label" value={buttonLabel} placeholder={name || 'Button'} onChange={e => setButtonLabel(e.target.value)} />
          </label>
          <label className="field">
            On click
            <select className="field-input" aria-label="Button action" value={buttonKind} onChange={e => setButtonKind(e.target.value as ButtonKind)}>
              <option value="count">Count clicks only</option>
              <option value="set_status">Set status</option>
              <option value="set_priority">Set priority</option>
              <option value="add_label">Add label</option>
              <option value="notify">Notify</option>
              <option value="create_issue">Create sub-issue</option>
              <option value="move_to_cycle">Move to current cycle</option>
            </select>
          </label>
          {buttonKind === 'set_status' && (
            <select className="field-input" aria-label="Button status" value={buttonStatus} onChange={e => setButtonStatus(e.target.value)}>
              {project.statuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          {buttonKind === 'set_priority' && (
            <select className="field-input" aria-label="Button priority" value={buttonPriority} onChange={e => setButtonPriority(Number(e.target.value))}>
              {PRIORITIES.map((p, n) => <option key={p} value={n}>{p}</option>)}
            </select>
          )}
          {['add_label', 'notify', 'create_issue'].includes(buttonKind) && (
            <input className="field-input" aria-label="Button text" value={buttonText} placeholder={buttonKind === 'notify' ? 'Message' : buttonKind === 'add_label' ? 'Label' : 'Sub-issue title'} onChange={e => setButtonText(e.target.value)} />
          )}
        </>
      )}

      {(type === 'number' || type === 'progress' || type === 'formula') && (
        <label className="field">
          Footer summary
          <select className="field-input" value={footer} onChange={e => setFooter(e.target.value as typeof footer)}>
            <option value="">Default</option>
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
            <option value="min">Min</option>
            <option value="max">Max</option>
            <option value="count">Count</option>
            <option value="none">None</option>
          </select>
        </label>
      )}

      <label className="check-field">
        <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
        Required
      </label>

      {role === 'owner' && (
        <div className="field col-perm">
          Permissions
          {[
            { label: 'Read-only for', testId: 'readonly', list: readOnlyFor, set: setReadOnlyFor },
            { label: 'Hidden from', testId: 'hidden', list: hiddenFor, set: setHiddenFor }
          ].map(row => (
            <div key={row.testId} className="col-perm-row">
              <span className="muted small">{row.label}</span>
              {RULE_ROLES.map(r => (
                <label key={r.role} className="check-field">
                  <input
                    type="checkbox"
                    data-testid={`col-${row.testId}-${r.role}`}
                    checked={row.list.includes(r.role)}
                    onChange={() => row.set(l => toggleRole(l, r.role))}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          ))}
          <span className="muted small">The owner always has full access. Hidden values are not sent to those roles.</span>
        </div>
      )}

      {locked && <span className="muted small">Only the owner can change this column</span>}

      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={locked} onClick={save}>{column ? 'Save' : 'Add column'}</button>
      </div>
    </Modal>
  )
}
