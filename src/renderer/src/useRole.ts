import { useEffect, useState } from 'react'
import type { Role } from '@shared/permissions'

export { columnMode as colMode } from '@shared/permissions'

// The role this device has on the cloud workspace, re-read every 5 s so a change shows without a restart.
// Null for a local workspace (everything editable) or when signed out.
export function useRole(): Role | null {
  const [role, setRole] = useState<Role | null>(null)
  useEffect(() => {
    const load = () => window.api.cloud.status().then(s => setRole(s?.enabled ? s.role : null)).catch(() => setRole(null))
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])
  return role
}
