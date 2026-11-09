import { describe, expect, it } from 'vitest'
import { escolherEmpresa } from './empresa'
import { contasBalcao } from './paginas/Balcao'
import { papeisPermitidos } from './paginas/Usuarios'
import { menuVisivel } from './rotas'
import type { Acao, EmpresaResumo } from './tipos'

const ACOES: Record<string, Acao[]> = {
  admin: ['gerir_usuarios', 'gerir_empresas', 'liberar_producao', 'editar_perfis', 'editar_produtos', 'editar_pessoas',
    'pedidos', 'emitir', 'cancelar_nota', 'estoque', 'financeiro'],
  vendedor: ['pedidos', 'emitir'],
  financeiro: ['financeiro'],
}

describe('menu por ações', () => {
  const rotulos = (a: Acao[]) => menuVisivel(a).map((i) => i.rotulo)
  it('admin vê tudo, com Configurações levando ao primeiro submenu', () => {
    const m = menuVisivel(ACOES.admin)
    expect(m.map((i) => i.rotulo)).toContain('Empresas da carteira')
    expect(m.find((i) => i.rotulo === 'Configurações')?.para).toBe('/configuracoes/empresa')
  })
  it('vendedor vê pedidos, balcão e notas; não vê estoque, receber nem empresas', () => {
    const r = rotulos(ACOES.vendedor)
    expect(r).toEqual(expect.arrayContaining(['Painel', 'Produtos', 'Pedidos e orçamentos', 'Venda balcão (NFC-e)', 'Notas fiscais']))
    expect(r).not.toContain('Estoque')
    expect(r).not.toContain('Contas a receber')
    expect(r).not.toContain('Empresas da carteira')
  })
  it('financeiro: Configurações só com Minha senha', () => {
    const m = menuVisivel(ACOES.financeiro)
    expect(m.map((i) => i.rotulo)).toContain('Contas a receber')
    expect(m.find((i) => i.rotulo === 'Configurações')?.subs.map((s) => s.rotulo)).toEqual(['Minha senha'])
  })
})

describe('empresa selecionada', () => {
  const e = (id: number) => ({ id }) as EmpresaResumo
  it('usa a guardada se ainda estiver na lista; senão a primeira', () => {
    expect(escolherEmpresa([e(1), e(2)], 2)?.id).toBe(2)
    expect(escolherEmpresa([e(1), e(2)], 9)?.id).toBe(1)
    expect(escolherEmpresa([], 1)).toBeNull()
  })
})

describe('venda balcão', () => {
  it('troco só sai do dinheiro', () => {
    const itens = [{ quantidade: 2, valor_cent: 1000 }]
    expect(contasBalcao(itens, [{ tPag: '01', valor_cent: 5000 }])).toMatchObject({ total: 2000, troco: 3000, falta: 0 })
    expect(contasBalcao(itens, [{ tPag: '17', valor_cent: 500 }])).toMatchObject({ falta: 1500, troco: 0 })
    expect(contasBalcao(itens, [{ tPag: '03', valor_cent: 3000 }]).excessoSemDinheiro).toBe(true)
  })
})

describe('usuários', () => {
  it('só admin oferece o papel Administrador', () => {
    expect(papeisPermitidos(true)).toContain('admin')
    expect(papeisPermitidos(false)).not.toContain('admin')
  })
})
