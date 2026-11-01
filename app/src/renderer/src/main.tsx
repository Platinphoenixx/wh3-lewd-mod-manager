import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Images show a loading placeholder (styles.css) until they have loaded or failed.
for (const type of ['load', 'error']) {
  document.addEventListener(type, (e) => {
    if (e.target instanceof HTMLImageElement) e.target.dataset.done = '1'
  }, true)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
