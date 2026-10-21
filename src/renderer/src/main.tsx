import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { StoreProvider } from './store'
import './styles.css'

// Platform class drives macOS-only chrome (translucent sidebar, traffic-light inset).
document.documentElement.classList.add(`platform-${window.api.platform === 'darwin' ? 'darwin' : 'other'}`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>
)
