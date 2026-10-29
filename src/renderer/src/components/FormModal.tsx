import { useState } from 'react'
import { PRIORITIES, type IntakeForm, type Project } from '@shared/types'
import { fieldName, submissionToIssue } from '@shared/forms'
import { useStore } from '../store'
import { Modal } from './ui'

// Fills in an intake form. Submit files the answers as a triage item in the project.
export function FormModal({ form, project, onClose }: { form: IntakeForm; project: Project; onClose: () => void }) {
  const { data, dispatch } = useStore()
  const [answers, setAnswers] = useState<Record<string, unknown>>({ priority: 0 })
  const [errors, setErrors] = useState<string[]>([])
  const set = (key: string, v: unknown) => setAnswers(a => ({ ...a, [key]: v }))

  const submit = () => {
    const number = data.issues.filter(i => i.projectId === project.id).reduce((m, i) => Math.max(m, i.number), 0) + 1
    const { issue, errors: found } = submissionToIssue(form, project, answers, { id: crypto.randomUUID(), number, now: new Date().toISOString() })
    setErrors(found)
    if (issue) {
      dispatch({ type: 'addIssue', issue })
      onClose()
    }
  }

  // One input per field. Column fields use the column's type; fixed fields use their own.
  const input = (key: string) => {
    const col = project.columns.find(c => c.id === key)
    const v = answers[key]
    if (key === 'title') return <input className="field-input" value={String(v ?? '')} onChange={e => set(key, e.target.value)} />
    if (key === 'description' || col?.type === 'long_text') return <textarea className="field-input" value={String(v ?? '')} onChange={e => set(key, e.target.value)} />
    if (key === 'priority') {
      return (
        <select className="field-input" value={String(v ?? 0)} onChange={e => set(key, Number(e.target.value))}>
          {PRIORITIES.map((p, n) => (
            <option key={p} value={n}>{p}</option>
          ))}
        </select>
      )
    }
    if (key === 'dueDate' || col?.type === 'date') return <input className="field-input" type="date" value={String(v ?? '')} onChange={e => set(key, e.target.value)} />
    if (col?.type === 'number') return <input className="field-input" type="number" value={String(v ?? '')} onChange={e => set(key, e.target.value)} />
    if (col?.type === 'checkbox') return <input type="checkbox" checked={!!v} onChange={e => set(key, e.target.checked)} />
    if (col?.options?.length) {
      return (
        <select className="field-input" value={String(v ?? '')} onChange={e => set(key, e.target.value)}>
          <option value="">Choose…</option>
          {col.options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      )
    }
    // Labels and any other text-like column: comma-separated text.
    return <input className="field-input" placeholder={key === 'labels' ? 'Comma separated' : undefined} value={String(v ?? '')} onChange={e => set(key, e.target.value)} />
  }

  return (
    <Modal title={form.name} onClose={onClose}>
      {form.description && <p className="muted small">{form.description}</p>}
      {form.fields.map(f => {
        const name = f.label ?? fieldName(project, f.key)
        const required = f.required || f.key === 'title'
        return (
          <label key={f.key} className="field">
            <span className="small">
              {name}
              {required && <span aria-label="required"> *</span>}
            </span>
            {input(f.key)}
            {f.help && <span className="muted small">{f.help}</span>}
          </label>
        )
      })}
      {errors.map(e => (
        <div key={e} className="small" style={{ color: 'var(--danger)' }}>{e}</div>
      ))}
      <div className="option-row">
        <button className="btn primary" aria-label="Submit form" onClick={submit}>Submit</button>
      </div>
    </Modal>
  )
}
