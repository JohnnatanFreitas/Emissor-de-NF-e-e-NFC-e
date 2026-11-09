import { useEffect, useState } from 'react'

function casa(query: string) {
  try { return window.matchMedia?.(query)?.matches === true } catch { return false }
}

/** Acompanha uma media query; sem `matchMedia` (ou sem suporte a `change`), devolve false. */
export function useMedia(query: string): boolean {
  const [valor, setValor] = useState(() => casa(query))
  useEffect(() => {
    let lista: MediaQueryList | undefined
    try { lista = window.matchMedia?.(query) } catch { lista = undefined }
    if (!lista) { setValor(false); return }
    const atualizar = () => setValor(lista.matches === true)
    atualizar()
    lista.addEventListener?.('change', atualizar)
    return () => lista.removeEventListener?.('change', atualizar)
  }, [query])
  return valor
}
