import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './host/App'
import '@fontsource-variable/inter'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
