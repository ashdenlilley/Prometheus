import { useEffect, useState } from 'react'
import type { Integration } from '@shared/types'
import { scopeLabel } from '@shared/integrations'
import { reducer } from '@shared/model'
import type { IntegrationStatus, IntegrationTestResult } from '../env'
import { useStore } from '../store'
import { uid } from '../util'
import { ProviderBadge } from './ProviderBadge'

type SetResult = IntegrationStatus | { ok: false; error: string }

// A failed IPC call reads the same as a refused URL.
const callSetWebhook = (id: string, url: string): Promise<SetResult> =>
  window.api.integrations.setWebhook(id, url).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }))

// Settings > Integrations. Integrations are shared data; each device keeps its own webhook URLs, which never come back out in full.
export function IntegrationsSettings() {
  const { data, dispatch } = useStore()
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [tests, setTests] = useState<Record<string, IntegrationTestResult>>({})
  const [replacing, setReplacing] = useState<{ id: string; url: string; error?: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('')
  const [channel, setChannel] = useState('')
  const [url, setUrl] = useState('')
  const [addError, setAddError] = useState('')

  useEffect(() => {
    window.api.integrations.status().then(setStatus)
  }, [])

  const configured = status?.configured ?? {}
  const scopeChoice = scope || (data.projects[0] ? `project:${data.projects[0].id}` : data.spaces[0] ? `space:${data.spaces[0].id}` : '')

  const add = async () => {
    const [kind, scopeId] = scopeChoice.split(':') as [Integration['scope'], string]
    const integration: Integration = {
      id: uid(),
      provider: 'slack',
      name: name.trim(),
      scope: kind,
      scopeId,
      settings: channel.trim() ? { channel: channel.trim() } : {},
      createdAt: new Date().toISOString()
    }
    // The URL goes in first, so a refused URL leaves nothing behind. Then the integration is saved and the status re-read,
    // because the main process lists hints only for integrations in its saved copy.
    const result = await callSetWebhook(integration.id, url.trim())
    if ('ok' in result) return setAddError(result.error)
    dispatch({ type: 'addIntegration', integration })
    await window.api.save(reducer(data, { type: 'addIntegration', integration }))
    const fresh = await window.api.integrations.status()
    setStatus(fresh)
    setName('')
    setChannel('')
    setUrl('')
    setAddError('')
    setAdding(false)
  }

  const saveReplace = async () => {
    if (!replacing) return
    const result = await callSetWebhook(replacing.id, replacing.url.trim())
    if ('ok' in result) return setReplacing({ ...replacing, url: '', error: result.error })
    setStatus(result)
    setReplacing(null)
  }

  const test = async (id: string) => setTests({ ...tests, [id]: await window.api.integrations.test(id) })

  const removeWebhook = async (id: string) => setStatus(await window.api.integrations.clearWebhook(id))

  const remove = (i: Integration) => {
    if (!window.confirm(`Delete "${i.name}"? Automations that post to it will be disabled.`)) return
    dispatch({ type: 'removeIntegration', id: i.id })
  }

  return (
    <section className="settings-section">
      <div className="settings-title">Integrations</div>
      {status && !status.keychain && (
        <p className="error small">
          Webhook URLs cannot be stored on this device: the OS keychain is not available, so these integrations cannot post here.
        </p>
      )}

      {(data.integrations ?? []).map(i => {
        const hint = configured[i.id]?.hint
        const result = tests[i.id]
        return (
          <div key={i.id} className="settings-form integration-row">
            <div className="option-row">
              <ProviderBadge provider="slack" />
              <div className="grow">
                <div className="small">{i.name}</div>
                <div className="muted small">
                  Slack · {scopeLabel(data, i)}
                  {i.settings.channel ? ` · ${i.settings.channel}` : ''}
                </div>
              </div>
              <span className="small">{hint ? `Webhook set (…${hint.slice(-4)})` : 'Not set up on this device'}</span>
            </div>
            <div className="option-row">
              <button className="btn" onClick={() => test(i.id)}>Send test message</button>
              <button className="btn ghost" onClick={() => setReplacing({ id: i.id, url: '' })}>Replace webhook URL</button>
              {hint && <button className="btn ghost" onClick={() => removeWebhook(i.id)}>Remove webhook from this device</button>}
              <button className="btn danger" onClick={() => remove(i)}>Delete integration</button>
              {result && <span className={result.ok ? 'small' : 'error small'}>{result.ok ? 'OK' : result.error}</span>}
            </div>
            {replacing?.id === i.id && (
              <div className="option-row">
                <input
                  type="password"
                  autoComplete="off"
                  className="field-input grow"
                  aria-label="New webhook URL"
                  placeholder="https://hooks.slack.com/services/…"
                  value={replacing.url}
                  onChange={e => setReplacing({ id: i.id, url: e.target.value })}
                />
                <button className="btn primary" onClick={saveReplace}>Save URL</button>
                <button className="btn ghost" onClick={() => setReplacing(null)}>Cancel</button>
              </div>
            )}
            {replacing?.id === i.id && replacing.error && <p className="error small">{replacing.error}</p>}
          </div>
        )
      })}

      {!adding ? (
        <div>
          <button className="btn" onClick={() => setAdding(true)}>Add Slack</button>
        </div>
      ) : (
        <div className="settings-form">
          <input className="field-input" aria-label="Integration name" placeholder="Name, e.g. Eng alerts" value={name} onChange={e => setName(e.target.value)} />
          <div className="field-row">
            <select aria-label="Integration scope" className="field-input" value={scopeChoice} onChange={e => setScope(e.target.value)}>
              <optgroup label="Projects">
                {data.projects.map(p => (
                  <option key={p.id} value={`project:${p.id}`}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Spaces">
                {data.spaces.map(s => (
                  <option key={s.id} value={`space:${s.id}`}>{s.name}</option>
                ))}
              </optgroup>
            </select>
            <input aria-label="Channel label" className="field-input" placeholder="Channel label (optional)" value={channel} onChange={e => setChannel(e.target.value)} />
          </div>
          <input
            type="password"
            autoComplete="off"
            className="field-input"
            aria-label="Webhook URL"
            placeholder="https://hooks.slack.com/services/…"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
          <div className="muted small">The URL is stored on this device only, and is shown masked after saving.</div>
          {addError && <p className="error small">{addError}</p>}
          <div className="actions">
            <button className="btn ghost" onClick={() => { setAdding(false); setAddError('') }}>Cancel</button>
            <button className="btn primary" disabled={!status?.keychain || !name.trim() || !url.trim() || !scopeChoice} onClick={add}>
              Add Slack
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
