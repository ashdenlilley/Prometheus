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
  | 'chart'
  | 'calendar'
  | 'roadmap'
  | 'dashboard'
  | 'activity'

export interface Route {
  spaceId: string | null
  projectId: string | null
  view: ViewId
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
  { id: 'chart', label: 'Charts' },
  { id: 'calendar', label: 'Calendar' },
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
  chart: 'Charts',
  calendar: 'Calendar',
  roadmap: 'Roadmap',
  dashboard: 'Dashboard',
  activity: 'Activity'
}
