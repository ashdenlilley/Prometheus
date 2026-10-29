import { useState, type DragEvent } from 'react'
import type { Project, SavedView, Space } from '@shared/types'
import { favouriteViews, viewIdFor } from '@shared/views'
import { useStore } from '../store'
import { PROJECT_VIEWS, type Route, type ViewId } from '../route'
import { openSavedView } from './FilterBar'
import { askText } from './ui'
import { ICONS } from './icons'
import { clsx, uid } from '../util'

interface SidebarProps {
  route: Route
  pinned: boolean
  onTogglePin: () => void
  onNavigate: (route: Route) => void
  onNewSpace: () => void
  onNewProject: (spaceId: string) => void
  onOpenSettings: () => void
}

// Left rail. Unpinned: icon rail that widens on hover. Pinned: full width.
export function Sidebar(props: SidebarProps) {
  const { data } = useStore()
  const { route, pinned, onNavigate } = props
  const [collapsedSpaces, setCollapsedSpaces] = useState<Record<string, boolean>>({})

  const go = (spaceId: string, projectId: string | null, view: ViewId) => onNavigate({ spaceId, projectId, view })

  // Projects in the order the tree shows them, so favourites follow the same order.
  const orderedProjects = data.spaces.flatMap(s => data.projects.filter(pr => pr.spaceId === s.id))
  const favourites = favouriteViews(orderedProjects)
  const openFavourite = (project: Project, view: SavedView) => {
    openSavedView(project.id, view)
    go(project.spaceId, project.id, viewIdFor(view.view))
  }

  return (
    <div className={clsx('side-slot', pinned ? 'pinned' : 'unpinned')}>
      <aside className="sidebar">
        {favourites.length > 0 && (
          <>
            <div className="section-label">
              <span className="lbl">Favourites</span>
            </div>
            <nav className="tree">
              {favourites.map(({ project, view }) => (
                <button key={`${project.id}:${view.id}`} className="tree-row" onClick={() => openFavourite(project, view)}>
                  <span className="lbl grow ellipsis">{view.name}</span>
                  <span className="muted small ellipsis">{project.name}</span>
                </button>
              ))}
            </nav>
          </>
        )}

        <div className="section-label">
          <span className="lbl">Spaces</span>
          <button className="icon-btn" title="New space" aria-label="New space" onClick={props.onNewSpace}>
            {ICONS.plus}
          </button>
        </div>

        <nav className="tree">
          {data.spaces.map(space => (
            <SpaceNode
              key={space.id}
              space={space}
              open={!collapsedSpaces[space.id]}
              active={route.spaceId === space.id}
              route={route}
              onToggle={() => setCollapsedSpaces(c => ({ ...c, [space.id]: !c[space.id] }))}
              onOverview={() => go(space.id, null, 'overview')}
              onRoadmap={() => go(space.id, null, 'roadmap')}
              onDashboard={() => go(space.id, null, 'dashboard')}
              onProject={projectId => go(space.id, projectId, 'issues')}
              onView={view => go(space.id, route.projectId, view)}
              onNewProject={() => props.onNewProject(space.id)}
            />
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            className="nav-row"
            aria-pressed={pinned}
            onClick={props.onTogglePin}
            title={pinned ? 'Unpin: sidebar collapses to icons' : 'Pin: keep sidebar open'}
          >
            <span className={clsx('nav-icon', pinned && 'on')}>{ICONS.pin}</span>
            <span className="lbl grow">Pin sidebar</span>
            <span className={clsx('pin-state', pinned && 'on')} aria-hidden="true" />
          </button>
          <button className="nav-row" onClick={props.onOpenSettings} title="Settings">
            <span className="nav-icon">{ICONS.settings}</span>
            <span className="lbl grow">Settings</span>
          </button>
        </div>
      </aside>
    </div>
  )
}

interface SpaceNodeProps {
  space: Space
  open: boolean
  active: boolean
  route: Route
  onToggle: () => void
  onOverview: () => void
  onRoadmap: () => void
  onDashboard: () => void
  onProject: (projectId: string) => void
  onView: (view: ViewId) => void
  onNewProject: () => void
}

function SpaceNode(p: SpaceNodeProps) {
  const { data, dispatch } = useStore()
  const projects = data.projects.filter(pr => pr.spaceId === p.space.id)
  const folders = p.space.folders ?? []
  const rootProjects = projects.filter(pr => !folders.some(f => f.id === pr.folderId))
  const overviewActive = p.active && p.route.projectId === null && p.route.view !== 'roadmap' && p.route.view !== 'dashboard'

  // Drops only land on this space's folders and root. The reducer ignores folders from other spaces.
  const allowDrop = (e: DragEvent) => e.preventDefault()
  const dropProject = (e: DragEvent, folderId: string | null) => {
    e.preventDefault()
    const pr = projects.find(x => x.id === e.dataTransfer.getData('text/plain'))
    if (pr) dispatch({ type: 'moveProjectToFolder', projectId: pr.id, folderId })
  }
  const newFolder = async () => {
    const name = await askText('Folder name')
    if (name?.trim()) dispatch({ type: 'addFolder', spaceId: p.space.id, folder: { id: uid(), name: name.trim() } })
  }
  const renameFolder = async (f: { id: string; name: string }) => {
    const name = await askText('Folder name', f.name)
    if (name?.trim()) dispatch({ type: 'renameFolder', spaceId: p.space.id, folderId: f.id, name: name.trim() })
  }
  const deleteFolder = (f: { id: string; name: string }) => {
    if (!window.confirm(`Delete folder "${f.name}"? Its projects move to the space root.`)) return
    dispatch({ type: 'deleteFolder', spaceId: p.space.id, folderId: f.id })
  }

  const renderProject = (pr: Project) => {
    const selected = pr.id === p.route.projectId
    const triageCount = data.issues.filter(i => i.projectId === pr.id && i.triage && !i.archivedAt).length
    return (
      <div key={pr.id} className="project-block">
        <button
          className={clsx('tree-row sub', selected && 'active')}
          onClick={() => p.onProject(pr.id)}
          draggable
          onDragStart={e => e.dataTransfer.setData('text/plain', pr.id)}
        >
          <span className="project-chip" style={{ background: pr.color }}>{pr.key.slice(0, 2)}</span>
          <span className="lbl grow ellipsis">{pr.name}</span>
        </button>
        {selected &&
          PROJECT_VIEWS.map(v => (
            <button
              key={v.id}
              className={clsx('tree-row leaf', p.route.view === v.id && 'active')}
              onClick={() => p.onView(v.id)}
            >
              <span className="nav-icon">{ICONS[v.id as keyof typeof ICONS]}</span>
              <span className="lbl grow ellipsis">{v.label}</span>
              {v.id === 'triage' && triageCount > 0 && <span className="badge">{triageCount}</span>}
            </button>
          ))}
        {selected && folders.length > 0 && (
          <select
            className="field-input folder-move"
            aria-label={`Move ${pr.name} to folder`}
            value={pr.folderId ?? ''}
            onChange={e => dispatch({ type: 'moveProjectToFolder', projectId: pr.id, folderId: e.target.value || null })}
          >
            <option value="">No folder</option>
            {folders.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
      </div>
    )
  }

  return (
    <div className="tree-group">
      <div className={clsx('space-row', overviewActive && 'active')} onDragOver={allowDrop} onDrop={e => dropProject(e, null)}>
        <button
          className={clsx('caret-btn', p.open && 'open')}
          onClick={p.onToggle}
          aria-label={p.open ? 'Collapse space' : 'Expand space'}
          aria-expanded={p.open}
        >
          {ICONS.chevron}
        </button>
        <button className="space-hit" onClick={p.onOverview} title={`${p.space.name} overview`}>
          <span className="space-chip" style={{ background: p.space.color }}>{p.space.name.slice(0, 1).toUpperCase()}</span>
          <span className="lbl grow ellipsis">{p.space.name}</span>
        </button>
      </div>

      {p.open && (
        <div className="subtree">
          <button
            className={clsx('tree-row sub', p.active && p.route.projectId === null && p.route.view === 'roadmap' && 'active')}
            onClick={p.onRoadmap}
          >
            <span className="nav-icon">{ICONS.roadmap}</span>
            <span className="lbl grow ellipsis">Roadmap</span>
          </button>
          <button
            className={clsx('tree-row sub', p.active && p.route.projectId === null && p.route.view === 'dashboard' && 'active')}
            onClick={p.onDashboard}
          >
            <span className="nav-icon">{ICONS.dashboard}</span>
            <span className="lbl grow ellipsis">Dashboard</span>
          </button>

          {folders.map(f => {
            const open = !f.collapsed
            return (
              <div key={f.id} className="folder-group">
                <div className="tree-row sub folder-row" onDragOver={allowDrop} onDrop={e => dropProject(e, f.id)}>
                  <button
                    className={clsx('caret-btn', open && 'open')}
                    onClick={() => dispatch({ type: 'toggleFolder', spaceId: p.space.id, folderId: f.id })}
                    aria-label={`Toggle folder ${f.name}`}
                    aria-expanded={open}
                  >
                    {ICONS.chevron}
                  </button>
                  <span className="lbl grow ellipsis">{f.name}</span>
                  <button className="btn ghost small" aria-label={`Rename folder ${f.name}`} onClick={() => renameFolder(f)}>Rename</button>
                  <button className="btn ghost small" aria-label={`Delete folder ${f.name}`} onClick={() => deleteFolder(f)}>Delete</button>
                </div>
                {open && <div className="folder-body">{projects.filter(pr => pr.folderId === f.id).map(renderProject)}</div>}
              </div>
            )
          })}

          <div onDragOver={allowDrop} onDrop={e => dropProject(e, null)}>
            {rootProjects.map(renderProject)}
          </div>

          <button className="tree-row sub add" aria-label="New folder" onClick={newFolder}>
            <span className="nav-icon">{ICONS.plus}</span>
            <span className="lbl grow ellipsis">New folder</span>
          </button>
          <button className="tree-row sub add" onClick={p.onNewProject}>
            <span className="nav-icon">{ICONS.plus}</span>
            <span className="lbl grow ellipsis">New project</span>
          </button>
        </div>
      )}
    </div>
  )
}
