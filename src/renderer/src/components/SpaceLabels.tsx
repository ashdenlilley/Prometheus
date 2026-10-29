import { useState } from 'react'
import type { LabelDef, Space } from '@shared/types'
import { labelGroups } from '@shared/labels'
import { useStore } from '../store'
import { ICONS } from './icons'
import { LABEL_COLORS } from '../columns'

// Labels shared by every project in the space. Each one can belong to a group, where only one label per group is allowed.
export function SpaceLabels({ space }: { space: Space }) {
  const { data, dispatch } = useStore()
  const labels = space.labels ?? []
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [color, setColor] = useState(LABEL_COLORS[0])

  const save = (next: LabelDef[]) => dispatch({ type: 'patchSpace', id: space.id, patch: { labels: next } })

  const add = () => {
    const label = name.trim()
    if (!label || labels.some(l => l.name.toLowerCase() === label.toLowerCase())) return
    save([...labels, { name: label, color, group: group.trim() || undefined }])
    setName('')
    setGroup('')
  }

  return (
    <>
      <div className="section-title-row">
        <h2>Shared labels</h2>
      </div>
      <div className="label-chips">
        {labels.map(l => (
          <span key={l.name} className="tag">
            <span className="dot" style={{ background: l.color }} /> {l.name}
            {l.group && <span className="muted small"> · {l.group}</span>}
            <button className="icon-btn" aria-label={`Delete label ${l.name}`} onClick={() => save(labels.filter(x => x.name !== l.name))}>{ICONS.close}</button>
          </span>
        ))}
        {labels.length === 0 && <span className="muted small">No shared labels yet.</span>}
      </div>
      <div className="label-add">
        <input className="field-input" aria-label="Label name" placeholder="Label name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <input className="field-input" aria-label="Label group" placeholder="Group (optional)" list="label-groups" value={group} onChange={e => setGroup(e.target.value)} />
        <datalist id="label-groups">
          {labelGroups(data, space.id).map(g => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <select aria-label="Label colour" value={color} onChange={e => setColor(e.target.value)}>
          {LABEL_COLORS.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button className="btn" onClick={add}>{ICONS.plus} Add label</button>
      </div>
    </>
  )
}
