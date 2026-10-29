import { useEffect, useState } from 'react'
import type { McpStatus } from '../env'
import type { AuditFilter, AuditRow, AuditSource } from '@shared/audit'
import type { Agent } from '@shared/types'
import { useStore } from '../store'
import { clsx, fmtDate } from '../util'
import { ICONS } from './icons'
import { Modal } from './ui'
import { SyncSettings } from './SyncSettings'
import { IntegrationsSettings } from './IntegrationsSettings'
import { GitHubSettings } from './GitHubSettings'

// Settings: sync across devices, and the local MCP endpoint for Claude Code, Codex and other local agents.
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [reveal, setReveal] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    window.api.mcp.status().then(setStatus)
  }, [])

  const toggle = async (enabled: boolean) => setStatus(await window.api.mcp.setEnabled(enabled))
  const regenerate = async () => {
    if (!window.confirm('Create a new token? Agents using the old token will stop working.')) return
    setStatus(await window.api.mcp.regenerate())
  }

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1400)
  }

  if (!status) return null

  const claudeCmd = `claude mcp add --transport http --header "Authorization: Bearer ${status.token}" prometheus ${status.url}`
  const codexToml = `[mcp_servers.prometheus]\nurl = "${status.url}"\nhttp_headers = { Authorization = "Bearer ${status.token}" }`
  const apiBase = status.url.replace(/\/mcp$/, '/api/v1')
  const restCurl = `curl -H "Authorization: Bearer ${status.token}" ${apiBase}/issues?project=<KEY>`
  const masked =`${status.token.slice(0, 4)}${'•'.repeat(24)}${status.token.slice(-4)}`

  return (
    <Modal title="Settings" onClose={onClose}>
      <SyncSettings />
      <IntegrationsSettings />
      <GitHubSettings />

      <section className="settings-section">
        <div className="settings-row">
          <div>
            <div className="settings-title">Local MCP server</div>
            <div className="muted small">
              {status.running ? `Running at ${status.url}` : status.enabled ? 'Starting…' : 'Off'}
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={status.enabled} onChange={e => toggle(e.target.checked)} />
            <span className="switch-track" />
          </label>
        </div>
        <p className="muted small">
          Lets local agents read and change spaces, projects and issues. Listens on 127.0.0.1 only and requires the token below.
        </p>
      </section>

      <section className="settings-section">
        <div className="settings-title">Shared token (Unnamed agent)</div>
        <div className="token-row">
          <code className="token">{reveal ? status.token : masked}</code>
          <button className="btn" onClick={() => setReveal(r => !r)}>{reveal ? 'Hide' : 'Show'}</button>
          <button className="btn" onClick={() => copy('token', status.token)}>
            {copied === 'token' ? 'Copied' : 'Copy'}
          </button>
          <button className="btn ghost" onClick={regenerate}>Regenerate</button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-title">Connect Claude Code</div>
        <CodeBlock text={claudeCmd} copied={copied === 'claude'} onCopy={() => copy('claude', claudeCmd)} />
      </section>

      <section className="settings-section">
        <div className="settings-title">Connect Codex</div>
        <CodeBlock text={codexToml} copied={copied === 'codex'} onCopy={() => copy('codex', codexToml)} />
      </section>

      <section className="settings-section">
        <div className="settings-title">REST API</div>
        <div className="muted small">Base URL {apiBase}</div>
        <p className="muted small">Uses the shared MCP token above (agent tokens are MCP only). Localhost only. See docs/api.md.</p>
        <CodeBlock text={restCurl} copied={copied === 'rest'} onCopy={() => copy('rest', restCurl)} />
      </section>

      <AgentsSection url={status.url} />

      <AuditLog />
    </Modal>
  )
}

const AGENT_COLORS = ['#0a84ff', '#34c759', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff']

// Agents are MCP clients with their own token. The token is kept only in this component's state, so closing the modal hides it.
function AgentsSection({ url }: { url: string }) {
  const { data, dispatch } = useStore()
  const agents = data.agents ?? []
  const [name, setName] = useState('')
  const [level, setLevel] = useState<Agent['level']>('comment')
  const [created, setCreated] = useState<{ agent: Agent; token: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const create = async () => {
    const next = await window.api.createAgent(name.trim(), AGENT_COLORS[agents.length % AGENT_COLORS.length], level)
    setCreated(next)
    setCopied(false)
    setName('')
  }

  const copyToken = async () => {
    if (!created) return
    await navigator.clipboard.writeText(created.token)
    setCopied(true)
  }

  const revoke = (a: Agent) => {
    if (!window.confirm(`Revoke ${a.name}? Its token will stop working.`)) return
    dispatch({ type: 'revokeAgent', id: a.id, at: new Date().toISOString() })
  }

  return (
    <section className="settings-section">
      <div className="settings-title">Agents</div>
      <p className="muted small">
        Agents get their own token. read: look only. comment: comment and move their own issues. write: everything except agents, settings and sync.
      </p>
      {agents.map(a => (
        <div key={a.id} className={clsx('agent-row', a.revokedAt && 'muted')}>
          <span className="agent-dot" style={{ background: a.color }} />
          <span className="grow">{a.name}</span>
          {a.revokedAt ? (
            <span className="small">Revoked</span>
          ) : (
            <select aria-label={`Level for ${a.name}`} className="field-input" value={a.level} onChange={e => dispatch({ type: 'patchAgent', id: a.id, patch: { level: e.target.value as Agent['level'] } })}>
              <option value="read">read</option>
              <option value="comment">comment</option>
              <option value="write">write</option>
            </select>
          )}
          <span className="muted small">{fmtDate(a.createdAt.slice(0, 10))}</span>
          {!a.revokedAt && <button className="btn ghost" onClick={() => revoke(a)}>Revoke</button>}
        </div>
      ))}
      <div className="agent-row">
        <input aria-label="Agent name" className="field-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <select aria-label="Agent level" className="field-input" value={level} onChange={e => setLevel(e.target.value as Agent['level'])}>
          <option value="read">read</option>
          <option value="comment">comment</option>
          <option value="write">write</option>
        </select>
        <button className="btn" disabled={!name.trim()} onClick={create}>Create agent</button>
      </div>
      {created && (
        <div className="agent-row">
          <p className="muted small">Copy this token now. It will not be shown again.</p>
          <div className="token-row">
            <input className="token" readOnly data-testid="agent-token" value={created.token} />
            <button className="btn" onClick={copyToken}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p className="muted small">Send <code>Authorization: Bearer &lt;token&gt;</code> with requests to {url}</p>
        </div>
      )}
    </section>
  )
}

const AUDIT_PAGE = 500
const AUDIT_TABLES = ['spaces', 'initiatives', 'projects', 'issues', 'cycles', 'automations', 'triage_rules', 'templates', 'dashboards']

// Recent changes, newest first. Filters are applied by the main process; export uses the same filters.
function AuditLog() {
  const [source, setSource] = useState<AuditSource | ''>('')
  const [table, setTable] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<AuditRow[]>([])
  const query: AuditFilter = { source: source || undefined, table: table || undefined, q: q.trim() || undefined }

  useEffect(() => {
    void window.api.auditList({ ...query, limit: AUDIT_PAGE }).then(setRows)
  }, [source, table, q])

  const more = () =>
    window.api.auditList({ ...query, before: rows[rows.length - 1].seq, limit: AUDIT_PAGE }).then(next => setRows([...rows, ...next]))

  const exportCsv = async () => {
    const blob = new Blob([await window.api.auditCsv(query)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'prometheus-audit.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section className="settings-section">
      <div className="settings-title">Audit log</div>
      <div className="audit-controls">
        <select className="field-input" aria-label="Audit source" value={source} onChange={e => setSource(e.target.value as AuditSource | '')}>
          <option value="">All</option>
          <option value="ui">UI</option>
          <option value="mcp">MCP</option>
          <option value="sync">Sync</option>
        </select>
        <select className="field-input" aria-label="Audit table" value={table} onChange={e => setTable(e.target.value)}>
          <option value="">All</option>
          {AUDIT_TABLES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input className="field-input" aria-label="Search audit log" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn" aria-label="Export audit CSV" onClick={exportCsv}>Export CSV</button>
      </div>
      {rows.length === 0 ? (
        <p className="muted small">No changes match.</p>
      ) : (
        <div className="audit-list">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Action</th>
                <th>Table</th>
                <th>Target id</th>
                <th>Fields</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.seq}>
                  <td>{new Date(r.at).toLocaleString()}</td>
                  <td>{r.source}</td>
                  <td>{r.action}</td>
                  <td>{r.table}</td>
                  <td>{r.targetId}</td>
                  <td>{r.fields?.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length >= AUDIT_PAGE && <button className="btn ghost" onClick={more}>Load more</button>}
    </section>
  )
}

function CodeBlock({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="code-block">
      <pre>{text}</pre>
      <button className="icon-btn code-copy" onClick={onCopy} aria-label="Copy">
        {copied ? 'Copied' : ICONS.external}
      </button>
    </div>
  )
}
