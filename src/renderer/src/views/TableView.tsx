import { useState } from 'react'
import { STATUSES, type Column, type ColumnType, type Issue, type Project } from '@shared/types'
import { createIssue, issueKey, useStore, withValue } from '../store'
import { CellEditor, COLUMN_TYPE_OPTIONS, PrioritySelect, StatusDot, StatusSelect } from '../components/fields'
import { Modal, QuickAdd } from '../components/ui'
import { uid } from '../util'

const FIXED_COLUMNS = 'minmax(240px, 1fr) 140px 120px 130px 120px'

export function TableView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [addingColumn, setAddingColumn] = useState(false)
  const issues = data.issues.filter(i => i.projectId === project.id)
  const columns = project.columns
  const grid = { gridTemplateColumns: `${FIXED_COLUMNS} ${columns.map(() => 'minmax(120px, 160px)').join(' ')} 40px` }

  const update = (id: string, patch: Partial<Issue>) => dispatch({ type: 'patchIssue', id, patch })

  const deleteColumn = (c: Column) => {
    if (window.confirm(`Delete column "${c.name}"? Its values are removed.`)) {
      dispatch({ type: 'deleteColumn', projectId: project.id, columnId: c.id })
    }
  }

  return (
    <div className="view">
      <div className="table-wrap">
        <div className="t-row t-head" style={grid}>
          <span>Name</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Assignee</span>
          <span>Due</span>
          {columns.map(c => (
            <span key={c.id} className="t-col-head">
              {c.name}
              <button className="icon-btn tiny" title="Delete column" onClick={() => deleteColumn(c)}>×</button>
            </span>
          ))}
          <button className="icon-btn" title="Add column" onClick={() => setAddingColumn(true)}>+</button>
        </div>

        {STATUSES.map(s => {
          const items = issues.filter(i => i.status === s.id)
          const open = !collapsed[s.id]
          return (
            <div key={s.id} className="t-group">
              <div className="t-group-head" onClick={() => setCollapsed(c => ({ ...c, [s.id]: open }))}>
                <span className="caret">{open ? '▾' : '▸'}</span>
                <StatusDot status={s.id} />
                <span>{s.label}</span>
                <span className="count">{items.length}</span>
              </div>

              {open && items.map(i => (
                <div key={i.id} className="t-row" style={grid}>
                  <span className="t-title" onClick={() => onOpen(i.id)}>
                    <span className="muted">{issueKey(data, i)}</span> {i.title}
                  </span>
                  <StatusSelect value={i.status} onChange={status => update(i.id, { status })} />
                  <PrioritySelect value={i.priority} onChange={priority => update(i.id, { priority })} />
                  <input
                    className="cell-input"
                    value={i.assignee}
                    placeholder="Unassigned"
                    onChange={e => update(i.id, { assignee: e.target.value })}
                  />
                  <input
                    className="cell-input"
                    type="date"
                    value={i.dueDate ?? ''}
                    onChange={e => update(i.id, { dueDate: e.target.value || undefined })}
                  />
                  {columns.map(c => (
                    <CellEditor
                      key={c.id}
                      column={c}
                      variant="cell"
                      value={i.values[c.id]}
                      onChange={v => update(i.id, { values: withValue(i.values, c.id, v) })}
                    />
                  ))}
                  <span />
                </div>
              ))}

              {open && (
                <div className="t-add">
                  <QuickAdd
                    placeholder="+ Add item"
                    onAdd={title =>
                      dispatch({ type: 'addIssue', issue: createIssue(data, project.id, title, { status: s.id }) })
                    }
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {addingColumn && <AddColumnModal project={project} onClose={() => setAddingColumn(false)} />}
    </div>
  )
}

function AddColumnModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { dispatch } = useStore()
  const [name, setName] = useState('')
  const [type, setType] = useState<ColumnType>('text')
  const [options, setOptions] = useState('')

  const save = () => {
    if (!name.trim()) return
    const column: Column = {
      id: uid(),
      name: name.trim(),
      type,
      ...(type === 'select' ? { options: options.split(',').map(s => s.trim()).filter(Boolean) } : {})
    }
    dispatch({ type: 'patchProject', id: project.id, patch: { columns: [...project.columns, column] } })
    onClose()
  }

  return (
    <Modal title="Add column" onClose={onClose}>
      <label className="field">
        Name
        <input autoFocus value={name} onChange={e => setName(e.target.value)} />
      </label>
      <label className="field">
        Type
        <select value={type} onChange={e => setType(e.target.value as ColumnType)}>
          {COLUMN_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {type === 'select' && (
        <label className="field">
          Options (comma separated)
          <input value={options} onChange={e => setOptions(e.target.value)} placeholder="Design, Build, Ship" />
        </label>
      )}
      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Add</button>
      </div>
    </Modal>
  )
}
