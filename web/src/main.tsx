import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter e Sora vão no build (sem CDN): só o subconjunto latino, que cobre o português.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/sora/latin-300.css'
import '@fontsource/sora/latin-600.css'
import './tema.css'
import './ui/ui.css'
import './emissor.css'
import App from './App'
import { aplicarTema, temaGuardado } from './tema'

aplicarTema(temaGuardado())

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
