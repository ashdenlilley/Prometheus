import { useEffect, useMemo, useRef, useState } from 'react'
import { useEscape } from './ui'
import { clsx } from '../util'

export interface PaletteItem {
  id: string
  label: string
  group: string
  hint?: string
  // Searched but not shown
  keywords?: string
  run: () => void
}

// Cmd+K menu: navigation, creation, settings and issue search.
export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEscape(onClose)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items.slice(0, 60)
    return items.filter(i => `${i.label} ${i.group} ${i.hint ?? ''} ${i.keywords ?? ''}`.toLowerCase().includes(q)).slice(0, 60)
  }, [items, query])

  useEffect(() => setCursor(0), [query])

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }

  return (
    <div className="overlay palette-overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command menu" onMouseDown={e => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          placeholder="Type a command, project or issue key"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor(c => Math.min(c + 1, shown.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor(c => Math.max(c - 1, 0))
            }
            if (e.key === 'Enter') run(shown[cursor])
          }}
        />
        <div className="palette-list">
          {shown.map((item, n) => (
            <button
              key={item.id}
              className={clsx('palette-item', n === cursor && 'on')}
              onMouseEnter={() => setCursor(n)}
              onClick={() => run(item)}
            >
              <span className="muted small palette-group">{item.group}</span>
              <span className="grow ellipsis">{item.label}</span>
              {item.hint && <span className="muted small">{item.hint}</span>}
            </button>
          ))}
          {shown.length === 0 && <div className="muted pad">No matches.</div>}
        </div>
      </div>
    </div>
  )
}
