import { useState } from 'react'
import logo from './assets/logo.png'
import { useStore } from './store'
import { clsx } from './util'
import { ICONS } from './components/icons'
import { Wordmark } from './components/Wordmark'
import { IssueDetail } from './components/IssueDetail'
import { NewProjectModal } from './components/NewProjectModal'
import { IssuesView } from './views/IssuesView'
import { BoardView } from './views/BoardView'
import { TableView } from './views/TableView'
import { TimelineView } from './views/TimelineView'
import { CyclesView } from './views/CyclesView'
import { RoadmapView } from './views/RoadmapView'

const VIEWS = [
  { id: 'issues', label: 'Issues', icon: ICONS.issues },
  { id: 'board', label: 'Board', icon: ICONS.board },
  { id: 'table', label: 'Table', icon: ICONS.table },
  { id: 'timeline', label: 'Timeline', icon: ICONS.timeline },
  { id: 'cycles', label: 'Cycles', icon: ICONS.cycles },
  { id: 'roadmap', label: 'Roadmap', icon: ICONS.roadmap }
] as const

type ViewId = (typeof VIEWS)[number]['id']

export default function App() {
  const { data, dispatch } = useStore()
  const [view, setView] = useState<ViewId>('issues')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openIssueId, setOpenIssueId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const project = data.projects.find(p => p.id === selectedId) ?? data.projects[0]
  const current = VIEWS.find(v => v.id === view)!
  const projectScoped = view !== 'issues' && view !== 'roadmap'

  const deleteProject = () => {
    if (project && window.confirm(`Delete project "${project.name}" and all its issues?`)) {
      dispatch({ type: 'deleteProject', id: project.id })
    }
  }

  const renderBody = () => {
    if (!project) {
      return (
        <div className="empty">
          <img src={logo} alt="" className="empty-logo" />
          <Wordmark height={28} />
          <p>No projects yet</p>
          <button className="btn primary" onClick={() => setCreating(true)}>New project</button>
        </div>
      )
    }
    switch (view) {
      case 'issues':
        return <IssuesView projectId={project.id} onOpen={setOpenIssueId} />
      case 'board':
        return <BoardView projectId={project.id} onOpen={setOpenIssueId} />
      case 'table':
        return <TableView project={project} onOpen={setOpenIssueId} />
      case 'timeline':
        return <TimelineView project={project} onOpen={setOpenIssueId} />
      case 'cycles':
        return <CyclesView project={project} onOpen={setOpenIssueId} />
      case 'roadmap':
        return <RoadmapView />
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand drag">
          <img src={logo} alt="" className="brand-logo" />
          <Wordmark height={13} />
        </div>

        <div className="section-label">Views</div>
        <nav className="nav">
          {VIEWS.map(v => (
            <button key={v.id} className={clsx('nav-item', view === v.id && 'active')} onClick={() => setView(v.id)}>
              <span className="nav-icon">{v.icon}</span>
              {v.label}
            </button>
          ))}
        </nav>

        <div className="section-label">
          Projects
          <button className="icon-btn" title="New project" onClick={() => setCreating(true)}>{ICONS.plus}</button>
        </div>
        <nav className="nav">
          {data.projects.map(p => (
            <button
              key={p.id}
              className={clsx('nav-item', project?.id === p.id && 'active')}
              onClick={() => setSelectedId(p.id)}
            >
              <span className="project-chip" style={{ background: p.color }}>{p.key.slice(0, 2)}</span>
              {p.name}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar drag">
          <h1>
            {current.label}
            {project && projectScoped && <span className="muted"> · {project.name}</span>}
          </h1>
          {project && (
            <button className="btn ghost" onClick={deleteProject}>
              {ICONS.trash} Delete project
            </button>
          )}
        </header>
        <div className="content">{renderBody()}</div>
      </main>

      {openIssueId && <IssueDetail key={openIssueId} issueId={openIssueId} onClose={() => setOpenIssueId(null)} />}
      {creating && (
        <NewProjectModal
          onClose={() => setCreating(false)}
          onCreated={id => {
            setSelectedId(id)
            setView('board')
            setCreating(false)
          }}
        />
      )}
    </div>
  )
}
