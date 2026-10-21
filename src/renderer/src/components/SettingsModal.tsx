import { useEffect, useState } from 'react'
import type { McpStatus, SyncStatus } from '../env'
import { ICONS } from './icons'
import { Modal } from './ui'

// Settings: sync folder, and the local MCP endpoint for Claude Code, Codex and other local agents.
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [reveal, setReveal] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  // Folder already holding other devices' data. Waiting for the user to choose merge or replace.
  const [pick, setPick] = useState<{ folder: string; devices: number } | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)

  useEffect(() => {
    window.api.mcp.status().then(setStatus)
    window.api.sync.status().then(setSync)
    // Keeps the sync line fresh while the dialog is open.
    const timer = setInterval(() => window.api.sync.status().then(setSync), 2000)
    return () => clearInterval(timer)
  }, [])

  const chooseFolder = async () => {
    const folder = await window.api.sync.chooseFolder()
    if (!folder) return
    const { devices } = await window.api.sync.inspect(folder)
    if (devices === 0) return joinFolder(folder, 'push')
    setPick({ folder, devices })
  }

  const joinFolder = async (folder: string, mode: 'push' | 'adopt') => {
    if (mode === 'adopt' && !window.confirm("Replace this device's data with the data in the sync folder? Local data not yet in the folder is lost.")) return
    setSyncBusy(true)
    try {
      setSync(await window.api.sync.join(folder, mode))
      setPick(null)
    } finally {
      setSyncBusy(false)
    }
  }

  const turnOff = async () => {
    await window.api.sync.disable()
    setSync(await window.api.sync.status())
  }

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
        <div className="settings-title">Sync across devices</div>
        {sync?.enabled ? (
          <>
            <div className="muted small">Syncing to {sync.folder}</div>
            <div className="muted small">
              {sync.error
                ? `Error: ${sync.error}`
                : sync.lastSync
                  ? `Last synced ${new Date(sync.lastSync).toLocaleTimeString()}${sync.pending ? ` · ${sync.pending} pending` : ''}`
                  : 'Waiting for first sync…'}
            </div>
            <div className="token-row">
              <button className="btn" disabled={syncBusy} onClick={() => window.api.sync.now()}>Sync now</button>
              <button className="btn" disabled={syncBusy} onClick={chooseFolder}>Change folder</button>
              <button className="btn ghost" onClick={turnOff}>Turn off</button>
            </div>
          </>
        ) : pick ? (
          <>
            <p className="muted small">
              {pick.folder} already holds data from {pick.devices} other {pick.devices === 1 ? 'device' : 'devices'}.
            </p>
            <div className="token-row">
              <button className="btn" disabled={syncBusy} onClick={() => joinFolder(pick.folder, 'push')}>Merge this device in</button>
              <button className="btn ghost" disabled={syncBusy} onClick={() => joinFolder(pick.folder, 'adopt')}>Replace with folder data</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              Keeps devices in step through a folder such as iCloud Drive. Each device writes only its own files there. Off by default.
            </p>
            <div className="token-row">
              <button className="btn" disabled={syncBusy} onClick={chooseFolder}>Choose folder…</button>
            </div>
          </>
        )}
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
