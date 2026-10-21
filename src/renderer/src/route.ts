// Where the user is: a space overview, or a view inside one of its projects.
export type ViewId = 'overview' | 'issues' | 'board' | 'table' | 'timeline' | 'cycles' | 'roadmap'

export interface Route {
  spaceId: string | null
  projectId: string | null
  view: ViewId
}

export const PROJECT_VIEWS: { id: ViewId; label: string }[] = [
  { id: 'issues', label: 'Issues' },
  { id: 'board', label: 'Board' },
  { id: 'table', label: 'Table' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'cycles', label: 'Cycles' }
]
