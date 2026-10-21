import { useRef, useState } from 'react'
import { issueKey, useStore } from '../store'
import { ICONS } from './icons'
import { useOutside } from './ui'
import { clsx } from '../util'

// Bell in the top bar. Lists mentions and automation alerts; opens the issue on click.
export function NotificationsPanel({ onOpen }: { onOpen: (issueId: string) => void }) {
  const { data, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false), open)
  const unread = data.notifications.filter(n => !n.read).length
  const issueOf = (id?: string) => (id ? data.issues.find(i => i.id === id) : undefined)

  return (
    <div className="menu" ref={ref}>
      <button className={clsx('icon-btn bell', unread > 0 && 'has-unread')} onClick={() => setOpen(o => !o)} aria-label={`Notifications, ${unread} unread`} title="Notifications">
        {ICONS.bell}
        {unread > 0 && <span className="badge dot-badge">{unread}</span>}
      </button>
      {open && (
        <div className="popover right notif-pop" role="dialog" aria-label="Notifications">
          <div className="popover-row">
            <span className="grow small muted">Notifications</span>
            <button className="btn ghost" onClick={() => dispatch({ type: 'markNotifications', read: true })}>Mark all read</button>
          </div>
          {data.notifications.length === 0 && <div className="muted pad small">Nothing yet.</div>}
          {data.notifications.slice(0, 50).map(n => (
            <button
              key={n.id}
              className={clsx('popover-item notif', !n.read && 'unread')}
              onClick={() => {
                setOpen(false)
                if (n.issueId) onOpen(n.issueId)
              }}
            >
              <span className="grow">{n.text}</span>
              {issueOf(n.issueId) && <span className="muted small">{issueKey(data, issueOf(n.issueId)!)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
