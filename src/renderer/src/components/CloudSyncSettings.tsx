import { useEffect, useState } from 'react'
import type { CloudDevice, CloudStatus } from '../env'

const STATE_LABEL: Record<CloudStatus['state'], string> = {
  off: 'Off',
  'signing-in': 'Signing in',
  connecting: 'Connecting',
  connected: 'Connected',
  offline: 'Offline',
  error: 'Error'
}

const message = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

// Settings section: one account on a cloud sync server. Folder sync and cloud sync cannot both be on.
export function CloudSyncSettings() {
  const [cloud, setCloud] = useState<CloudStatus | null>(null)
  const [folderOn, setFolderOn] = useState(false)
  const [devices, setDevices] = useState<CloudDevice[]>([])
  const [serverUrl, setServerUrl] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => window.api.cloud.status().then(setCloud)

  useEffect(() => {
    const refresh = () => {
      void reload()
      void window.api.sync.status().then(s => setFolderOn(!!s?.enabled))
    }
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])

  const showingDevices = !!cloud?.enabled && !cloud.needsJoin
  useEffect(() => {
    if (showingDevices) window.api.cloud.devices().then(setDevices, err => setError(message(err)))
  }, [showingDevices])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const sendLink = () =>
    run(async () => {
      await window.api.cloud.signIn(serverUrl.trim(), email.trim())
      await reload()
    })

  const cancel = () => run(() => window.api.cloud.cancelSignIn().then(reload))

  const join = (mode: 'merge' | 'adopt') => {
    if (mode === 'adopt' && !window.confirm("Replace this device's data with the cloud copy? Local data not yet in the cloud is lost.")) return
    void run(() => window.api.cloud.join(mode).then(reload))
  }

  const revoke = (device: CloudDevice) => {
    if (!window.confirm(`Revoke ${device.name}? It will be signed out and stop syncing.`)) return
    void run(async () => {
      await window.api.cloud.revokeDevice(device.id)
      setDevices(await window.api.cloud.devices())
    })
  }

  const signOut = () => void run(() => window.api.cloud.signOut().then(reload))

  if (!cloud) return null

  return (
    <section className="settings-section">
      <div className="settings-title">Cloud sync</div>

      {cloud.signIn ? (
        <>
          <p className="muted small">
            Check {cloud.signIn.email} for a sign-in link. It works once and expires in 15 minutes.
          </p>
          <div className="token-row">
            <button className="btn ghost" aria-label="Cancel sign-in" disabled={busy} onClick={cancel}>Cancel</button>
          </div>
        </>
      ) : !cloud.enabled ? (
        <>
          <p className="muted small">
            Keeps this workspace in step across your devices through a cloud server. The server can read your data. Off by default.
          </p>
          <label className="settings-field">
            <span className="muted small">Server URL</span>
            <input className="field-input" aria-label="Server URL" type="url" autoComplete="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)} />
          </label>
          <label className="settings-field">
            <span className="muted small">Email</span>
            <input className="field-input" aria-label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          {folderOn && <p className="muted small">Turn off folder sync to use cloud sync.</p>}
          <div className="token-row">
            <button className="btn" disabled={busy || folderOn || !serverUrl.trim() || !email.trim()} onClick={sendLink}>
              Send sign-in link
            </button>
          </div>
        </>
      ) : cloud.needsJoin ? (
        <>
          <p className="muted small">
            {cloud.email} already has data on {cloud.serverUrl}. Choose what this device does with it.
          </p>
          <div className="token-row">
            <button className="btn" disabled={busy} onClick={() => join('merge')}>Merge this device's data</button>
            <button className="btn ghost" disabled={busy} onClick={() => join('adopt')}>Replace this device's data with the cloud copy</button>
          </div>
        </>
      ) : (
        <>
          <div className="muted small">
            {cloud.email} · {cloud.serverUrl}
          </div>
          <div className="muted small">
            <span className="chip" role="status">{STATE_LABEL[cloud.state]}</span>{' '}
            {cloud.pending ? `${cloud.pending} pending · ` : ''}
            {cloud.lastSync ? `Last sync ${new Date(cloud.lastSync).toLocaleTimeString()}` : 'Waiting for first sync'}
          </div>
          <table className="muted small" aria-label="Devices" style={{ width: '100%', margin: '8px 0', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left' }}>Device</th>
                <th scope="col" style={{ textAlign: 'left' }}>Last seen</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id}>
                  <td>{d.name}{d.id === cloud.deviceId && ' (This device)'}</td>
                  <td>{new Date(d.lastSeenAt).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    {d.id !== cloud.deviceId && (
                      <button className="btn ghost" aria-label={`Revoke ${d.name}`} disabled={busy} onClick={() => revoke(d)}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="token-row">
            <button className="btn ghost" disabled={busy} onClick={signOut}>Sign out</button>
          </div>
        </>
      )}

      {cloud.error && <p className="small sync-error">{cloud.error}</p>}
      {error && <p className="small sync-error">{error}</p>}
    </section>
  )
}
