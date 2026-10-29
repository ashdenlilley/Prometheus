import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ICONS } from './icons'

// Calls onOutside when a mousedown lands outside ref.
export function useOutside(ref: RefObject<HTMLElement>, onOutside: () => void, active = true) {
  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, onOutside, active])
}

export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape])
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={title} onMouseDown={e => e.stopPropagation()}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">{ICONS.close}</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function QuickAdd({ onAdd, placeholder = 'Add issue' }: { onAdd: (title: string) => void; placeholder?: string }) {
  const [value, setValue] = useState('')

  const submit = () => {
    const title = value.trim()
    if (!title) return
    onAdd(title)
    setValue('')
  }

  return (
    <input
      className="quick-add"
      value={value}
      placeholder={placeholder}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') submit()
        if (e.key === 'Escape') setValue('')
      }}
    />
  )
}

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  title?: string // tooltip, e.g. why a disabled item is unavailable
  icon?: ReactNode
}

// Small popover menu anchored under its trigger.
export function Menu({ items, align = 'left', label = 'Column menu' }: { items: MenuItem[]; align?: 'left' | 'right'; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false), open)
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label={label}>{ICONS.more}</button>
      {open && (
        <div className={`popover ${align}`} role="menu">
          {items.map(item => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              className={`popover-item${item.danger ? ' danger' : ''}`}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              <span className="popover-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Electron does not support window.prompt(). askText() opens an in-app text dialog instead.
interface Ask {
  label: string
  value: string
  resolve: (v: string | null) => void
}

let openAsk: ((a: Ask) => void) | null = null

export function askText(label: string, value = ''): Promise<string | null> {
  return new Promise(resolve => {
    if (openAsk) openAsk({ label, value, resolve })
    else resolve(null)
  })
}

// Mounted once in App. Renders the dialog requested by askText().
export function PromptHost() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    openAsk = a => {
      setText(a.value)
      setAsk(a)
    }
    return () => {
      openAsk = null
    }
  }, [])

  if (!ask) return null
  const done = (v: string | null) => {
    ask.resolve(v)
    setAsk(null)
  }
  return (
    <Modal title={ask.label} onClose={() => done(null)}>
      <input
        className="field-input"
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') done(text.trim() || null)
        }}
      />
      <div className="actions">
        <button className="btn" onClick={() => done(null)}>Cancel</button>
        <button className="btn primary" onClick={() => done(text.trim() || null)}>OK</button>
      </div>
    </Modal>
  )
}
