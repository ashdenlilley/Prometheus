import { useState } from 'react'
import logo from './assets/logo.png'
import { useStore } from './store'
import { ICONS } from './components/icons'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { SpaceHome } from './components/SpaceHome'
import { IssueDetail } from './components/IssueDetail'
import { NewProjectModal } from './components/NewProjectModal'
import { NewSpaceModal } from './components/NewSpaceModal'
import { SettingsModal } from './components/SettingsModal'
import { Wordmark } from './components/Wordmark'
import { IssuesView } from './views/IssuesView'
import { BoardView } from './views/BoardView'
import { TableView } from './views/TableView'
import { TimelineView } from './views/TimelineView'
import { CyclesView } from './views/CyclesView'
import { RoadmapView } from './views/RoadmapView'
import { PROJECT_VIEWS, type Route, type ViewId } from './route'

const PIN_KEY = 'prometheus.sidebarPinned'

function readPinned() {
  try {
    return localStorage.getItem(PIN_KEY) !== 'false'
  } catch {
    return true
  }
}

const VIEW_LABEL: Record<ViewId, string> = {
  overview: 'Overview',
  roadmap: 'Roadmap',
  issues: 'Issues',
  board: 'Board',
  table: 'Table',
  timeline: 'Timeline',
  cycles: 'Cycles'
}

export default function App() {
  const { data, dispatch } = useStore()
  const [route, setRoute] = useState<Route>(() => ({
    spaceId: data.spaces[0]?.id ?? null,
    projectId: data.projects.find(p => p.spaceId === data.spaces[0]?.id)?.id ?? null,
    view: 'overview'
  }))
  const [pinned, setPinned] = useState(readPinned)
  const [openIssueId, setOpenIssueId] = useState<string | null>(null)
  const [projectIn, setProjectIn] = useState<string | null>(null)
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [settings, setSettings] = useState(false)

  const togglePin = () => {
    setPinned(p => {
      try {
        localStorage.setItem(PIN_KEY, String(!p))
      } catch {
        /* storage unavailable: pin state is per session only */
      }
      return !p
    })
  }

  // Resolve ids that may have been deleted since the route was set.
  const space = data.spaces.find(s => s.id === route.spaceId) ?? data.spaces[0]
  const project = data.projects.find(p => p.id === route.projectId && p.spaceId === space?.id)
  const spaceProjects = data.projects.filter(p => p.spaceId === space?.id)
  const navigate = (next: Route) => setRoute(next)

  const renderBody = () => {
    if (!space) {
      return (
        <div className="empty">
          <img src={logo} alt="" className="empty-logo" />
          <Wordmark height={28} />
          <p>No spaces yet</p>
          <button className="btn primary" onClick={() => setCreatingSpace(true)}>{ICONS.plus} New space</button>
        </div>
      )
    }

    if (route.view === 'roadmap') return <RoadmapView projects={spaceProjects} />

    if (!project || route.view === 'overview') {
      return (
        <SpaceHome
          space={space}
          onOpenProject={id => navigate({ spaceId: space.id, projectId: id, view: 'issues' })}
          onNewProject={() => setProjectIn(space.id)}
          onDeleted={() => {
            const next = data.spaces.find(s => s.id !== space.id)
            setRoute({ spaceId: next?.id ?? null, projectId: null, view: 'overview' })
          }}
        />
      )
    }

    switch (route.view) {
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
      default:
        return null
    }
  }

  const deleteProject = () => {
    if (project && window.confirm(`Delete project "${project.name}" and all its issues?`)) {
      dispatch({ type: 'deleteProject', id: project.id })
      setRoute({ spaceId: space?.id ?? null, projectId: null, view: 'overview' })
    }
  }

  const crumbs: string[] = [space?.name ?? '']
  if (project) crumbs.push(project.name)
  if (route.view !== 'overview') crumbs.push(VIEW_LABEL[route.view])
  const inProjectView = PROJECT_VIEWS.some(v => v.id === route.view)

  return (
    <div className="app">
      <TitleBar />
      <div className="body">
      <Sidebar
        route={route}
        pinned={pinned}
        onTogglePin={togglePin}
        onNavigate={navigate}
        onNewSpace={() => setCreatingSpace(true)}
        onNewProject={setProjectIn}
        onOpenSettings={() => setSettings(true)}
      />

      <main className="main">
        <header className="topbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={`${c}-${i}`} className={i === crumbs.length - 1 ? 'crumb current' : 'crumb'}>
                {i > 0 && <span className="crumb-sep">/</span>}
                {c}
              </span>
            ))}
          </nav>
          <div className="topbar-drag drag" />
          {project && inProjectView && (
            <button className="btn ghost" onClick={deleteProject}>{ICONS.trash} Delete project</button>
          )}
        </header>

        <div className="content">{renderBody()}</div>
      </main>

      </div>

      {openIssueId && <IssueDetail key={openIssueId} issueId={openIssueId} onClose={() => setOpenIssueId(null)} />}
      {projectIn && (
        <NewProjectModal
          spaceId={projectIn}
          onClose={() => setProjectIn(null)}
          onCreated={id => {
            navigate({ spaceId: projectIn, projectId: id, view: 'board' })
            setProjectIn(null)
          }}
        />
      )}
      {creatingSpace && (
        <NewSpaceModal
          onClose={() => setCreatingSpace(false)}
          onCreated={id => {
            navigate({ spaceId: id, projectId: null, view: 'overview' })
            setCreatingSpace(false)
          }}
        />
      )}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </div>
  )
}
