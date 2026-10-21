import { useState } from 'react'
import { useStore } from '../store'
import { addDays, projectKey, todayISO, uid } from '../util'
import { Modal } from './ui'

export function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { dispatch } = useStore()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#5e6ad2')
  const [startDate, setStartDate] = useState(todayISO())
  const [targetDate, setTargetDate] = useState(addDays(todayISO(), 90))

  const create = () => {
    if (!name.trim()) return
    const id = uid()
    dispatch({
      type: 'addProject',
      project: { id, name: name.trim(), key: projectKey(name), color, startDate, targetDate, columns: [], widths: {} }
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
        Color
        <input type="color" value={color} onChange={e => setColor(e.target.value)} />
      </label>
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
