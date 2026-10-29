import { useEffect, useState } from 'react'
import type { McpStatus } from '../env'
import type { AuditFilter, AuditRow, AuditSource } from '@shared/audit'
import { ICONS } from './icons'
import { Modal } from './ui'
import { SyncSettings } from './SyncSettings'
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
  const masked = `${status.token.slice(0, 4)}${'•'.repeat(24)}${status.token.slice(-4)}`

  return (
    <Modal title="Settings" onClose={onClose}>
      <SyncSettings />
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
        <div className="settings-title">Token</div>
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

      <AuditLog />
    </Modal>
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
