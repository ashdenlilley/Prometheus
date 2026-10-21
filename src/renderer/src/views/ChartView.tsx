import { useState } from 'react'
import type { Project } from '@shared/types'
import { applyFilter, groupIssues } from '@shared/query'
import { useStore } from '../store'
import { FilterBar, useViewQuery } from '../components/FilterBar'

// Bar chart of issue counts (or estimate points) grouped by any field.
export function ChartView({ project }: { project: Project }) {
  const { data } = useStore()
  const query = useViewQuery(project, 'list')
  const [metric, setMetric] = useState<'count' | 'estimate'>('count')
  const issues = applyFilter(data.issues.filter(i => i.projectId === project.id && !i.triage), query.filter, project)
  const groups = groupIssues(
    issues,
    project,
    query.groupBy ?? 'status',
    id => data.cycles.find(c => c.id === id)?.name ?? '',
    id => project.milestones.find(m => m.id === id)?.name ?? ''
  ).map(g => ({
    label: g.label || 'All',
    color: g.color ?? '#5e6ad2',
    value: metric === 'count' ? g.items.length : g.items.reduce((s, i) => s + (i.estimate ?? 0), 0)
  }))
  const max = Math.max(1, ...groups.map(g => g.value))
  const total = groups.reduce((s, g) => s + g.value, 0)

  return (
    <div className="view">
      <div className="toolbar">
        <FilterBar project={project} kind="list" query={query} />
        <select className="input-sm" value={metric} onChange={e => setMetric(e.target.value as 'count' | 'estimate')}>
          <option value="count">Count of issues</option>
          <option value="estimate">Sum of estimates</option>
        </select>
        <span className="muted">Total {total}</span>
      </div>
      <div className="chart">
        {groups.map(g => (
          <div key={g.label} className="chart-col">
            <span className="muted small">{g.value}</span>
            <div className="chart-bar" style={{ height: `${(g.value / max) * 220}px`, background: g.color }} />
            <span className="small chart-label">{g.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
