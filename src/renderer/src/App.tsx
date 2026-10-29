import { useEffect, useRef, useState } from 'react'
import { isLive } from '@shared/live'
import logo from './assets/logo.png'
import { createIssue, useStore } from './store'
import { ICONS } from './components/icons'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { SpaceHome } from './components/SpaceHome'
import { IssueDetail } from './components/IssueDetail'
import { NewProjectModal } from './components/NewProjectModal'
import { NewSpaceModal } from './components/NewSpaceModal'
import { SettingsModal } from './components/SettingsModal'
import { ProjectSettings } from './components/ProjectSettings'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
import { PromptHost } from './components/ui'
import { NotificationsPanel } from './components/NotificationsPanel'
import { Wordmark } from './components/Wordmark'
import { IssuesView } from './views/IssuesView'
import { TriageView } from './views/TriageView'
import { BoardView } from './views/BoardView'
import { TableView } from './views/TableView'
import { TimelineView } from './views/TimelineView'
import { CyclesView } from './views/CyclesView'
import { WorkloadView } from './views/WorkloadView'
import { PlanningView } from './views/PlanningView'
import { ChartView } from './views/ChartView'
import { CalendarView } from './views/CalendarView'
import { ActivityView } from './views/ActivityView'
import { RoadmapView } from './views/RoadmapView'
import { DashboardView } from './views/DashboardView'
import { PROJECT_VIEWS, VIEW_LABEL, type Route, type ViewId } from './route'
import { clsx } from './util'

const PIN_KEY = 'prometheus.sidebarPinned'

function readPinned() {
  try {
    return localStorage.getItem(PIN_KEY) !== 'false'
  } catch {
    return true
  }
}

// Text fields keep their own native undo; app undo/redo only applies outside them.
const isEditable = (el: Element | null) => !!el?.closest('input, textarea, select, [contenteditable]')

export default function App() {
  const { data, dispatch, undo, redo, canUndo, canRedo } = useStore()
  // When the last app undo/redo ran from a keydown, so the Edit menu copy of the same press is skipped.
  const lastKeyUndo = useRef(0)
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
  const [projectSettings, setProjectSettings] = useState(false)
  const [palette, setPalette] = useState(false)

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

  // Global shortcuts: Cmd+K opens the command menu, c creates an issue in the current project.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(p => !p)
        return
      }
      const t = e.target as HTMLElement
      const typing = isEditable(t)
      // Undo/redo: Ctrl+Z, Shift+Ctrl+Z and Ctrl+Y on Windows/Linux. Text fields keep their own undo.
      // On macOS Cmd+Z and Shift+Cmd+Z come only from the Edit menu accelerators (onEditCommand below), so a
      // press can't run twice whichever of keydown or the menu sees it first.
      if (window.api.platform !== 'darwin' && e.ctrlKey && !e.altKey && !typing) {
        const k = e.key.toLowerCase()
        if (k === 'z' || k === 'y') {
          e.preventDefault()
          lastKeyUndo.current = Date.now()
          if (k === 'z' && !e.shiftKey) undo()
          else redo()
          return
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing) return
      if (e.key === 'c' && project && !openIssueId && !palette) {
        e.preventDefault()
        const issue = createIssue(data, project.id, 'New issue', { status: project.statuses[0].id })
        dispatch({ type: 'addIssue', issue })
        setOpenIssueId(issue.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, dispatch, undo, redo, project, openIssueId, palette])

  // Edit menu Undo/Redo. A keydown on the same press may already have run it, so ignore it when close behind.
  useEffect(() => window.api.onEditCommand(cmd => {
    if (Date.now() - lastKeyUndo.current < 300) return
    if (isEditable(document.activeElement)) document.execCommand(cmd)
    else if (cmd === 'undo') undo()
    else redo()
  }), [undo, redo])

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

    if (route.view === 'roadmap') {
      return <RoadmapView projects={spaceProjects} initiatives={data.initiatives.filter(i => i.spaceId === space.id)} />
    }
    if (route.view === 'dashboard') return <DashboardView space={space} onOpen={setOpenIssueId} />

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
        return <IssuesView project={project} onOpen={setOpenIssueId} />
      case 'triage':
        return <TriageView project={project} onOpen={setOpenIssueId} />
      case 'board':
        return <BoardView project={project} onOpen={setOpenIssueId} />
      case 'table':
        return <TableView project={project} onOpen={setOpenIssueId} />
      case 'timeline':
        return <TimelineView project={project} onOpen={setOpenIssueId} />
      case 'cycles':
        return <CyclesView project={project} onOpen={setOpenIssueId} />
      case 'workload':
        return <WorkloadView project={project} />
      case 'planning':
        return <PlanningView project={project} onOpen={setOpenIssueId} />
      case 'chart':
        return <ChartView project={project} />
      case 'calendar':
        return <CalendarView project={project} onOpen={setOpenIssueId} />
      case 'activity':
        return <ActivityView project={project} onOpen={setOpenIssueId} />
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
  if (route.view !== 'overview') crumbs.push(VIEW_LABEL[route.view as ViewId])
  const inProjectView = PROJECT_VIEWS.some(v => v.id === route.view)

  // Command menu entries: every project, view and space, plus creation and settings.
  const paletteItems: PaletteItem[] = [
    ...data.spaces.map(s => ({
      id: `space-${s.id}`,
      label: s.name,
      group: 'Space',
      run: () => navigate({ spaceId: s.id, projectId: null, view: 'overview' })
    })),
    ...data.projects.map(p => {
      const s = data.spaces.find(x => x.id === p.spaceId)
      return {
        id: `project-${p.id}`,
        label: p.name,
        group: 'Project',
        hint: s?.name,
        run: () => navigate({ spaceId: p.spaceId, projectId: p.id, view: 'issues' })
      }
    }),
    ...PROJECT_VIEWS.filter(() => !!project).map(v => ({
      id: `view-${v.id}`,
      label: `Go to ${v.label}`,
      group: 'View',
      hint: project?.name,
      run: () => navigate({ spaceId: project!.spaceId, projectId: project!.id, view: v.id })
    })),
    ...(project
      ? [
          {
            id: 'new-issue',
            label: 'New issue',
            group: 'Create',
            hint: project.name,
            run: () => {
              const issue = createIssue(data, project.id, 'New issue', { status: project.statuses[0].id })
              dispatch({ type: 'addIssue', issue })
              setOpenIssueId(issue.id)
            }
          },
          {
            id: 'project-settings',
            label: 'Project settings',
            group: 'Settings',
            hint: project.name,
            run: () => setProjectSettings(true)
          }
        ]
      : []),
    ...(canUndo ? [{ id: 'undo', label: 'Undo', group: 'Edit', hint: window.api.platform === 'darwin' ? '⌘Z' : 'Ctrl+Z', run: undo }] : []),
    ...(canRedo ? [{ id: 'redo', label: 'Redo', group: 'Edit', hint: window.api.platform === 'darwin' ? '⇧⌘Z' : 'Ctrl+Shift+Z', run: redo }] : []),
    { id: 'new-project', label: 'New project', group: 'Create', run: () => space && setProjectIn(space.id) },
    { id: 'new-space', label: 'New space', group: 'Create', run: () => setCreatingSpace(true) },
    { id: 'settings', label: 'App settings and MCP', group: 'Settings', run: () => setSettings(true) },
    { id: 'pin', label: pinned ? 'Collapse sidebar' : 'Pin sidebar', group: 'View', run: togglePin },
    ...data.issues.filter(isLive).map(i => {
      const p = data.projects.find(x => x.id === i.projectId)
      return {
        id: `issue-${i.id}`,
        label: i.title,
        group: 'Issue',
        hint: p ? `${p.key}-${i.number}` : undefined,
        run: () => setOpenIssueId(i.id)
      }
    })
  ]

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
            <button className="btn ghost" onClick={() => setPalette(true)} title="Command menu (⌘K)">
              {ICONS.search} <span className="muted small">⌘K</span>
            </button>
            <NotificationsPanel onOpen={setOpenIssueId} />
            {project && (
              <button className="icon-btn" onClick={() => setProjectSettings(true)} title="Project settings" aria-label="Project settings">
                {ICONS.settings}
              </button>
            )}
            {project && inProjectView && (
              <button className="btn ghost" onClick={deleteProject}>{ICONS.trash} Delete project</button>
            )}
          </header>

          <div className={clsx('content', route.view === 'dashboard' && 'wide')}>{renderBody()}</div>
        </main>
      </div>

      {openIssueId && (
        <IssueDetail key={openIssueId} issueId={openIssueId} onClose={() => setOpenIssueId(null)} onOpen={setOpenIssueId} />
      )}
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
      {projectSettings && project && <ProjectSettings key={project.id} project={project} onClose={() => setProjectSettings(false)} />}
      {palette && <CommandPalette items={paletteItems} onClose={() => setPalette(false)} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      <PromptHost />
    </div>
  )
}
