import { describe, expect, it } from 'vitest'
import { cardHabilitado, formasEmissao, montarCorpoEmissao, operacaoValida, validarEmissao } from './emissaoRapida'
import { codigoServicoValido, corpoServico, formDoCatalogo, formDoServico, montarPedidoNfse, nbsValido, validarNfse,
  validarServico } from './nfse'
import { menuVisivel } from './rotas'
import type { Operacao } from './tipos'

const OPS: Operacao[] = [
  { valor: 'venda', rotulo: 'Venda', descricao: '', natureza: 'VENDA', cobranca: true, modelos: ['55', '65'] },
  { valor: 'bonificacao', rotulo: 'Bonificação ou brinde', descricao: '', natureza: 'BONIF', cobranca: false, modelos: ['55'] },
  { valor: 'transferencia', rotulo: 'Transferência', descricao: '', natureza: 'TRANSF', cobranca: false, modelos: ['55'] },
]
const venda = OPS[0]
const bonif = OPS[1]

describe('emissão rápida: cards de operação', () => {
  it('habilita o card só se a operação aceita o modelo', () => {
    expect(cardHabilitado(venda, '65')).toBe(true)
    expect(cardHabilitado(bonif, '55')).toBe(true)
    expect(cardHabilitado(bonif, '65')).toBe(false)
  })
  it('ao trocar para NFC-e, operação só de NF-e volta para a venda', () => {
    expect(operacaoValida(OPS, 'bonificacao', '65')).toBe('venda')
    expect(operacaoValida(OPS, 'bonificacao', '55')).toBe('bonificacao')
    expect(operacaoValida(OPS, 'inexistente', '55')).toBe('venda')
  })
  it('formas de pagamento: sem "sem pagamento"; NFC-e sem boleto; dinheiro à vista', () => {
    expect(formasEmissao('55').map((f) => f.valor)).not.toContain('90')
    expect(formasEmissao('65').map((f) => f.valor)).not.toContain('15')
    expect(formasEmissao('55').find((f) => f.valor === '01')?.rotulo).toBe('Dinheiro à vista')
  })
})

describe('emissão rápida: corpo e validação', () => {
  const itens = [{ produto_id: 7, quantidade: 2, valor_unitario_cent: 1050 }]
  it('venda em NF-e leva cliente e pagamento com o total da nota', () => {
    const c = montarCorpoEmissao({ operacao: venda, modelo: '55', cliente_id: 3, itens, tPag: '17', total_cent: 2100, cpf: '123' })
    expect(c).toEqual({ operacao: 'venda', modelo: '55', cliente_id: 3, itens, pagamentos: [{ tPag: '17', valor_cent: 2100 }] })
  })
  it('bonificação sai sem pagamento', () => {
    const c = montarCorpoEmissao({ operacao: bonif, modelo: '55', cliente_id: 3, itens, tPag: '01', total_cent: 2100 })
    expect(c.pagamentos).toBeUndefined()
    expect(c.operacao).toBe('bonificacao')
  })
  it('NFC-e leva CPF só com dígitos e nome; nunca cliente_id', () => {
    const c = montarCorpoEmissao({ operacao: venda, modelo: '65', cliente_id: 3, cpf: '529.982.247-25', nome: ' Ana ', itens,
      tPag: '01', total_cent: 2100, observacao: '  obs ' })
    expect(c.cliente_id).toBeUndefined()
    expect(c.cpf).toBe('52998224725')
    expect(c.nome).toBe('Ana')
    expect(c.observacao).toBe('obs')
  })
  it('valida cliente na NF-e, CPF, itens, card fora do modelo e total para cobrança', () => {
    expect(validarEmissao({ operacao: venda, modelo: '55', itens, tPag: '01', total_cent: 2100 })).toContain('Escolha o cliente da NF-e')
    expect(validarEmissao({ operacao: venda, modelo: '65', cpf: '111.111.111-11', itens, tPag: '01', total_cent: 1 }))
      .toContain('CPF/CNPJ do consumidor inválido')
    expect(validarEmissao({ operacao: bonif, modelo: '65', itens, tPag: '01', total_cent: 1 })[0]).toMatch(/não pode ser emitida em NFC-e/)
    expect(validarEmissao({ operacao: venda, modelo: '55', cliente_id: 1, itens: [], tPag: '01', total_cent: 0 }))
      .toContain('Adicione pelo menos um produto')
    expect(validarEmissao({ operacao: venda, modelo: '55', cliente_id: 1, itens, tPag: '01', total_cent: undefined }))
      .toContain('Aguarde o cálculo do total para informar o pagamento')
    expect(validarEmissao({ operacao: bonif, modelo: '55', cliente_id: 1, itens, tPag: '01', total_cent: undefined })).toEqual([])
  })
})

describe('NFS-e: serviço', () => {
  it('código de tributação nacional com 6 dígitos e NBS opcional com 9', () => {
    expect(codigoServicoValido('01.07.01')).toBe(true)
    expect(codigoServicoValido('1071')).toBe(false)
    expect(nbsValido('')).toBe(true)
    expect(nbsValido('1.1503.10.00')).toBe(true)
    expect(nbsValido('12345')).toBe(false)
  })
  it('valida alíquota do ISS entre 0 e 5 e descrição', () => {
    const f = { ...formDoServico(), cod_trib_nac: '010701', item_lc116: '1.07', descricao: 'Suporte', aliq_iss: '5,5' }
    expect(validarServico(f).aliq_iss).toBeTruthy()
    expect(validarServico({ ...f, aliq_iss: '2' })).toEqual({})
    expect(validarServico({ ...f, descricao: 'x' }).descricao).toBeTruthy()
  })
  it('novo serviço nasce com ISS retido; catálogo preenche o formulário', () => {
    const f = formDoServico()
    expect(f.iss_retido).toBe(true)
    const g = formDoCatalogo({ cod_trib_nac: '010701', item_lc116: '1.07', descricao: 'Suporte técnico', nbs: '115021000', aliq_iss: 2.5 }, f)
    expect(corpoServico(g)).toEqual({ cod_trib_nac: '010701', item_lc116: '1.07', nbs: '115021000', descricao: 'Suporte técnico',
      aliq_iss: 2.5, iss_retido: true, ativo: true })
  })
})

describe('NFS-e: pedido', () => {
  const base = { servico_id: '4', tomador_id: 9, valor: '1.000,00', deducoes: '', desconto: '10,00', competencia: '2026-11-01',
    iss_retido: false, reter_inss: true, descricao: 'Consultoria em novembro' }
  it('monta o pedido em centavos, sem deduções zeradas', () => {
    expect(montarPedidoNfse(base)).toEqual({ servico_id: 4, tomador_id: 9, valor_servico_cent: 100000, desconto_incond_cent: 1000,
      competencia: '2026-11-01', iss_retido: false, reter_inss: true })
    expect(montarPedidoNfse({ ...base, tomador_id: null })).toBeNull()
    expect(montarPedidoNfse({ ...base, valor: '0' })).toBeNull()
  })
  it('valida competência futura e discriminação', () => {
    expect(validarNfse(base, '2026-11-09')).toEqual([])
    expect(validarNfse({ ...base, competencia: '2026-12-01' }, '2026-11-09')).toContain('A competência não pode estar no futuro')
    expect(validarNfse({ ...base, descricao: 'abc' }, '2026-11-09')[0]).toMatch(/Discriminação/)
  })
})

describe('menu: emissão rápida e NFS-e', () => {
  it('aparecem para quem emite, com os subitens da NFS-e', () => {
    const m = menuVisivel(['emitir'])
    expect(m.find((i) => i.rotulo === 'Emissão rápida')?.para).toBe('/emissao-rapida')
    const n = m.find((i) => i.rotulo === 'NFS-e (serviços)')
    expect(n?.para).toBe('/nfse')
    expect(n?.subs.map((s) => s.rotulo)).toEqual(['Notas de serviço', 'Emitir NFS-e', 'Serviços'])
    expect(n?.subs[0].ativo('/nfse/12')).toBe(true)
    expect(n?.subs[0].ativo('/nfse/nova')).toBe(false)
  })
  it('somem para o financeiro', () => {
    const r = menuVisivel(['financeiro']).map((i) => i.rotulo)
    expect(r).not.toContain('Emissão rápida')
    expect(r).not.toContain('NFS-e (serviços)')
  })
})
