import { vi } from 'vitest'

export type Resposta = { status?: number; corpo?: unknown }
export type RotasFalsas = Record<string, Resposta | ((init: RequestInit) => Resposta)>

/** Troca o fetch global por respostas fixas, indexadas por "MÉTODO /caminho" (sem a query string). */
export function mockFetch(rotas: RotasFalsas) {
  const fn = vi.fn(async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(entrada)
    const metodo = (init.method ?? 'GET').toUpperCase()
    const r = rotas[`${metodo} ${url.split('?')[0]}`]
    if (!r) throw new Error(`fetch sem mock: ${metodo} ${url}`)
    const { status = 200, corpo } = typeof r === 'function' ? r(init) : r
    const vazio = status === 204
    return new Response(vazio ? null : JSON.stringify(corpo ?? null), {
      status, headers: vazio ? {} : { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Chamadas feitas ao fetch simulado, com método e cabeçalhos normalizados. */
export function chamadas(fn: ReturnType<typeof mockFetch>) {
  return fn.mock.calls.map(([entrada, init = {}]) => ({
    url: String(entrada),
    metodo: (init.method ?? 'GET').toUpperCase(),
    headers: new Headers(init.headers),
    credentials: init.credentials,
    corpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  }))
}
