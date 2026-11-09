import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// findBy/waitFor com folga: com a máquina carregada (suíte inteira em paralelo) 1 s não basta.
configure({ asyncUtilTimeout: 3000 })

// Sem rede nos testes: qualquer fetch não simulado falha na hora.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    throw new Error(`fetch sem mock: ${String(url)}`)
  }))
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((media: string) => ({
      matches: false, media, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent: () => false,
    })),
  })
  delete document.documentElement.dataset.tema
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
