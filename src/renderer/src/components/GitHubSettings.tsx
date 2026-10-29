import { useEffect, useState } from 'react'
import type { GitStatus } from '../env'

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

// Settings section: the GitHub token (kept in the OS keychain by the main process), test, refresh and poll settings.
export function GitHubSettings() {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [token, setToken] = useState('')
  const [test, setTest] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [minutes, setMinutes] = useState('')
  const [prefix, setPrefix] = useState('')

  useEffect(() => {
    const load = () => window.api.git.status().then(setStatus)
    load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [])

  // The fields are only copied from the status once, so a refresh never overwrites what is being typed.
  useEffect(() => {
    if (!status) return
    setMinutes(String(status.pollMinutes))
    setPrefix(status.branchPrefix)
  },[status?.pollMinutes, status?.branchPrefix])

  const fail = (err: unknown) => setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

  const saveToken = async () => {
    setError(null)
    setTest(null)
    try {
      const res = await window.api.git.setToken(token.trim())
      // A GitStatus also has an error field (the last poll's), so a refusal is told apart by ok: false.
      if ('ok' in res) return setError(res.error)
      setToken('')
      setStatus(res)
    } catch (err) {
      fail(err)
    }
  }

  const runTest = async () => {
    const res = await window.api.git.test()
    setTest(res.ok ? `OK, signed in as ${res.login}` : `Error: ${res.error}`)
  }

  const refresh = async () => setStatus(await window.api.git.refresh())

  const remove = async () => {
    if (!window.confirm('Remove the GitHub token from this device? Linked PRs stay, but they stop updating here.')) return
    setTest(null)
    setStatus(await window.api.git.clearToken())
  }

  // Minutes outside 1..15 are not sent; the field goes back to the saved value.
  const saveMinutes = async () => {
    const n = Math.round(Number(minutes))
    if (!Number.isFinite(n) || n < 1 || n > 15) {
      setMinutes(String(status?.pollMinutes))
      return setError('Check every 1 to 15 minutes.')
    }
    if (n !== status?.pollMinutes) setStatus(await window.api.git.setSettings({ pollMinutes: n }))
  }

  const savePrefix = async () => {
    if (prefix.trim() !== status?.branchPrefix) setStatus(await window.api.git.setSettings({ branchPrefix: prefix }))
  }

  if (!status) return null

  const blocked = status.backoffUntil && status.backoffUntil > Date.now()

  return (
    <section className="settings-section">
      <div className="settings-title">GitHub</div>

      {status.hasToken ? (
        <>
          <div className="small">
            Connected{status.login ? ` as ${status.login}` : ''}
          </div>
          <div className="muted small">Token ••••{status.tokenHint}</div>
          <div className="token-row">
            <button className="btn" onClick={runTest}>Test</button>
            <button className="btn" onClick={refresh}>Refresh now</button>
            <button className="btn ghost" onClick={remove}>Remove token</button>
          </div>
          {test && <div className="small">{test}</div>}
          <div className="muted small">
            {status.lastPoll ? `Last checked ${new Date(status.lastPoll).toLocaleTimeString()}` : 'Not checked yet'}
            {status.error && ` · Error: ${status.error}`}
            {blocked && ` · Paused until ${new Date(status.backoffUntil!).toLocaleTimeString()}: GitHub's rate limit is nearly used up`}
          </div>
        </>
      ) : (
        <>
          <p className="muted small git-help">
            Use a fine-grained token limited to the repos you link, with <code>Pull requests: Read-only</code>. Metadata: Read-only is added automatically.
          </p>
          <label className="settings-field">
            <span className="muted small">Personal access token</span>
            <input className="field-input" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
          </label>
          <div className="token-row">
            <button className="btn" disabled={!token.trim()} onClick={saveToken}>Save</button>
            <button className="btn ghost" onClick={() => window.api.openExternal(TOKEN_URL)}>Create a token on GitHub</button>
          </div>
        </>
      )}

      <label className="settings-field">
        <span className="muted small">Check every (minutes)</span>
        <input
          className="field-input"
          type="number"
          min={1}
          max={15}
          value={minutes}
          onChange={e => setMinutes(e.target.value)}
          onBlur={saveMinutes}
        />
      </label>
      <label className="settings-field">
        <span className="muted small">Branch prefix (optional)</span>
        <input
          className="field-input"
          placeholder="e.g. ashdenlilley"
          maxLength={40}
          value={prefix}
          onChange={e => setPrefix(e.target.value)}
          onBlur={savePrefix}
        />
      </label>

      {error && <p className="git-error small">{error}</p>}
    </section>
  )
}
