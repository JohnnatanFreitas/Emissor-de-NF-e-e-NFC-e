/** Regras da classificação fiscal das entradas (SPED) e do período do arquivo — lógica pura, sem tela. */
import { hojeISO } from './formato'
import type { Classificacao, Destino, DestinoOpcao } from './tipos'

/** Destinos que, por padrão, não dão crédito de ICMS/IPI no C170 (o servidor usa a mesma regra na sugestão). */
const SEM_CREDITO: Destino[] = ['uso_consumo', 'ativo', 'outros']

/**
 * CFOP de entrada sugerido para um destino: mantém o 1º dígito do CFOP atual (1 mesma UF, 2 outra UF, 3 exterior)
 * e troca os três últimos pelo final do destino (`cfop_final`, ou `cfop_final_st` quando o item veio com ICMS-ST).
 */
export function cfopDoDestino(cfopAtual: string, destino: Destino, destinos: DestinoOpcao[], comSt: boolean) {
  const d = destinos.find((x) => x.valor === destino)
  if (!d) return cfopAtual
  const atual = (cfopAtual ?? '').replace(/\D/g, '')
  const prefixo = /^[123]/.test(atual) ? atual[0] : '1'
  return prefixo + (comSt ? d.cfop_final_st : d.cfop_final)
}

/** Nova classificação ao trocar o destino: recalcula o CFOP e tira os créditos dos destinos que não creditam. */
export function trocarDestino(c: Classificacao, destino: Destino, destinos: DestinoOpcao[], comSt: boolean): Classificacao {
  const semCredito = SEM_CREDITO.includes(destino)
  return {
    ...c,
    destino,
    cfop: cfopDoDestino(c.cfop, destino, destinos, comSt),
    credito_icms: semCredito ? false : c.credito_icms,
    credito_ipi: semCredito ? false : c.credito_ipi,
  }
}

/** Classificação vazia, para item que chegou sem sugestão. */
export function classificacaoPadrao(cfopEmitente = ''): Classificacao {
  const d = String(cfopEmitente)[0]
  const prefixo = d === '6' || d === '2' ? '2' : d === '7' || d === '3' ? '3' : '1'
  return { destino: 'revenda', cfop: `${prefixo}102`, cst_icms: '', credito_icms: false, credito_ipi: false }
}

/** Confere CFOP (4 dígitos começando com 1, 2 ou 3) e CST (3 dígitos) de cada item; devolve os problemas. */
export function problemasClassificacao(itens: { rotulo: string; c: Classificacao | undefined }[]) {
  const problemas: string[] = []
  for (const { rotulo, c } of itens) {
    if (!c) { problemas.push(`${rotulo}: escolha o destino da mercadoria`); continue }
    if (!/^[123]\d{3}$/.test(c.cfop)) problemas.push(`${rotulo}: CFOP de entrada deve ter 4 dígitos e começar com 1, 2 ou 3`)
    if (!/^\d{3}$/.test(c.cst_icms)) problemas.push(`${rotulo}: CST do ICMS deve ter 3 dígitos (origem + CST)`)
  }
  return problemas
}

/** Data de entrada: não pode ser anterior à emissão nem futura. */
export function problemaDataEntrada(data: string, emitidaEm: string, hoje = hojeISO()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'Informe a data de entrada'
  if (data < emitidaEm.slice(0, 10)) return 'A data de entrada não pode ser anterior à emissão da nota'
  if (data > hoje) return 'A data de entrada não pode ser futura'
  return null
}

/** Só dígitos, até `n` (para CFOP e CST enquanto digita). */
export function digitos(v: string, n: number) {
  return v.replace(/\D/g, '').slice(0, n)
}

/** Mês anterior a uma data AAAA-MM-DD, em AAAA-MM (período padrão do SPED). */
export function mesAnterior(hoje: string) {
  const [a, m] = hoje.split('-').map(Number)
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

/** Primeiro e último dia de um período AAAA-MM. */
export function limitesDoMes(periodo: string) {
  const [a, m] = periodo.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { de: `${periodo}-01`, ate: `${periodo}-${String(ultimo).padStart(2, '0')}` }
}

/** AAAA-MM em "MM/AAAA". */
export function periodoBR(periodo: string | null | undefined) {
  const m = periodo ? /^(\d{4})-(\d{2})/.exec(periodo) : null
  return m ? `${m[2]}/${m[1]}` : '—'
}
