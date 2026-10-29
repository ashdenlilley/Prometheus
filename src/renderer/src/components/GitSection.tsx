import { useState } from 'react'
import type { Project, RepoRef } from '@shared/types'
import { parseRepo } from '@shared/git'
import { useStore } from '../store'
import { ICONS } from './icons'

const repoKey = (r: RepoRef) => `${r.owner}/${r.name}`.toLowerCase()

// Project settings > Git: linked repos, and the status moves when a PR opens or merges.
export function GitSection({ project }: { project: Project }) {
  const { dispatch } = useStore()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const repos = project.repos ?? []
  const auto = project.gitAutomation ?? {}

  const setRepos = (next: RepoRef[]) => dispatch({ type: 'setProjectRepos', projectId: project.id, repos: next })

  const linkRepo = () => {
    const repo = parseRepo(input)
    if (!repo) return setError('Use owner/name or a github.com URL.')
    if (repos.some(r => repoKey(r) === repoKey(repo))) return setError(`${repo.owner}/${repo.name} is already linked.`)
    setRepos([...repos, repo])
    setInput('')
    setError(null)
  }

  const setMove = (key: 'onOpen' | 'onMerge', status: string) =>
    dispatch({ type: 'setGitAutomation', projectId: project.id, automation: { ...auto, [key]: status || undefined } })

  const statusSelect = (key: 'onOpen' | 'onMerge', label: string) => (
    <label className="field">
      {label}
      <select className="field-input" value={auto[key] ?? ''} onChange={e => setMove(key, e.target.value)}>
        <option value="">Off</option>
        {project.statuses.map(s => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="settings-form">
      <p className="muted small">
        Issues are matched to PRs by their key (for example OS-12) in the branch name, PR title or description.
      </p>

      <div className="muted small">Linked repos</div>
      {repos.length === 0 && <p className="muted small">No repos linked yet.</p>}
      {repos.map(r => (
        <div key={repoKey(r)} className="option-row">
          <span className="grow">{r.owner}/{r.name}</span>
          <button className="icon-btn" aria-label={`Unlink ${r.owner}/${r.name}`} title="Unlink" onClick={() => setRepos(repos.filter(x => repoKey(x) !== repoKey(r)))}>
            {ICONS.close}
          </button>
        </div>
      ))}
      <div className="option-row">
        <input
          className="field-input grow"
          placeholder="owner/name or GitHub URL"
          value={input}
          onChange={e => {
            setInput(e.target.value)
            setError(null)
          }}
          onKeyDown={e => e.key === 'Enter' && linkRepo()}
        />
        <button className="btn" disabled={!input.trim()} onClick={linkRepo}>Link repo</button>
      </div>
      {error && <p className="git-error small">{error}</p>}

      <div className="muted small">Automations</div>
      {statusSelect('onOpen', 'When a PR opens (not draft), move to')}
      {statusSelect('onMerge', 'When a PR merges, move to')}
      <p className="muted small">Each move happens once per PR; moving the issue back by hand is kept.</p>
    </div>
  )
}
