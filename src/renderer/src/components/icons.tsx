import type { ReactNode } from 'react'

// 16px stroked glyphs, drawn on the SF Symbols grid style.
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const ICONS = {
  issues: <Svg><circle cx="8" cy="8" r="5.75" strokeDasharray="2.5 2" /><path d="M8 5.5v2.5l1.5 1" /></Svg>,
  board: <Svg><rect x="2" y="3" width="3.5" height="10" rx="1" /><rect x="6.25" y="3" width="3.5" height="6.5" rx="1" /><rect x="10.5" y="3" width="3.5" height="8" rx="1" /></Svg>,
  files: <Svg><rect x="2.5" y="2.5" width="5" height="5" rx="1" /><rect x="8.5" y="2.5" width="5" height="5" rx="1" /><rect x="2.5" y="8.5" width="5" height="5" rx="1" /><rect x="8.5" y="8.5" width="5" height="5" rx="1" /></Svg>,
  map: <Svg><path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z" /><circle cx="8" cy="6.5" r="1.5" /></Svg>,
  table: <Svg><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M2 6.5h12M2 10h12M6.5 3v10" /></Svg>,
  timeline: <Svg><path d="M2.5 4.5h7M6 8h7.5M3.5 11.5h5" /></Svg>,
  cycles: <Svg><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M13.25 2.75v2.75H10.5" /></Svg>,
  workload: <Svg><path d="M2.5 13.5h11" /><path d="M4.5 11V8.5M8 11V5M11.5 11V3" /></Svg>,
  planning: <Svg><rect x="2.5" y="3" width="4.5" height="10.5" rx="1" /><rect x="9" y="3" width="4.5" height="6" rx="1" /></Svg>,
  roadmap: <Svg><path d="M3.5 13.5v-11" /><path d="M3.5 3h8l-1.75 2.5L11.5 8h-8" /></Svg>,
  plus: <Svg><path d="M8 3v10M3 8h10" /></Svg>,
  close: <Svg><path d="M4 4l8 8M12 4l-8 8" /></Svg>,
  more: <Svg><circle cx="3.5" cy="8" r="0.9" fill="currentColor" /><circle cx="8" cy="8" r="0.9" fill="currentColor" /><circle cx="12.5" cy="8" r="0.9" fill="currentColor" /></Svg>,
  trash: <Svg><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></Svg>,
  home: <Svg><path d="M2.5 7.25L8 2.75l5.5 4.5v5.75a.5.5 0 0 1-.5.5h-3.25v-3.5h-3.5v3.5H3a.5.5 0 0 1-.5-.5z" /></Svg>,
  pin: <Svg><path d="M5.25 2.25h5.5l-.75 3.5 1.75 2v1.25h-3.25v4.25L8 14.25l-.5-1.25V8.999H4.25V7.75L6 5.75z" /></Svg>,
  settings: <Svg><circle cx="8" cy="8" r="2.25" /><path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.4 3.4l1.05 1.05M11.55 11.55l1.05 1.05M3.4 12.6l1.05-1.05M11.55 4.45l1.05-1.05" /></Svg>,
  chevron: <Svg><path d="M6 4l4 4-4 4" /></Svg>,
  external: <Svg><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" /></Svg>,
  triage: <Svg><path d="M2.5 9.5l1.5-5h8l1.5 5v3h-11z" /><path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" /></Svg>,
  chart: <Svg><path d="M3 13.5h10.5" /><rect x="4" y="8" width="2" height="5" rx=".5" /><rect x="7.5" y="5" width="2" height="8" rx=".5" /><rect x="11" y="3" width="2" height="10" rx=".5" /></Svg>,
  calendar: <Svg><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" /></Svg>,
  activity: <Svg><path d="M1.75 8.5h2.75l1.75-4.5 3.25 8.5 1.75-4h3" /></Svg>,
  dashboard: <Svg><rect x="2.5" y="2.5" width="4.5" height="6" rx="1" /><rect x="9" y="2.5" width="4.5" height="3" rx="1" /><rect x="9" y="7.5" width="4.5" height="6" rx="1" /><rect x="2.5" y="10" width="4.5" height="3.5" rx="1" /></Svg>,
  bell: <Svg><path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3z" /><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" /></Svg>,
  search: <Svg><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25L13.5 13.5" /></Svg>
}
