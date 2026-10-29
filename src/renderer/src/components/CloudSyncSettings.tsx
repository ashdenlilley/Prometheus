import { Fragment, useEffect, useState } from 'react'
import type { CloudDevice, CloudMember, CloudMembers, CloudStatus } from '../env'
import { roleLabel, type Role } from '@shared/permissions'
import { useStore } from '../store'

const STATE_LABEL: Record<CloudStatus['state'], string> = {
  off: 'Off',
  'signing-in': 'Signing in',
  connecting: 'Connecting',
  connected: 'Connected',
  offline: 'Offline',
  error: 'Error'
}

// Roles an owner can give someone (owner is not granted by invite).
const INVITE_ROLES: Role[] = ['member', 'guest', 'viewer']

const message = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter(x => x !== id))

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

  // Invited members take the workspace copy as-is, so there is no confirm step.
  const joinWorkspace = () => void run(() => window.api.cloud.join('adopt').then(reload))

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
        cloud.role !== 'owner' ? (
          <>
            <p className="muted small">
              You were invited to this workspace. This device's data will be replaced by the workspace's data; a backup copy is kept.
            </p>
            <div className="token-row">
              <button className="btn" disabled={busy} onClick={joinWorkspace}>Join workspace</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              {cloud.email} already has data on {cloud.serverUrl}. Choose what this device does with it.
            </p>
            <div className="token-row">
              <button className="btn" disabled={busy} onClick={() => join('merge')}>Merge this device's data</button>
              <button className="btn ghost" disabled={busy} onClick={() => join('adopt')}>Replace this device's data with the cloud copy</button>
            </div>
          </>
        )
      ) : (
        <>
          <div className="muted small">
            Signed in as {cloud.email}{cloud.role && ` · ${roleLabel(cloud.role)}`} · {cloud.serverUrl}
          </div>
          <div className="muted small">
            <span className="chip neutral" role="status">{STATE_LABEL[cloud.state]}</span>{' '}
            {cloud.pending ? `${cloud.pending} pending · ` : ''}
            {cloud.lastSync ? `Last sync ${new Date(cloud.lastSync).toLocaleTimeString()}` : 'Waiting for first sync'}
          </div>
          {cloud.presence.length > 0 && (
            <div className="muted small">Online now: {cloud.presence.map(p => p.name).join(', ')}</div>
          )}
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
          <Members owner={cloud.role === 'owner'} />
        </>
      )}

      {cloud.backup && <p className="muted small">Backup of your previous data: {cloud.backup}</p>}
      {cloud.error && <p className="small sync-error">{cloud.error}</p>}
      {error && <p className="small sync-error">{error}</p>}
    </section>
  )
}

// Owners manage roles, guest projects, removals and invites. Everyone else sees the list read-only.
function Members({ owner }: { owner: boolean }) {
  const { data } = useStore()
  const [team, setTeam] = useState<CloudMembers | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [projects, setProjects] = useState<string[]>([])
  const [sent, setSent] = useState<string | null>(null)

  const load = () => window.api.cloud.members().then(setTeam)

  useEffect(() => {
    load().catch(err => setError(message(err)))
  }, [])

  // Each change reloads the lists so the tables show what the server stored.
  const change = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = (m: CloudMember) => {
    if (!window.confirm(`Remove ${m.name}? They lose access to this workspace.`)) return
    void change(() => window.api.cloud.removeMember(m.id))
  }

  const sendInvite = () => {
    const to = email.trim()
    void change(async () => {
      await window.api.cloud.invite({ email: to, name: name.trim() || undefined, role, projects: role === 'guest' ? projects : undefined })
      setSent(to)
      setEmail('')
      setName('')
      setRole('member')
      setProjects([])
    })
  }

  const members = team?.members ?? []
  const invites = team?.invites ?? []

  return (
    <>
      <div className="section-title-row small">
        <h3>Members</h3>
      </div>
      <table className="muted small" aria-label="Members" style={{ width: '100%', margin: '8px 0', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left' }}>Name</th>
            {owner && <th scope="col" style={{ textAlign: 'left' }}>Email</th>}
            <th scope="col" style={{ textAlign: 'left' }}>Role</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <Fragment key={m.id}>
              <tr>
                <td>{m.name}</td>
                {owner && <td>{m.email}</td>}
                <td>
                  {owner && m.role !== 'owner' ? (
                    <select
                      className="field-input"
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      disabled={busy}
                      onChange={e => {
                        const next = e.target.value as Role
                        void change(() => window.api.cloud.updateMember(m.id, { role: next }))
                      }}
                    >
                      {INVITE_ROLES.map(r => (
                        <option key={r} value={r}>{roleLabel(r)}</option>
                      ))}
                    </select>
                  ) : (
                    roleLabel(m.role)
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {owner && m.role !== 'owner' && (
                    <button className="btn ghost" aria-label={`Remove ${m.name}`} disabled={busy} onClick={() => remove(m)}>Remove</button>
                  )}
                </td>
              </tr>
              {owner && m.role === 'guest' && (
                <tr>
                  <td colSpan={4}>
                    <div className="token-row" role="group" aria-label={`Projects for ${m.name}`}>
                      {data.projects.map(p => (
                        <label key={p.id} className="check-field small">
                          <input
                            type="checkbox"
                            checked={!!m.projects?.includes(p.id)}
                            disabled={busy}
                            onChange={e => {
                              const next = toggle(m.projects ?? [], p.id, e.target.checked)
                              void change(() => window.api.cloud.updateMember(m.id, { projects: next }))
                            }}
                          />{' '}
                          {p.name}
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      {owner && invites.length > 0 && (
        <table className="muted small" aria-label="Pending invites" style={{ width: '100%', margin: '8px 0', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left' }}>Email</th>
              <th scope="col" style={{ textAlign: 'left' }}>Role</th>
              <th scope="col" style={{ textAlign: 'left' }}>Expires</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {invites.map(i => (
              <tr key={i.id}>
                <td>{i.email}</td>
                <td>{roleLabel(i.role)}</td>
                <td>{new Date(i.expiresAt).toLocaleDateString()}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn ghost" aria-label={`Revoke invite for ${i.email}`} disabled={busy} onClick={() => void change(() => window.api.cloud.revokeInvite(i.id))}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {owner && (
        <>
          <label className="settings-field">
            <span className="muted small">Invite email</span>
            <input className="field-input" aria-label="Invite email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="settings-field">
            <span className="muted small">Invite name</span>
            <input className="field-input" aria-label="Invite name" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="settings-field">
            <span className="muted small">Role</span>
            <select className="field-input" aria-label="Invite role" value={role} onChange={e => setRole(e.target.value as Role)}>
              {INVITE_ROLES.map(r => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </label>
          {role === 'guest' && (
            <div className="token-row" role="group" aria-label="Invite projects">
              {data.projects.map(p => (
                <label key={p.id} className="check-field small">
                  <input type="checkbox" checked={projects.includes(p.id)} onChange={e => setProjects(toggle(projects, p.id, e.target.checked))} />{' '}
                  {p.name}
                </label>
              ))}
            </div>
          )}
          <div className="token-row">
            <button className="btn" disabled={busy || !email.trim()} onClick={sendInvite}>Send invite</button>
          </div>
          {sent && <p className="muted small" role="status">Invite sent to {sent}. The link expires in 7 days.</p>}
        </>
      )}

      {error && <p className="small sync-error">{error}</p>}
    </>
  )
}
