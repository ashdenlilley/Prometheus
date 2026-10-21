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
  icon?: ReactNode
}

// Small popover menu anchored under its trigger.
export function Menu({ items, align = 'left' }: { items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false), open)
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Column menu">{ICONS.more}</button>
      {open && (
        <div className={`popover ${align}`} role="menu">
          {items.map(item => (
            <button
              key={item.label}
              role="menuitem"
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
