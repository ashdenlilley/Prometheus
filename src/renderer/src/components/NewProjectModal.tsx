import { useState } from 'react'
import { useStore } from '../store'
import { blankProject } from '@shared/seed'
import { instantiateProjectTemplate } from '@shared/projectTemplates'
import { addDays, projectKey, todayISO, uid } from '../util'
import { Modal } from './ui'

export function NewProjectModal({
  spaceId,
  onClose,
  onCreated
}: {
  spaceId: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { data, dispatch } = useStore()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#5e6ad2')
  const [lead, setLead] = useState('')
  const [initiativeId, setInitiativeId] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  const [targetDate, setTargetDate] = useState(addDays(todayISO(), 90))
  const [templateId, setTemplateId] = useState('')
  const initiatives = data.initiatives.filter(i => i.spaceId === spaceId)
  const templates = data.spaces.find(s => s.id === spaceId)?.projectTemplates ?? []

  const create = () => {
    if (!name.trim()) return
    const tpl = templates.find(t => t.id === templateId)
    if (tpl) {
      const made = instantiateProjectTemplate(tpl, { spaceId, name: name.trim(), key: projectKey(name), newId: uid, now: new Date().toISOString() })
      const project = { ...made.project, color, lead, initiativeId: initiativeId || undefined, startDate, targetDate }
      dispatch({ type: 'addProjectFromTemplate', ...made, project })
      onCreated(project.id)
      return
    }
    const id = uid()
    dispatch({
      type: 'addProject',
      project: blankProject({
        id,
        spaceId,
        name: name.trim(),
        key: projectKey(name),
        color,
        lead,
        initiativeId: initiativeId || undefined,
        status: 'planned',
        startDate,
        targetDate
      })
    })
    onCreated(id)
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <label className="field">
        Name
        <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
      </label>
      <label className="field">
        Template
        <select aria-label="Project template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
          <option value="">Blank</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Lead
        <input value={lead} onChange={e => setLead(e.target.value)} />
      </label>
      {initiatives.length > 0 && (
        <label className="field">
          Initiative
          <select value={initiativeId} onChange={e => setInitiativeId(e.target.value)}>
            <option value="">None</option>
            {initiatives.map(i => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className="field">
        <span>Color</span>
        <input
          className="color-field"
          type="color"
          value={color}
          onChange={e => setColor(e.target.value)}
          aria-label="Project colour"
        />
      </div>
      <label className="field">
        Start
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
      </label>
      <label className="field">
        Target
        <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
      </label>
      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={create}>Create</button>
      </div>
    </Modal>
  )
}
