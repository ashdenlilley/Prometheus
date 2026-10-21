import { useState } from 'react'
import { useStore } from '../store'
import { LABEL_COLORS } from '../columns'
import { uid } from '../util'
import { Modal } from './ui'

export function NewSpaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { dispatch } = useStore()
  const [name, setName] = useState('')
  const [color, setColor] = useState(LABEL_COLORS[4])

  const create = () => {
    if (!name.trim()) return
    const id = uid()
    dispatch({ type: 'addSpace', space: { id, name: name.trim(), color } })
    onCreated(id)
  }

  return (
    <Modal title="New space" onClose={onClose}>
      <label className="field">
        Name
        <input
          className="field-input"
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
        />
      </label>
      <div className="field">
        Colour
        <div className="swatches">
          {LABEL_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className={`swatch${color === c ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={create}>Create space</button>
      </div>
    </Modal>
  )
}
