import type { Automation, Project } from './types'

// Ready-made automations. A recipe's blanks are filled in by the user; missing ones fall back to a default in build().
export type Blank = 'status' | 'priority' | 'label' | 'message' | 'project'

export interface Recipe {
  id: string
  sentence: string
  blanks: Blank[]
  build(project: Project, answers: Partial<Record<Blank, string>>): Pick<Automation, 'name' | 'trigger' | 'action'>
}

// The last completed status is the usual "done"; falls back to the last status
const doneStatus = (p: Project) => p.statuses.filter(s => s.category === 'completed').at(-1)?.id ?? p.statuses.at(-1)?.id ?? ''

export const RECIPES: Recipe[] = [
  {
    id: 'status-notify',
    sentence: 'When status becomes {status}, notify me with {message}',
    blanks: ['status', 'message'],
    build: (p, a) => ({
      name: 'Notify on status',
      trigger: { type: 'status_changed', to: a.status || doneStatus(p) },
      action: { type: 'notify', message: a.message || 'Status changed' }
    })
  },
  {
    id: 'due-urgent',
    sentence: 'When the due date passes, set priority to Urgent',
    blanks: [],
    build: () => ({
      name: 'Overdue to Urgent',
      trigger: { type: 'due_passed' },
      action: { type: 'set_priority', priority: 1 }
    })
  },
  {
    id: 'priority-cycle',
    sentence: 'When priority becomes {priority}, move it to the current cycle',
    blanks: ['priority'],
    build: (_p, a) => ({
      name: 'Move to current cycle',
      trigger: { type: 'priority_changed', to: Number(a.priority || 1) },
      action: { type: 'move_to_cycle' }
    })
  },
  {
    id: 'status-followup',
    sentence: 'When status becomes {status}, create a follow-up in {project}',
    blanks: ['status', 'project'],
    build: (p, a) => ({
      name: 'Follow-up on status',
      trigger: { type: 'status_changed', to: a.status || doneStatus(p) },
      action: { type: 'create_issue', title: 'Follow up', projectId: a.project || p.id }
    })
  },
  {
    id: 'status-label',
    sentence: 'When status becomes {status}, add label {label}',
    blanks: ['status', 'label'],
    build: (p, a) => ({
      name: 'Label on status',
      trigger: { type: 'status_changed', to: a.status || doneStatus(p) },
      action: { type: 'add_label', label: a.label || 'reviewed' }
    })
  },
  {
    id: 'cycle-end',
    sentence: 'When a cycle ends, notify me',
    blanks: [],
    build: () => ({
      name: 'Cycle ended',
      trigger: { type: 'cycle_ended' },
      action: { type: 'notify', message: 'Cycle ended' }
    })
  },
  {
    id: 'project-status',
    sentence: 'When the project status changes, notify me',
    blanks: [],
    build: () => ({
      name: 'Project status changed',
      trigger: { type: 'project_status_changed' },
      action: { type: 'notify', message: 'Project status changed' }
    })
  }
]

export function recipeAutomation(recipe: Recipe, project: Project, answers: Partial<Record<Blank, string>>, id: string): Automation {
  return { id, projectId: project.id, enabled: true, createdAt: new Date().toISOString(), ...recipe.build(project, answers) }
}
