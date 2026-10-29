import { createIssue } from './model'
import { addDays, todayISO } from './dates'
import { DEFAULT_STATUSES, type AppData, type Project } from './types'
import { ensureTeams } from './teams'

export const DEFAULT_SPACE_COLOR = '#5e6ad2'

export function blankProject(init: Pick<Project, 'id' | 'spaceId' | 'name' | 'key' | 'color'> & Partial<Project>): Project {
  return {
    teamId: '', // set by ensureTeams when the project is added
    status: 'planned',
    lead: '',
    members: [],
    statuses: DEFAULT_STATUSES.map(s => ({ ...s })),
    columns: [],
    widths: {},
    hiddenColumns: [],
    wipLimits: {},
    cycleLength: 14,
    autoCycles: false,
    milestones: [],
    updates: [],
    views: [],
    ...init
  }
}

export function emptyData(): AppData {
  return {
    version: 5,
    spaces: [],
    initiatives: [],
    projects: [],
    teams: [],
    issues: [],
    cycles: [],
    automations: [],
    triageRules: [],
    templates: [],
    dashboards: [],
    notifications: [],
    docs: [],
    me: 'You'
  }
}

// First-run content so the app is not empty.
export function seed(): AppData {
  const today = todayISO()
  const spaceId = crypto.randomUUID()
  const projectId = crypto.randomUUID()
  const estimate = crypto.randomUUID()
  const cycleId = crypto.randomUUID()
  // ensureTeams gives the project its team, so the sample issues take the team key
  const base: AppData = ensureTeams({
    ...emptyData(),
    spaces: [{ id: spaceId, name: 'Prometheus', color: DEFAULT_SPACE_COLOR }],
    projects: [
      blankProject({
        id: projectId,
        spaceId,
        name: 'Core app',
        key: 'PRM',
        color: '#5e6ad2',
        status: 'in_progress',
        startDate: today,
        targetDate: addDays(today, 60),
        columns: [{ id: estimate, name: 'Estimate', type: 'number' }]
      })
    ],
    cycles: [{ id: cycleId, projectId, name: 'Cycle 1', startDate: today, endDate: addDays(today, 13) }]
  })
  const samples: [string, string, number][] = [
    ['Set up project structure', 'done', 2],
    ['Build board view', 'in_progress', 5],
    ['Timeline bar resizing', 'todo', 3],
    ['Roadmap export', 'backlog', 8]
  ]
  return samples.reduce<AppData>(
    (data, [title, status, est], n) => ({
      ...data,
      issues: [
        ...data.issues,
        createIssue(data, projectId, title, {
          status,
          values: { [estimate]: est },
          cycleId: n < 3 ? cycleId : undefined,
          startDate: addDays(today, n),
          dueDate: addDays(today, n + 6),
          priority: n === 1 ? 1 : 0
        })
      ]
    }),
    base
  )
}
