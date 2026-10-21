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
  table: <Svg><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M2 6.5h12M2 10h12M6.5 3v10" /></Svg>,
  timeline: <Svg><path d="M2.5 4.5h7M6 8h7.5M3.5 11.5h5" /></Svg>,
  cycles: <Svg><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M13.25 2.75v2.75H10.5" /></Svg>,
  roadmap: <Svg><path d="M3.5 13.5v-11" /><path d="M3.5 3h8l-1.75 2.5L11.5 8h-8" /></Svg>,
  plus: <Svg><path d="M8 3v10M3 8h10" /></Svg>,
  close: <Svg><path d="M4 4l8 8M12 4l-8 8" /></Svg>,
  more: <Svg><circle cx="3.5" cy="8" r="0.9" fill="currentColor" /><circle cx="8" cy="8" r="0.9" fill="currentColor" /><circle cx="12.5" cy="8" r="0.9" fill="currentColor" /></Svg>,
  trash: <Svg><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></Svg>,
  external: <Svg><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" /></Svg>
}
