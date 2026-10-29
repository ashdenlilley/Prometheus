import { useState, type MouseEvent } from 'react'
import type { Issue, Project } from '@shared/types'
import { fitBounds, formatLocation, mercator, parseLocation, unmercator } from '@shared/location'
import { issueKey, useStore, withValue } from '../store'
import { clsx } from '../util'
import { colMode, useRole } from '../useRole'

const W = 1000
const H = 560
const TILE = 256

// Pins for the first Location column, drawn as an offline SVG. Tiles are optional and off unless a URL is set.
export function MapView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data, dispatch } = useStore()
  const role = useRole()
  const [colId, setColId] = useState('')
  const [placing, setPlacing] = useState<string | null>(null)
  const [tiles, setTiles] = useState(project.mapTiles ?? '')
  const locCols = project.columns.filter(c => c.type === 'location' && colMode(role, c) !== 'hidden')
  const col = locCols.find(c => c.id === colId) ?? locCols[0]
  if (!col) return <div className="view map-view"><div className="muted">Add a Location column to use the map</div></div>

  const issues = data.issues.filter(i => i.projectId === project.id && !i.archivedAt)
  const locOf = (i: Issue) => parseLocation(i.values[col.id])
  const coords = (i: Issue) => {
    const l = locOf(i)
    return l.lat !== undefined && l.lon !== undefined ? { lat: l.lat, lon: l.lon } : undefined
  }
  const pins = issues.flatMap(i => {
    const at = coords(i)
    return at ? [{ issue: i, at }] : []
  })
  const unplaced = issues.filter(i => !coords(i))

  // Viewport in world pixels at the fitted zoom; the SVG draws everything relative to its top-left corner.
  const { zoom, center } = fitBounds(pins.map(p => p.at), W, H)
  const size = TILE * 2 ** zoom
  const c = mercator(center.lat, center.lon)
  const left = c.x * size - W / 2
  const top = c.y * size - H / 2
  const px = (lat: number, lon: number) => {
    const m = mercator(lat, lon)
    return { x: m.x * size - left, y: m.y * size - top }
  }

  const n = 2 ** zoom
  const tileUrl = project.mapTiles
  const tileList: { tx: number; ty: number }[] = []
  for (let ty = Math.max(0, Math.floor(top / TILE)); ty <= Math.min(n - 1, Math.floor((top + H) / TILE)); ty++) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W) / TILE); tx++) tileList.push({ tx, ty })
  }

  // Graticule: finer lines as the zoom grows.
  const step = zoom >= 7 ? 1 : zoom >= 4 ? 5 : 10
  const nw = unmercator(left / size, top / size)
  const se = unmercator((left + W) / size, (top + H) / size)
  const lons: number[] = []
  for (let lon = Math.ceil(nw.lon / step) * step; lon <= se.lon; lon += step) lons.push(lon)
  const lats: number[] = []
  for (let lat = Math.min(85, Math.ceil(se.lat / step) * step); lat <= Math.min(85, nw.lat); lat += step) lats.push(lat)

  const placingIssue = issues.find(i => i.id === placing)
  const onMapClick = (e: MouseEvent<SVGSVGElement>) => {
    const issue = placingIssue
    if (!issue) return
    const r = e.currentTarget.getBoundingClientRect()
    // preserveAspectRatio centres the viewBox, so undo the scale and letterbox offset.
    const s = Math.min(r.width / W, r.height / H)
    const vx = (e.clientX - r.left - (r.width - W * s) / 2) / s + left
    const vy = (e.clientY - r.top - (r.height - H * s) / 2) / s + top
    const at = unmercator(vx / size, vy / size)
    dispatch({
      type: 'patchIssue',
      id: issue.id,
      patch: { values: withValue(issue.values, col.id, formatLocation(locOf(issue).address, at.lat, at.lon)) }
    })
    setPlacing(null)
  }

  const saveTiles = () => {
    const next = tiles.trim() || undefined
    if (next !== project.mapTiles) dispatch({ type: 'patchProject', id: project.id, patch: { mapTiles: next } })
  }

  return (
    <div className="view map-view">
      <div className="toolbar">
        {locCols.length > 1 && (
          <select className="field-input" aria-label="Location column" value={col.id} onChange={e => setColId(e.target.value)}>
            {locCols.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <span className="muted small">Tiles</span>
        <input
          className="field-input"
          aria-label="Map tile URL"
          placeholder="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          value={tiles}
          onChange={e => setTiles(e.target.value)}
          onBlur={saveTiles}
        />
        <span className="muted small">Off by default: tiles are fetched from that server.</span>
        {project.mapTiles?.includes('openstreetmap') && <span className="muted small">© OpenStreetMap contributors</span>}
        {placingIssue && <span className="muted small">Click the map to place {issueKey(data, placingIssue)}</span>}
      </div>
      <div className="map-layout">
        <svg
          className="map-svg"
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ cursor: placing ? 'crosshair' : undefined }}
          onClick={onMapClick}
        >
          {tileUrl && tileList.map(({ tx, ty }) => (
            <image
              key={`${tx}-${ty}`}
              href={tileUrl.replace('{z}', String(zoom)).replace('{x}', String(((tx % n) + n) % n)).replace('{y}', String(ty))}
              x={tx * TILE - left}
              y={ty * TILE - top}
              width={TILE}
              height={TILE}
              onError={e => (e.currentTarget.style.display = 'none')}
            />
          ))}
          {lons.map(lon => (
            <g key={`lon${lon}`}>
              <line className="map-grid" x1={px(0, lon).x} x2={px(0, lon).x} y1={0} y2={H} />
              <text className="map-label" x={px(0, lon).x + 3} y={H - 4}>{((((lon + 180) % 360) + 360) % 360) - 180}°</text>
            </g>
          ))}
          {lats.map(lat => (
            <g key={`lat${lat}`}>
              <line className="map-grid" x1={0} x2={W} y1={px(lat, 0).y} y2={px(lat, 0).y} />
              <text className="map-label" x={4} y={px(lat, 0).y - 3}>{lat}°</text>
            </g>
          ))}
          {pins.map(({ issue, at }) => {
            const p = px(at.lat, at.lon)
            return (
              <g
                key={issue.id}
                className="map-pin"
                role="button"
                aria-label={issueKey(data, issue)}
                onClick={e => {
                  e.stopPropagation()
                  onOpen(issue.id)
                }}
              >
                <circle cx={p.x} cy={p.y} r={7} />
                <text x={p.x + 10} y={p.y + 4}>{issueKey(data, issue)}</text>
              </g>
            )
          })}
        </svg>
        <aside className="map-side">
          <div className="muted small">Without coordinates ({unplaced.length})</div>
          {unplaced.map(i => (
            <div key={i.id} className="map-unplaced">
              <button className="link-btn ellipsis" onClick={() => onOpen(i.id)}>{issueKey(data, i)} {i.title}</button>
              <button
                className={clsx('btn subtle', placing === i.id && 'on')}
                aria-label={`Place ${issueKey(data, i)} on map`}
                onClick={() => setPlacing(placing === i.id ? null : i.id)}
              >
                {placing === i.id ? 'Cancel' : 'Place'}
              </button>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
