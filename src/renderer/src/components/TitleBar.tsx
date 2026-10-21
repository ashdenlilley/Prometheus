import logo from '../assets/logo.png'
import { Wordmark } from './Wordmark'

// App banner across the top of the window. Hosts the macOS traffic lights (close, minimise, full screen)
// on the left. Empty apart from the banner, so the whole bar stays a window drag region.
export function TitleBar() {
  return (
    <header className="titlebar drag">
      <img src={logo} alt="" className="titlebar-logo" />
      <Wordmark height={11} />
    </header>
  )
}
