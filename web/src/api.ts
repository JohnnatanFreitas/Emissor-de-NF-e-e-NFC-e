import { MutationCache, QueryCache, QueryClient, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Acao, Eu } from './tipos'

export type { Acao, Eu } from './tipos'

/** O usuário pode fazer a ação? Vem da lista `acoes` do /api/eu, nunca do nome do papel. */
export function pode(eu: Pick<Eu, 'acoes'> | undefined | null, acao: Acao) {
  return !!eu?.acoes?.includes(acao)
}

/** Alguma das ações? (ex.: Produtos aparece para quem edita ou para quem vende). */
export function podeAlguma(eu: Pick<Eu, 'acoes'> | undefined | null, acoes: readonly Acao[]) {
  return acoes.some((a) => pode(eu, a))
}

/** Erro de uma chamada à API: `status` é o HTTP (0 = sem conexão) e `message` vem de `{erro}`. */
export class ErroApi extends Error {
  readonly status: number
  readonly corpo: unknown

  constructor(status: number, mensagem: string, corpo?: unknown) {
    super(mensagem)
    this.name = 'ErroApi'
    this.status = status
    this.corpo = corpo
  }
}

export const MSG_RESTRITO = 'Acesso restrito ao seu perfil'

/** Texto para mostrar ao usuário: a mensagem `{erro}` do servidor, nunca o JSON cru. */
export function mensagemErro(erro: unknown) {
  return erro instanceof ErroApi ? erro.message : erro instanceof Error ? erro.message : 'Erro inesperado'
}

const ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** fetch da API: cookie de sessão do mesmo site, cabeçalho anti-CSRF `X-Argus: 1` nas escritas e erros em ErroApi. */
export async function requisitar(caminho: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (ESCRITA.has(method)) headers.set('X-Argus', '1')
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let r: Response
  try {
    r = await fetch(caminho, { ...init, method, headers, credentials: 'same-origin' })
  } catch {
    throw new ErroApi(0, 'Não foi possível conectar ao servidor')
  }
  if (!r.ok) {
    let mensagem = `Erro ${r.status} no servidor`
    let corpo: unknown
    try {
      corpo = await r.json()
      if (corpo && typeof (corpo as { erro?: unknown }).erro === 'string') mensagem = (corpo as { erro: string }).erro
    } catch {
      // corpo sem JSON: fica a mensagem genérica
    }
    if (r.status === 403 && mensagem === `Erro 403 no servidor`) mensagem = MSG_RESTRITO
    throw new ErroApi(r.status, mensagem, corpo)
  }
  return r
}

/** requisitar() com o corpo já lido: JSON, texto ou undefined (204). */
export async function api<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const r = await requisitar(caminho, init)
  if (r.status === 204) return undefined as T
  const tipo = r.headers.get('Content-Type') ?? ''
  return (tipo.includes('application/json') ? r.json() : r.text()) as Promise<T>
}

/** Atalho para corpo JSON: `api(url, json('POST', {...}))`. */
export function json(method: string, corpo?: unknown): RequestInit {
  return corpo === undefined ? { method } : { method, body: JSON.stringify(corpo) }
}

/** Monta a query string sem os parâmetros vazios. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    p.set(k, v === true ? '1' : String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Caminho de uma rota da empresa: `/api/empresas/:eid/...`. */
export function rotaEmpresa(eid: number, resto = '') {
  return `/api/empresas/${eid}${resto ? (resto.startsWith('/') ? resto : `/${resto}`) : ''}`
}

export function eh401(erro: unknown) {
  return erro instanceof ErroApi && erro.status === 401
}

/** Cliente do TanStack Query: sem novas tentativas em erro 4xx e, se a sessão cair (401), revalida ['eu'] — o
 * useEu leva para /login. */
export function criarQueryClient() {
  const cliente: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (erro, query) => sessaoCaiu(erro, query.queryKey[0]) }),
    mutationCache: new MutationCache({ onError: (erro) => sessaoCaiu(erro) }),
    defaultOptions: {
      queries: {
        retry: (n, erro) => !(erro instanceof ErroApi && erro.status >= 400 && erro.status < 500) && n < 2,
        refetchOnWindowFocus: false,
      },
    },
  })
  function sessaoCaiu(erro: unknown, chave?: unknown) {
    if (eh401(erro) && chave !== 'eu') void cliente.invalidateQueries({ queryKey: ['eu'] })
  }
  return cliente
}

/** Usuário logado (`GET /api/eu`). Sem sessão (401), leva para /login. */
export function useEu() {
  const navegar = useNavigate()
  const q = useQuery({ queryKey: ['eu'], queryFn: () => api<Eu>('/api/eu'), staleTime: 5 * 60_000 })
  const semSessao = eh401(q.error)
  useEffect(() => {
    if (semSessao) navegar('/login', { replace: true })
  }, [semSessao, navegar])
  return q
}

/** Lê um arquivo como base64 puro (sem o prefixo `data:...;base64,`), para o certificado .pfx. */
export function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader()
    leitor.onload = () => {
      const r = String(leitor.result ?? '')
      ok(r.slice(r.indexOf(',') + 1))
    }
    leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo'))
    leitor.readAsDataURL(arquivo)
  })
}

/** Lê um arquivo de texto (XML). */
export function lerTexto(arquivo: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader()
    leitor.onload = () => ok(String(leitor.result ?? ''))
    leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo'))
    leitor.readAsText(arquivo)
  })
}
