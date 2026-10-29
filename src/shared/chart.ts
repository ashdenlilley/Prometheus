// Series maths for the Chart view's pie and line charts. Pure so it can be tested without the DOM.

export interface ChartGroup {
  label: string
  value: number
  color: string
}

export interface PieSlice extends ChartGroup {
  percent: number
  start: number
  end: number
}

export interface LinePoint extends ChartGroup {
  x: number
  y: number
}

const TAU = Math.PI * 2
// YYYY-MM-DD, YYYY-MM or YYYY-Www (ISO week)
const DATE_LABEL = /^\d{4}-(\d{2}(-\d{2})?|W\d{2})$/

// Angles in radians, starting at 12 o'clock and running clockwise. Zero and negative values get no slice.
export function pieSlices(groups: ChartGroup[]): PieSlice[] {
  const positive = groups.filter(g => g.value > 0)
  const total = positive.reduce((s, g) => s + g.value, 0)
  let angle = -Math.PI / 2
  return positive.map(g => {
    const start = angle
    angle += (g.value / total) * TAU
    return { ...g, percent: (g.value / total) * 100, start, end: angle }
  })
}

// Points are spaced evenly across the width and scaled to the largest value. Date-like labels are
// sorted chronologically; any other labels keep the order they were given.
export function linePoints(groups: ChartGroup[], width: number, height: number): LinePoint[] {
  const ordered = groups.every(g => DATE_LABEL.test(g.label))
    ? [...groups].sort((a, b) => (a.label < b.label ? -1 : 1))
    : groups
  const max = Math.max(1, ...ordered.map(g => g.value))
  return ordered.map((g, i) => ({
    ...g,
    x: ordered.length < 2 ? width / 2 : (i / (ordered.length - 1)) * width,
    y: height - (g.value / max) * height
  }))
}

// SVG path for a pie slice. A full circle cannot be one arc, so it is drawn as two half arcs.
export function svgArcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  if (end - start >= TAU - 1e-9) {
    const mid = start + Math.PI
    return `${svgArcPath(cx, cy, r, start, mid)} ${svgArcPath(cx, cy, r, mid, start + TAU)}`
  }
  const x1 = cx + r * Math.cos(start)
  const y1 = cy + r * Math.sin(start)
  const x2 = cx + r * Math.cos(end)
  const y2 = cy + r * Math.sin(end)
  const large = end - start > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}
