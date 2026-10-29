// Saved-view helpers shared by the renderer's FilterBar and Sidebar. Pure so they can be tested without React.
import type { Project, SavedView } from './types'

export type ViewKind = SavedView['view']

// Sidebar view id that each saved-view kind opens. 'list' is the Issues page.
const KIND_VIEW_ID = { list: 'issues', board: 'board', table: 'table', chart: 'chart' } as const

export function viewIdFor(kind: ViewKind) {
  return KIND_VIEW_ID[kind]
}

// Projects are expected in sidebar order, so the result follows that order too.
export function favouriteViews(projects: Project[]): { project: Project; view: SavedView }[] {
  return projects.flatMap(project => project.views.filter(v => v.favourite).map(view => ({ project, view })))
}
