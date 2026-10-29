// Where the user is: a space overview, or a view inside one of its projects.
export type ViewId =
  | 'overview'
  | 'issues'
  | 'triage'
  | 'board'
  | 'table'
  | 'files'
  | 'map'
  | 'timeline'
  | 'cycles'
  | 'workload'
  | 'planning'
  | 'chart'
  | 'calendar'
  | 'roadmap'
  | 'dashboard'
  | 'activity'
  | 'docs'

export interface Route {
  spaceId: string | null
  projectId: string | null
  view: ViewId
  // Open doc when view is 'docs'
  docId?: string | null
}

export const PROJECT_VIEWS: { id: ViewId; label: string }[] = [
  { id: 'issues', label: 'Issues' },
  { id: 'triage', label: 'Triage' },
  { id: 'board', label: 'Board' },
  { id: 'table', label: 'Table' },
  { id: 'files', label: 'Files' },
  { id: 'map', label: 'Map' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'cycles', label: 'Cycles' },
  { id: 'workload', label: 'Workload' },
  { id: 'planning', label: 'Planning' },
  { id: 'chart', label: 'Charts' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'docs', label: 'Docs' },
  { id: 'activity', label: 'Activity' }
]

export const VIEW_LABEL: Record<ViewId, string> = {
  overview: 'Overview',
  issues: 'Issues',
  triage: 'Triage',
  board: 'Board',
  table: 'Table',
  files: 'Files',
  map: 'Map',
  timeline: 'Timeline',
  cycles: 'Cycles',
  workload: 'Workload',
  planning: 'Planning',
  chart: 'Charts',
  calendar: 'Calendar',
  roadmap: 'Roadmap',
  dashboard: 'Dashboard',
  activity: 'Activity',
  docs: 'Docs'
}
