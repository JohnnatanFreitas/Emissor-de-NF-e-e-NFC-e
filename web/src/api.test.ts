import { describe, expect, it } from 'vitest'
import { ErroApi, MSG_RESTRITO, api, json, mensagemErro, pode, podeAlguma, qs, rotaEmpresa } from './api'
import { chamadas, mockFetch } from './test/util'

describe('api()', () => {
  it('manda X-Argus: 1 só nas escritas, sempre com credentials same-origin', async () => {
    const f = mockFetch({
      'GET /api/x': { corpo: { ok: 1 } },
      'POST /api/x': { corpo: {} },
      'PUT /api/x': { corpo: {} },
      'PATCH /api/x': { corpo: {} },
      'DELETE /api/x': { status: 204 },
    })
    expect(await api('/api/x')).toEqual({ ok: 1 })
    for (const method of ['POST', 'put', 'PATCH', 'DELETE']) await api('/api/x', { method })
    const cs = chamadas(f)
    expect(cs.map((c) => [c.metodo, c.headers.get('X-Argus')])).toEqual([
      ['GET', null], ['POST', '1'], ['PUT', '1'], ['PATCH', '1'], ['DELETE', '1'],
    ])
    expect(cs.every((c) => c.credentials === 'same-origin')).toBe(true)
  })

  it('json() serializa o corpo e põe Content-Type', async () => {
    const f = mockFetch({ 'POST /api/sessao': { corpo: {} } })
    await api('/api/sessao', json('POST', { email: 'a@b.c', senha: 'x' }))
    const c = chamadas(f)[0]
    expect(c.headers.get('Content-Type')).toBe('application/json')
    expect(c.corpo).toEqual({ email: 'a@b.c', senha: 'x' })
  })

  it('lança ErroApi com status e a mensagem de {erro}', async () => {
    mockFetch({ 'POST /api/empresas/1/notas/2/cancelar': { status: 409, corpo: { erro: 'Nota já cancelada' } } })
    const e = await api('/api/empresas/1/notas/2/cancelar', json('POST', {})).catch((x: ErroApi) => x)
    expect(e).toBeInstanceOf(ErroApi)
    expect(e).toMatchObject({ status: 409, message: 'Nota já cancelada' })
    expect(mensagemErro(e)).toBe('Nota já cancelada')
  })

  it('403 sem corpo vira a mensagem de acesso restrito; sem rede, status 0', async () => {
    mockFetch({ 'GET /api/usuarios': { status: 403, corpo: null } })
    await expect(api('/api/usuarios')).rejects.toMatchObject({ status: 403, message: MSG_RESTRITO })
    mockFetch({})
    await expect(api('/api/eu')).rejects.toMatchObject({ status: 0 })
  })
})

describe('auxiliares', () => {
  it('pode() e podeAlguma() olham só a lista de ações', () => {
    const eu = { acoes: ['pedidos', 'emitir'] as const }
    expect(pode({ acoes: [...eu.acoes] }, 'emitir')).toBe(true)
    expect(pode({ acoes: [...eu.acoes] }, 'cancelar_nota')).toBe(false)
    expect(pode(undefined, 'emitir')).toBe(false)
    expect(podeAlguma({ acoes: ['financeiro'] }, ['editar_pessoas', 'financeiro'])).toBe(true)
  })

  it('qs() omite vazios e rotaEmpresa() monta o caminho', () => {
    expect(qs({ modelo: '55', status: '', busca: undefined, ativos: true })).toBe('?modelo=55&ativos=1')
    expect(qs({ a: '' })).toBe('')
    expect(rotaEmpresa(7, 'notas/3/danfe')).toBe('/api/empresas/7/notas/3/danfe')
    expect(rotaEmpresa(7)).toBe('/api/empresas/7')
  })
})
