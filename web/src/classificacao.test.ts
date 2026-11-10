import { describe, expect, it } from 'vitest'
import { ErroApi } from './api'
import { cfopDoDestino, classificacaoPadrao, limitesDoMes, mesAnterior, periodoBR, problemaDataEntrada, problemasClassificacao,
  trocarDestino } from './classificacao'
import { montarItens } from './paginas/EntradaXml'
import { chavePrevia, errosDoGerar } from './paginas/Sped'
import { menuVisivel } from './rotas'
import { type Classificacao, DESTINOS } from './tipos'

const base: Classificacao = { destino: 'revenda', cfop: '2102', cst_icms: '000', credito_icms: true, credito_ipi: false }

describe('CFOP de entrada ao trocar o destino', () => {
  it('mantém o 1º dígito e usa o final do destino', () => {
    expect(cfopDoDestino('2102', 'uso_consumo', DESTINOS, false)).toBe('2556')
    expect(cfopDoDestino('1102', 'industrializacao', DESTINOS, false)).toBe('1101')
    expect(cfopDoDestino('3102', 'ativo', DESTINOS, false)).toBe('3551')
  })
  it('item com ICMS-ST usa o final de ST', () => {
    expect(cfopDoDestino('1403', 'uso_consumo', DESTINOS, true)).toBe('1407')
    expect(cfopDoDestino('2102', 'revenda', DESTINOS, true)).toBe('2403')
    expect(cfopDoDestino('1102', 'outros', DESTINOS, true)).toBe('1949')
  })
  it('CFOP vazio ou inválido começa com 1', () => {
    expect(cfopDoDestino('', 'revenda', DESTINOS, false)).toBe('1102')
    expect(cfopDoDestino('5102', 'revenda', DESTINOS, false)).toBe('1102')
  })
  it('uso e consumo, ativo e outras tiram o crédito; revenda mantém', () => {
    expect(trocarDestino(base, 'uso_consumo', DESTINOS, false)).toMatchObject({ cfop: '2556', credito_icms: false })
    expect(trocarDestino({ ...base, credito_ipi: true }, 'ativo', DESTINOS, false).credito_ipi).toBe(false)
    expect(trocarDestino(base, 'industrializacao', DESTINOS, false)).toMatchObject({ cfop: '2101', credito_icms: true })
  })
  it('classificação padrão segue a UF pelo CFOP do fornecedor', () => {
    expect(classificacaoPadrao('6102').cfop).toBe('2102')
    expect(classificacaoPadrao('5405').cfop).toBe('1102')
  })
})

describe('validação da classificação', () => {
  it('aponta CFOP e CST inválidos', () => {
    const p = problemasClassificacao([
      { rotulo: 'Item 1', c: base },
      { rotulo: 'Item 2', c: { ...base, cfop: '5102', cst_icms: '00' } },
      { rotulo: 'Item 3', c: undefined },
    ])
    expect(p).toHaveLength(3)
    expect(p[0]).toMatch(/^Item 2: CFOP/)
    expect(p[1]).toMatch(/^Item 2: CST/)
    expect(p[2]).toMatch(/^Item 3/)
  })
})

describe('período do SPED', () => {
  it('padrão é o mês anterior', () => {
    expect(mesAnterior('2026-11-09')).toBe('2026-10')
    expect(mesAnterior('2027-01-15')).toBe('2026-12')
  })
  it('limites do mês e formato MM/AAAA', () => {
    expect(limitesDoMes('2026-02')).toEqual({ de: '2026-02-01', ate: '2026-02-28' })
    expect(limitesDoMes('2028-02').ate).toBe('2028-02-29')
    expect(periodoBR('2026-10')).toBe('10/2026')
  })
  it('menu: SPED Fiscal só com a ação sped; Classificar entradas dentro de Estoque', () => {
    const m = menuVisivel(['estoque', 'sped', 'financeiro'])
    const rotulos = m.map((i) => i.rotulo)
    expect(rotulos.indexOf('SPED Fiscal')).toBe(rotulos.indexOf('Contas a receber') + 1)
    expect(m.find((i) => i.rotulo === 'Estoque')?.subs.map((s) => s.rotulo)).toContain('Classificar entradas')
    expect(menuVisivel(['pedidos', 'emitir']).map((i) => i.rotulo)).not.toContain('SPED Fiscal')
  })
})

describe('entrada por XML com classificação', () => {
  const item = { indice: 1, codigo: 'A1', descricao: 'Copo', ncm: '39241000', ean: '', unidade: 'UN', quantidade: 2,
    valor_unitario_cent: 500, valor_cent: 1000, ipi_cent: 0, icms_st_cent: 0, frete_cent: 0, custo_total_cent: 1000,
    sugestao: { acao: 'criar' as const, produto_id: null, fator: 1 } }
  const ignorar = { acao: 'ignorar' as const, produto_id: '', fator: '1', codigo: '', descricao: '', unidade: '', preco: '', perfil_id: '' }
  it('item ignorado no estoque também leva a classificação', () => {
    const c = { ...base, destino: 'uso_consumo' as const, cfop: '1556', credito_icms: false }
    const r = montarItens([item], { 1: ignorar }, { 1: c })
    expect(r.problemas).toEqual([])
    expect(r.itens[0]).toMatchObject({ acao: 'ignorar', classificacao: { destino: 'uso_consumo', cfop: '1556' } })
  })
  it('data de entrada entre a emissão e hoje', () => {
    expect(problemaDataEntrada('2026-11-01', '2026-11-03T10:00:00-03:00', '2026-11-09')).toMatch(/anterior/)
    expect(problemaDataEntrada('2026-11-10', '2026-11-03', '2026-11-09')).toMatch(/futura/)
    expect(problemaDataEntrada('2026-11-05', '2026-11-03', '2026-11-09')).toBeNull()
  })
})

describe('SPED: prévia e geração', () => {
  it('a chave da prévia muda com período, perfil, finalidade e saldo', () => {
    const c = { periodo: '2026-10', perfil: 'B' as const, finalidade: '0' as const }
    expect(chavePrevia(c)).toBe(chavePrevia({ ...c }))
    expect(chavePrevia(c)).not.toBe(chavePrevia({ ...c, perfil: 'A' }))
    expect(chavePrevia(c)).not.toBe(chavePrevia({ ...c, saldo_credor_anterior_cent: 100 }))
  })
  it('lê os erros do 422 do gerar', () => {
    const e = new ErroApi(422, 'O SPED não foi gerado', { erro: 'x', erros: ['Sem IE'], alertas: [] })
    expect(errosDoGerar(e)).toEqual({ erros: ['Sem IE'], alertas: [] })
    expect(errosDoGerar(new ErroApi(500, 'falhou'))).toBeNull()
  })
})
