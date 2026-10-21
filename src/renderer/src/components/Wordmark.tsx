import wordmarkDark from '../assets/wordmark-dark.png'
import wordmarkLight from '../assets/wordmark-light.png'

// Typed "PROMETHEUS" banner. Light glyphs in dark mode, dark glyphs in light mode.
export function Wordmark({ height = 14 }: { height?: number }) {
  return (
    <span className="wordmark" style={{ height }}>
      <img src={wordmarkLight} alt="Prometheus" className="wordmark-img on-dark" style={{ height }} />
      <img src={wordmarkDark} alt="" aria-hidden="true" className="wordmark-img on-light" style={{ height }} />
    </span>
  )
}
