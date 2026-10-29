import { useEffect, useState } from 'react'
import type { Project, Webhook, WebhookEvent } from '@shared/types'
import { WEBHOOK_EVENTS, type WebhookDelivery, urlAllowed } from '@shared/webhooks'
import { useStore } from '../store'
import { ICONS } from './icons'
import { clsx } from '../util'

const DEFAULT_EVENTS: WebhookEvent[] = ['issue.created', 'issue.updated', 'comment.created']
const LOG_REFRESH_MS = 2000
const TEST_REFRESH_MS = 1000

const STATUS_COLOR: Record<WebhookDelivery['status'], string> = {
  delivered: '#30d158',
  pending: 'var(--panel2)',
  failed: 'var(--danger)'
}

// Outgoing webhooks for one project. Config is synced through the store; secrets are shown once and kept only on this device.
export function WebhooksSection({ project }: { project: Project }) {
  const { data, dispatch } = useStore()
  const hooks = (data.webhooks ?? []).filter(w => w.projectId === project.id)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<WebhookEvent[]>(DEFAULT_EVENTS)
  const [allowLocal, setAllowLocal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [logs, setLogs] = useState<WebhookDelivery[]>([])
  const [tick, setTick] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  const check = url.trim() ? urlAllowed(url.trim(), allowLocal) : null
  const reason = check && !check.ok ? check.reason : null

  // Load the open log now and then every few seconds. `tick` forces an immediate reload after a test send.
  useEffect(() => {
    if (!openId) return
    const load = () => window.api.webhooks.deliveries(openId).then(setLogs)
    void load()
    const timer = setInterval(load, LOG_REFRESH_MS)
    return () => clearInterval(timer)
  }, [openId, tick])

  const toggleEvent = (ev: WebhookEvent) => setEvents(cur => (cur.includes(ev) ? cur.filter(e => e !== ev) : [...cur, ev]))

  const add = async () => {
    if (!check?.ok || events.length === 0) return
    setError(null)
    try {
      const res = await window.api.webhooks.create(project.id, url.trim(), events, allowLocal)
      setUrl('')
      setSecret(res.secret)
      setCopied(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const rotate = async (w: Webhook) => {
    if (!window.confirm('Rotate the signing secret? Receivers using the old secret will reject deliveries until updated.')) return
    setSecret(await window.api.webhooks.rotateSecret(w.id))
    setCopied(false)
  }

  const remove = async (w: Webhook) => {
    if (!window.confirm(`Delete the webhook for ${w.url}?`)) return
    await window.api.webhooks.remove(w.id)
    if (openId === w.id) setOpenId(null)
  }

  const test = async (w: Webhook) => {
    setNote(await window.api.webhooks.test(w.id))
    setTimeout(() => setTick(t => t + 1), TEST_REFRESH_MS)
  }

  const redeliver = async (d: WebhookDelivery) => setNote(await window.api.webhooks.redeliver(d.id))

  const setEnabled = (w: Webhook, enabled: boolean) =>
    dispatch({ type: 'patchWebhook', id: w.id, patch: enabled ? { enabled, disabledReason: undefined } : { enabled } })

  const copySecret = async () => {
    if (!secret) return
    await navigator.clipboard.writeText(secret)
    setCopied(true)
  }

  return (
    <>
      <div className="section-title-row small">
        <h3>Webhooks</h3>
      </div>
      <p className="muted small">Webhooks send issue data to the URL you enter. Deliveries come only from this device, for changes made here.</p>

      {hooks.map(w => (
        <div key={w.id} className="webhook-item">
          <div className="option-row">
            <label className="check-field">
              <input type="checkbox" aria-label="Webhook enabled" checked={w.enabled} onChange={e => setEnabled(w, e.target.checked)} />
            </label>
            <code className="webhook-url grow" title={w.url}>{w.url}</code>
          </div>
          <div className="option-row">
            {w.events.map(ev => (
              <span key={ev} className="chip neutral">{ev}</span>
            ))}
          </div>
          {w.disabledReason && <div className="muted small">{w.disabledReason}</div>}
          <div className="option-row">
            <button className="btn subtle" onClick={() => test(w)}>Send test</button>
            <button className="btn subtle" aria-pressed={openId === w.id} onClick={() => setOpenId(openId === w.id ? null : w.id)}>Deliveries</button>
            <button className="btn subtle" onClick={() => rotate(w)}>Rotate secret</button>
            <button className="btn ghost" onClick={() => remove(w)}>Delete</button>
          </div>
          {openId === w.id && (
            <table className="webhook-deliveries small" data-testid="webhook-deliveries">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Last code or error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {logs.map(d => (
                  <tr key={d.id}>
                    <td>{new Date(d.createdAt).toLocaleString()}</td>
                    <td>{d.event}</td>
                    <td>
                      <span className={clsx('chip', d.status === 'pending' && 'neutral')} style={{ background: STATUS_COLOR[d.status] }}>{d.status}</span>
                    </td>
                    <td>{d.attempts}</td>
                    <td>{d.lastCode ?? d.lastError ?? ''}</td>
                    <td>
                      <button className="btn subtle" onClick={() => redeliver(d)}>Redeliver</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {openId === w.id && logs.length === 0 && <div className="muted small">No deliveries yet.</div>}
        </div>
      ))}
      {note && <div className="muted small">{note}</div>}

      {secret && (
        <div className="settings-form">
          <div className="token-row">
            <input className="field-input grow" readOnly data-testid="webhook-secret" aria-label="Webhook signing secret" value={secret} />
            <button className="btn" onClick={copySecret}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <div className="muted small">Copy this signing secret now. It will not be shown again.</div>
        </div>
      )}

      <div className="settings-form">
        <input className="field-input" aria-label="Webhook URL" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} />
        <div className="option-row webhook-events">
          {WEBHOOK_EVENTS.map(ev => (
            <label key={ev} className="small">
              <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} /> {ev}
            </label>
          ))}
        </div>
        <label className="small">
          <input type="checkbox" aria-label="Allow local network" checked={allowLocal} onChange={e => setAllowLocal(e.target.checked)} /> Allow local network
        </label>
        {(reason ?? error) && (
          <div className="small" data-testid="webhook-error" style={{ color: 'var(--danger)' }}>{reason ?? error}</div>
        )}
        <div className="option-row">
          <button className="btn subtle" onClick={add} disabled={!check?.ok || events.length === 0}>{ICONS.plus} Add webhook</button>
        </div>
      </div>
    </>
  )
}
