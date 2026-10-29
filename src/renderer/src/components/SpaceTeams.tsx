import { useState } from 'react'
import type { Space, Team } from '@shared/types'
import { DEFAULT_STATUSES } from '@shared/types'
import { canArchiveTeam, validTeamKey } from '@shared/teams'
import { useStore } from '../store'
import { ICONS } from './icons'
import { projectKey } from '../util'

// Teams in this space. A team owns the issue key, workflow statuses and cycle settings of its projects.
export function SpaceTeams({ space }: { space: Space }) {
  const { data, dispatch } = useStore()
  const teams = data.teams.filter(t => t.spaceId === space.id && !t.archivedAt)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState('')

  const create = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (!validTeamKey(data, key)) return setError(`Key ${key} is invalid or already used`)
    dispatch({
      type: 'addTeam',
      team: {
        id: crypto.randomUUID(),
        spaceId: space.id,
        name: trimmed,
        key,
        color: space.color,
        members: [],
        statuses: DEFAULT_STATUSES.map(s => ({ ...s })),
        nextNumber: 1,
        cycleLength: 14,
        autoCycles: false
      }
    })
    setName('')
    setKey('')
    setError('')
  }

  return (
    <section className="space-teams" data-testid="space-teams">
      <div className="section-title-row">
        <h2>Teams</h2>
      </div>
      {teams.map(t => (
        <TeamRow key={t.id} team={t} />
      ))}
      {teams.length === 0 && <p className="muted small">No teams yet.</p>}
      <div className="label-add">
        <input
          className="field-input"
          aria-label="New team name"
          placeholder="Team name"
          value={name}
          onChange={e => {
            setName(e.target.value)
            setKey(projectKey(e.target.value))
          }}
          onKeyDown={e => e.key === 'Enter' && create()}
        />
        <input className="field-input" aria-label="New team key" placeholder="KEY" value={key} onChange={e => setKey(e.target.value.toUpperCase())} />
        <button className="btn" onClick={create}>{ICONS.plus} New team</button>
      </div>
      {error && <div className="error small">{error}</div>}
    </section>
  )
}

function TeamRow({ team }: { team: Team }) {
  const { data, dispatch } = useStore()
  const [name, setName] = useState(team.name)
  const [key, setKey] = useState(team.key)
  const [members, setMembers] = useState(team.members.join(', '))
  const [keyError, setKeyError] = useState('')
  const projects = data.projects.filter(p => p.teamId === team.id)
  const canArchive = canArchiveTeam(data, team.id)

  const rename = () => {
    const next = name.trim()
    if (!next) return setName(team.name)
    if (next !== team.name) dispatch({ type: 'patchTeam', id: team.id, patch: { name: next } })
  }

  const changeKey = () => {
    if (key === team.key) return setKeyError('')
    if (!validTeamKey(data, key, team.id)) return setKeyError(`Key ${key} is invalid or already used`)
    if (!window.confirm('Changing the key affects new issues only. Existing issues keep their keys. Continue?')) return setKey(team.key)
    setKeyError('')
    dispatch({ type: 'patchTeam', id: team.id, patch: { key } })
  }

  const saveMembers = () => {
    const next = members.split(',').map(m => m.trim()).filter(Boolean)
    dispatch({ type: 'patchTeam', id: team.id, patch: { members: next } })
  }

  return (
    <div className="team-row" data-testid="team-row">
      <span className="dot" style={{ background: team.color }} />
      <input className="field-input" aria-label="Team name" value={name} onChange={e => setName(e.target.value)} onBlur={rename} />
      <input className="field-input" aria-label="Team key" value={key} onChange={e => setKey(e.target.value.toUpperCase())} onBlur={changeKey} />
      <input className="field-input" aria-label="Team members" placeholder="Members, comma separated" value={members} onChange={e => setMembers(e.target.value)} onBlur={saveMembers} />
      <span className="muted small">{team.members.length} members · {projects.map(p => p.name).join(', ') || 'No projects'}</span>
      <button
        className="btn danger ghost"
        disabled={!canArchive}
        title={canArchive ? undefined : 'Move its projects to another team first'}
        onClick={() => dispatch({ type: 'archiveTeam', id: team.id })}
      >
        Archive
      </button>
      {keyError && <div className="error small">{keyError}</div>}
    </div>
  )
}
