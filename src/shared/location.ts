// Location values stay plain strings so free text, filters, CSV/Excel export and sync keep working.
// Coordinates ride along as a suffix: "Sydney Opera House @ -33.8568, 151.2153". A bare "lat, lon" also parses.
// No geocoding here (no network). The map is drawn offline as SVG in Web Mercator.

export interface ParsedLocation {
  address: string
  lat?: number
  lon?: number
}

const NUM = '(-?\\d+(?:\\.\\d+)?)'
const SUFFIX = new RegExp(`^(.*?)\\s*@\\s*${NUM}\\s*,\\s*${NUM}$`)
const BARE = new RegExp(`^${NUM}\\s*,\\s*${NUM}$`)

const inRange = (lat: number, lon: number) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180

export function parseLocation(v: unknown): ParsedLocation {
  const s = typeof v === 'string' ? v.trim() : ''
  const m = SUFFIX.exec(s)
  const bare = m ? null : BARE.exec(s)
  const hit = m ?? bare
  if (hit) {
    const lat = Number(hit[m ? 2 : 1])
    const lon = Number(hit[m ? 3 : 2])
    if (inRange(lat, lon)) return { address: m ? m[1] : '', lat, lon }
  }
  return { address: s }
}

export function formatLocation(address: string, lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return address
  const coords = `${round(lat)}, ${round(lon)}`
  return address ? `${address} @ ${coords}` : coords
}

const round = (n: number) => Math.round(n * 1e5) / 1e5

// Web Mercator, both axes in 0..1 with (0,0) at the north-west corner. Latitude is clamped where Mercator stops being finite.
const MAX_LAT = 85.05113

export function mercator(lat: number, lon: number): { x: number; y: number } {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180
  return {
    x: (lon + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)
  }
}

export function unmercator(x: number, y: number): { lat: number; lon: number } {
  const lat = (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - Math.PI / 2) * (180 / Math.PI)
  return { lat, lon: x * 360 - 180 }
}

export interface Bounds {
  zoom: number
  center: { lat: number; lon: number }
}

// Largest integer zoom where every point fits inside a w x h viewport with a margin. One point uses zoom 12.
export function fitBounds(points: { lat: number; lon: number }[], w: number, h: number): Bounds {
  if (!points.length) return { zoom: 2, center: { lat: 0, lon: 0 } }
  const ps = points.map(p => mercator(p.lat, p.lon))
  if (ps.length === 1) return { zoom: 12, center: points[0] }
  const xs = ps.map(p => p.x)
  const ys = ps.map(p => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  let zoom = 1
  for (let z = 16; z >= 1; z--) {
    const size = 256 * 2 ** z
    if ((maxX - minX) * size <= w * 0.8 && (maxY - minY) * size <= h * 0.8) {
      zoom = z
      break
    }
  }
  const center = unmercator((minX + maxX) / 2, (minY + maxY) / 2)
  return { zoom, center }
}
