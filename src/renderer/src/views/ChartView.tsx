import { useState } from 'react'
import type { Project } from '@shared/types'
import { applyFilter, groupIssues, withoutCompleted } from '@shared/query'
import { linePoints, pieSlices, svgArcPath } from '@shared/chart'
import { useStore } from '../store'
import { FilterBar, useViewQuery } from '../components/FilterBar'

// Bar, pie or line chart of issue counts (or estimate points) grouped by any field.
export function ChartView({ project }: { project: Project }) {
  const { data } = useStore()
  const query = useViewQuery(project, 'chart')
  const [metric, setMetric] = useState<'count' | 'estimate'>('count')
  const filtered = applyFilter(data.issues.filter(i => i.projectId === project.id && !i.triage && !i.archivedAt), query.filter, project)
  const issues = query.showCompleted ? filtered : withoutCompleted(filtered, project)
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
  const slices = pieSlices(groups)
  const points = linePoints(groups, 560, 200)

  return (
    <div className="view">
      <div className="toolbar">
        <FilterBar project={project} kind="chart" query={query} />
        <select className="input-sm" value={metric} onChange={e => setMetric(e.target.value as 'count' | 'estimate')}>
          <option value="count">Count of issues</option>
          <option value="estimate">Sum of estimates</option>
        </select>
        <select className="input-sm" aria-label="Chart type" value={query.chartType} onChange={e => query.setChartType(e.target.value as 'bar' | 'pie' | 'line')}>
          <option value="bar">Bar</option>
          <option value="pie">Pie</option>
          <option value="line">Line</option>
        </select>
        <span className="muted">Total {total}</span>
      </div>
      {query.chartType === 'bar' && (
        <div className="chart">
          {groups.map(g => (
            <div key={g.label} className="chart-col">
              <span className="muted small">{g.value}</span>
              <div className="chart-bar" style={{ height: `${(g.value / max) * 220}px`, background: g.color }} />
              <span className="small chart-label">{g.label}</span>
            </div>
          ))}
        </div>
      )}
      {query.chartType === 'pie' && (
        <div className="chart chart-pie">
          <svg className="chart-svg" viewBox="0 0 200 200" role="img" aria-label="Pie chart">
            {slices.map((s, i) => (
              <path key={i} d={svgArcPath(100, 100, 96, s.start, s.end)} fill={s.color}>
                <title>{`${s.label}: ${s.value} (${Math.round(s.percent)}%)`}</title>
              </path>
            ))}
          </svg>
          <ul className="chart-legend small">
            {slices.map((s, i) => (
              <li key={i}>
                <span className="chart-swatch" style={{ background: s.color }} />
                {s.label} · {s.value} · {Math.round(s.percent)}%
              </li>
            ))}
          </ul>
        </div>
      )}
      {query.chartType === 'line' && (
        <div className="chart chart-line">
          <svg className="chart-svg" viewBox="0 0 640 260" role="img" aria-label="Line chart">
            <g transform="translate(40 20)">
              <line x1="0" y1="200" x2="560" y2="200" className="chart-axis-line" />
              <text x="-6" y="4" textAnchor="end" className="chart-axis-text">{max}</text>
              <text x="-6" y="204" textAnchor="end" className="chart-axis-text">0</text>
              <polyline className="chart-line-path" fill="none" points={points.map(p => `${p.x},${p.y}`).join(' ')} />
              {points.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r="4" fill={p.color}>
                    <title>{`${p.label}: ${p.value}`}</title>
                  </circle>
                  <text x={p.x} y="222" textAnchor="middle" className="chart-axis-text">{p.label}</text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      )}
    </div>
  )
}
