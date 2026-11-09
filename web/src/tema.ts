import { useState } from 'react'

export type Tema = 'claro' | 'escuro'

const CHAVE = 'argus-emissor.tema'

/** Define o tema da página inteira (as variáveis de tema.css dependem de `data-tema` na raiz). */
export function aplicarTema(t: Tema) {
  document.documentElement.dataset.tema = t
}

/** Preferência do sistema operacional, usada quando o usuário não escolheu tema. */
export function temaDoSistema(): Tema {
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'escuro' : 'claro'
}

/** Tema escolhido neste navegador (a API do Emissor não guarda preferência de tema); sem escolha: o do sistema. */
export function temaGuardado(): Tema {
  try {
    const t = localStorage.getItem(CHAVE)
    if (t === 'claro' || t === 'escuro') return t
  } catch {
    // sem armazenamento: vale o do sistema
  }
  return temaDoSistema()
}

/** Tema atual e a troca pelo botão sol/lua do topo; a escolha fica no localStorage. */
export function useTema() {
  const [tema, setTema] = useState<Tema>(temaGuardado)
  return {
    efetivo: tema,
    definir: (t: Tema) => {
      aplicarTema(t)
      setTema(t)
      try { localStorage.setItem(CHAVE, t) } catch { /* só nesta visita */ }
    },
  }
}
