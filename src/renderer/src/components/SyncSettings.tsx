import { useEffect, useState } from 'react'
import type { SyncInspect, SyncStatus } from '../env'

const MIN_PASSPHRASE = 8

// Settings section: sync folder, passphrase, and sync state. Changes are shown live.
export function SyncSettings() {
  const [sync, setSync] = useState<SyncStatus | null>(null)
  // Folder picked while this device is not yet syncing.
  const [pick, setPick] = useState<{ folder: string } & SyncInspect | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => window.api.sync.status().then(setSync)
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])

  const reset = () => {
    setPassphrase('')
    setConfirm('')
    setError(null)
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const chooseFolder = () =>
    run(async () => {
      const folder = await window.api.sync.chooseFolder()
      if (!folder) return
      reset()
      setPick({ folder, ...(await window.api.sync.inspect(folder)) })
    })

  const join = (mode: 'push' | 'adopt') => {
    if (!pick) return
    if (pick.encrypted === false && passphrase.length < MIN_PASSPHRASE) return setError(`Passphrase needs at least ${MIN_PASSPHRASE} characters.`)
    if (pick.encrypted === false && passphrase !== confirm) return setError('Passphrases do not match.')
    if (mode === 'adopt' && !window.confirm("Replace this device's data with the data in the sync folder? Local data not yet in the folder is lost.")) return
    void run(async () => {
      setSync(await window.api.sync.join(pick.folder, mode, passphrase))
      setPick(null)
      reset()
    })
  }

  const unlock = () =>
    void run(async () => {
      setSync(await window.api.sync.unlock(passphrase))
      reset()
    })

  const turnOff = () =>
    void run(async () => {
      await window.api.sync.disable()
      setSync(await window.api.sync.status())
    })

  if (!sync) return null

  return (
    <section className="settings-section">
      <div className="settings-title">Sync across devices</div>

      {sync.enabled && sync.needsPassphrase ? (
        <>
          <p className="muted small">
            Sync to {sync.folder} is paused on this device. Enter the sync passphrase to resume.
          </p>
          <PassphraseField value={passphrase} onChange={setPassphrase} label="Passphrase" />
          <div className="token-row">
            <button className="btn" disabled={busy || passphrase.length === 0} onClick={unlock}>Unlock sync</button>
            <button className="btn ghost" disabled={busy} onClick={turnOff}>Turn off</button>
          </div>
        </>
      ) : sync.enabled ? (
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
            <button className="btn" disabled={busy} onClick={() => run(() => window.api.sync.now())}>Sync now</button>
            <button className="btn" disabled={busy} onClick={chooseFolder}>Change folder</button>
            <button className="btn ghost" disabled={busy} onClick={turnOff}>Turn off</button>
          </div>
        </>
      ) : pick ? (
        <>
          <p className="muted small">
            {pick.folder}
            {pick.devices > 0
              ? ` already holds data from ${pick.devices} other ${pick.devices === 1 ? 'device' : 'devices'}. Enter its passphrase.`
              : pick.encrypted
                ? ' is an encrypted sync folder. Enter its passphrase.'
                : ' is a new folder. Choose a passphrase for it.'}
          </p>
          <PassphraseField value={passphrase} onChange={setPassphrase} label="Passphrase" />
          {!pick.encrypted && (
            <PassphraseField value={confirm} onChange={setConfirm} label="Confirm passphrase" />
          )}
          {!pick.encrypted && (
            <p className="muted small">
              The folder is encrypted with this passphrase. Nothing else stores it. Lose it and the folder cannot be read.
            </p>
          )}
          <div className="token-row">
            {pick.devices > 0 ? (
              <>
                <button className="btn" disabled={busy || !passphrase} onClick={() => join('push')}>Merge this device in</button>
                <button className="btn ghost" disabled={busy || !passphrase} onClick={() => join('adopt')}>Replace with folder data</button>
              </>
            ) : (
              <button className="btn" disabled={busy || !passphrase} onClick={() => join('push')}>Start sync</button>
            )}
            <button className="btn ghost" disabled={busy} onClick={() => { setPick(null); reset() }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Keeps devices in step through a folder such as iCloud Drive. Changes are encrypted with a passphrase before they leave this device. Off by default.
          </p>
          <div className="token-row">
            <button className="btn" disabled={busy} onClick={chooseFolder}>Choose folder…</button>
          </div>
        </>
      )}

      {error && <p className="small sync-error">{error}</p>}
    </section>
  )
}

function PassphraseField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="settings-field">
      <span className="muted small">{label}</span>
      <input className="field-input" type="password" autoComplete="off" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}
