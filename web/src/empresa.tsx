import { useQuery } from '@tanstack/react-query'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { Empresa, EmpresaResumo } from './tipos'

const CHAVE = 'argus-emissor.empresa'

export function lerEmpresaGuardada(): number | null {
  try {
    const v = Number(localStorage.getItem(CHAVE))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export function guardarEmpresa(id: number) {
  try { localStorage.setItem(CHAVE, String(id)) } catch { /* sem armazenamento: só nesta visita */ }
}

/** Empresa a usar: a guardada, se o usuário ainda a enxerga; senão, a primeira da lista. */
export function escolherEmpresa(lista: EmpresaResumo[], guardada: number | null) {
  return lista.find((e) => e.id === guardada) ?? lista[0] ?? null
}

type Contexto = {
  lista: EmpresaResumo[]
  atual: EmpresaResumo | null
  eid: number | null
  definir: (id: number) => void
  carregando: boolean
  erro: Error | null
}

const Ctx = createContext<Contexto | null>(null)

export function useListaEmpresas() {
  return useQuery({ queryKey: ['empresas'], queryFn: () => api<EmpresaResumo[]>('/api/empresas'), staleTime: 60_000 })
}

/** Guarda a empresa selecionada no topo (localStorage) e a oferece às páginas. */
export function EmpresaProvider({ children }: { children: ReactNode }) {
  const q = useListaEmpresas()
  const [guardada, setGuardada] = useState<number | null>(lerEmpresaGuardada)
  const lista = useMemo(() => q.data ?? [], [q.data])
  const atual = escolherEmpresa(lista, guardada)

  useEffect(() => {
    if (atual && atual.id !== guardada) guardarEmpresa(atual.id)
  }, [atual, guardada])

  const definir = useCallback((id: number) => {
    guardarEmpresa(id)
    setGuardada(id)
  }, [])

  const valor: Contexto = {
    lista, atual, eid: atual?.id ?? null, definir, carregando: q.isPending, erro: q.error,
  }
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useEmpresa() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useEmpresa fora do EmpresaProvider')
  return c
}

/** Cadastro completo da empresa (`GET /api/empresas/:eid`): CSC, certificado, séries. */
export function useEmpresaDetalhe(eid: number | null) {
  return useQuery({
    queryKey: ['empresa', eid],
    queryFn: () => api<Empresa>(`/api/empresas/${eid}`),
    enabled: eid != null,
  })
}
