/** Regras puras da emissão simplificada (cards de operação + produtos cadastrados). */
import type { CorpoEmissaoRapida, Modelo, Operacao } from './tipos'
import { FORMAS_PAGAMENTO } from './tipos'
import { cnpjValido, cpfValido, soDigitos } from './formato'

/** O card fica habilitado só se a operação aceita o modelo escolhido (bonificação, transferência e outras: só NF-e). */
export function cardHabilitado(op: Pick<Operacao, 'modelos'>, modelo: Modelo) {
  return op.modelos.includes(modelo)
}

/** Ao trocar o modelo, mantém a operação se ela ainda vale; senão volta para a primeira habilitada (a venda). */
export function operacaoValida(ops: Operacao[], atual: string, modelo: Modelo) {
  const op = ops.find((o) => o.valor === atual)
  if (op && cardHabilitado(op, modelo)) return atual
  return ops.find((o) => cardHabilitado(o, modelo))?.valor ?? 'venda'
}

/** Formas de pagamento da emissão rápida: sem "Sem pagamento" (90); na NFC-e também sem boleto. */
export function formasEmissao(modelo: Modelo) {
  return FORMAS_PAGAMENTO
    .filter((f) => f.valor !== '90' && !(modelo === '65' && f.valor === '15'))
    .map((f) => (f.valor === '01' ? { ...f, rotulo: 'Dinheiro à vista' } : f))
}

export type LinhaEmissao = { produto_id: number; quantidade: number; valor_unitario_cent: number }

export type DadosEmissao = {
  operacao: Operacao | undefined; modelo: Modelo; cliente_id?: number | null; cpf?: string; nome?: string
  itens: LinhaEmissao[]; tPag: string; total_cent: number | null | undefined; observacao?: string
}

/** Itens com quantidade e preço válidos (os que vão para o cálculo e a emissão). */
export function itensValidos(itens: LinhaEmissao[]) {
  return itens.filter((i) => Number.isFinite(i.quantidade) && i.quantidade > 0
    && Number.isFinite(i.valor_unitario_cent) && i.valor_unitario_cent >= 0)
}

/** Mensagens que impedem a emissão (vazio = pode emitir). */
export function validarEmissao(d: DadosEmissao): string[] {
  const e: string[] = []
  if (!d.operacao) e.push('Escolha o tipo de operação')
  else if (!cardHabilitado(d.operacao, d.modelo)) e.push(`"${d.operacao.rotulo}" não pode ser emitida em ${d.modelo === '65' ? 'NFC-e' : 'NF-e'}`)
  if (d.modelo === '55' && !d.cliente_id) e.push('Escolha o cliente da NF-e')
  const doc = soDigitos(d.cpf)
  if (d.modelo === '65' && doc && !(doc.length === 11 ? cpfValido(doc) : doc.length === 14 && cnpjValido(doc))) {
    e.push('CPF/CNPJ do consumidor inválido')
  }
  if (d.itens.length === 0) e.push('Adicione pelo menos um produto')
  else if (itensValidos(d.itens).length !== d.itens.length) e.push('Confira quantidade e preço dos itens')
  if (d.operacao?.cobranca && !(Number(d.total_cent) > 0)) e.push('Aguarde o cálculo do total para informar o pagamento')
  return e
}

/** Corpo do POST /emissao-rapida. Pagamento só em operação com cobrança (valor = total da nota); NFC-e leva CPF/nome. */
export function montarCorpoEmissao(d: DadosEmissao): CorpoEmissaoRapida {
  const corpo: CorpoEmissaoRapida = {
    operacao: d.operacao?.valor ?? 'venda',
    modelo: d.modelo,
    itens: d.itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, valor_unitario_cent: i.valor_unitario_cent })),
  }
  if (d.modelo === '55') corpo.cliente_id = d.cliente_id ?? undefined
  else {
    const doc = soDigitos(d.cpf)
    if (doc) corpo.cpf = doc
    if (doc && d.nome?.trim()) corpo.nome = d.nome.trim()
  }
  if (d.operacao?.cobranca) corpo.pagamentos = [{ tPag: d.tPag || '01', valor_cent: Number(d.total_cent) }]
  const obs = d.observacao?.trim()
  if (obs) corpo.observacao = obs
  return corpo
}
