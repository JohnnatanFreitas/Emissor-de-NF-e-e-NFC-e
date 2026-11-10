/** Regras puras das telas de NFS-e (validação do serviço e montagem do pedido). */
import { soDigitos, textoParaCentavos, textoParaNumero } from './formato'
import type { ItemCatalogoNfse, PedidoNfse, Servico, ServicoEntrada } from './tipos'

export type FormServico = {
  cod_trib_nac: string; item_lc116: string; nbs: string; descricao: string; aliq_iss: string; iss_retido: boolean; ativo: boolean
}
export type ErrosServico = Partial<Record<keyof FormServico, string>>

const pctTexto = (n: number | string) => String(Number(n)).replace('.', ',')

export function formDoServico(s?: Servico | null): FormServico {
  return {
    cod_trib_nac: s?.cod_trib_nac ?? '', item_lc116: s?.item_lc116 ?? '', nbs: s?.nbs ?? '', descricao: s?.descricao ?? '',
    aliq_iss: s ? pctTexto(s.aliq_iss) : '', iss_retido: s?.iss_retido ?? true, ativo: s?.ativo ?? true,
  }
}

/** Preenche o formulário com um item do catálogo (mantém ISS retido e ativo como estavam). */
export function formDoCatalogo(c: ItemCatalogoNfse, atual: FormServico): FormServico {
  return { ...atual, cod_trib_nac: c.cod_trib_nac, item_lc116: c.item_lc116, nbs: c.nbs ?? '', descricao: c.descricao,
    aliq_iss: pctTexto(c.aliq_iss) }
}

/** Código de tributação nacional: 6 dígitos (item, subitem e desdobramento da LC 116). */
export const codigoServicoValido = (v: string) => /^\d{6}$/.test(soDigitos(v))
/** NBS opcional: vazio ou 9 dígitos. */
export const nbsValido = (v: string) => { const d = soDigitos(v); return d === '' || d.length === 9 }

export function validarServico(f: FormServico): ErrosServico {
  const e: ErrosServico = {}
  if (!codigoServicoValido(f.cod_trib_nac)) e.cod_trib_nac = 'Código com 6 dígitos (item, subitem e desdobramento)'
  if (!f.item_lc116.trim()) e.item_lc116 = 'Informe o item da LC 116 (ex.: 1.07)'
  if (!nbsValido(f.nbs)) e.nbs = 'NBS com 9 dígitos, ou deixe vazio'
  if (f.descricao.trim().length < 3) e.descricao = 'Descreva o serviço'
  const aliq = textoParaNumero(f.aliq_iss)
  if (aliq == null || aliq < 0 || aliq > 5) e.aliq_iss = 'Alíquota do ISS entre 0% e 5%'
  return e
}

export function corpoServico(f: FormServico): ServicoEntrada {
  const nbs = soDigitos(f.nbs)
  return {
    cod_trib_nac: soDigitos(f.cod_trib_nac), item_lc116: f.item_lc116.trim(), ...(nbs ? { nbs } : {}),
    descricao: f.descricao.trim(), aliq_iss: textoParaNumero(f.aliq_iss) ?? 0, iss_retido: f.iss_retido, ativo: f.ativo,
  }
}

export type FormNfse = {
  servico_id: string; tomador_id: number | null; valor: string; deducoes: string; desconto: string; competencia: string
  iss_retido: boolean; reter_inss: boolean; descricao: string
}

/** Pedido do cálculo/emissão; null se ainda falta serviço, tomador ou valor. */
export function montarPedidoNfse(f: FormNfse): PedidoNfse | null {
  const valor = textoParaCentavos(f.valor)
  if (!f.servico_id || !f.tomador_id || valor == null || valor <= 0) return null
  const p: PedidoNfse = {
    servico_id: Number(f.servico_id), tomador_id: f.tomador_id, valor_servico_cent: valor,
    iss_retido: f.iss_retido, reter_inss: f.reter_inss,
  }
  const ded = textoParaCentavos(f.deducoes)
  if (ded) p.deducoes_cent = ded
  const desc = textoParaCentavos(f.desconto)
  if (desc) p.desconto_incond_cent = desc
  if (f.competencia) p.competencia = f.competencia
  return p
}

export function validarNfse(f: FormNfse, hoje: string): string[] {
  const e: string[] = []
  if (!f.servico_id) e.push('Escolha o serviço prestado')
  if (!f.tomador_id) e.push('Escolha o tomador do serviço')
  const valor = textoParaCentavos(f.valor)
  if (valor == null || valor <= 0) e.push('Informe o valor do serviço')
  for (const [t, r] of [[f.deducoes, 'Deduções'], [f.desconto, 'Desconto incondicionado']] as const) {
    const v = t.trim() ? textoParaCentavos(t) : 0
    if (v == null || v < 0) e.push(`${r}: valor inválido`)
  }
  if (f.competencia && f.competencia > hoje) e.push('A competência não pode estar no futuro')
  const n = f.descricao.trim().length
  if (n < 5 || n > 2000) e.push('Discriminação do serviço: de 5 a 2000 caracteres')
  return e
}
