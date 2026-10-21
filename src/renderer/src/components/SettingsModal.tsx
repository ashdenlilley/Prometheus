import { useEffect, useState } from 'react'
import type { McpStatus } from '../env'
import { ICONS } from './icons'
import { Modal } from './ui'

// Settings: local MCP endpoint for Claude Code, Codex and other local agents.
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
    </Modal>
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
