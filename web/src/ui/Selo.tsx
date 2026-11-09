import type { StatusInutilizacao, StatusNota, StatusParcela, StatusPedido } from '../tipos'

export type Tom = 'verde' | 'laranja' | 'vermelho' | 'azul' | 'cinza'

/** Selo de status em texto (com o ponto colorido do Argus Captura). Nada de emoji. */
export function Selo({ texto, tom = 'cinza', titulo }: { texto: string; tom?: Tom; titulo?: string }) {
  return <span className={`selo selo-st st-${tom}`} title={titulo}>{texto}</span>
}

export const STATUS_NOTA: Record<StatusNota, { texto: string; tom: Tom }> = {
  autorizada: { texto: 'Autorizada', tom: 'verde' },
  enviando: { texto: 'Enviando', tom: 'azul' },
  pendente: { texto: 'Pendente', tom: 'laranja' },
  rejeitada: { texto: 'Rejeitada', tom: 'vermelho' },
  denegada: { texto: 'Denegada', tom: 'vermelho' },
  cancelada: { texto: 'Cancelada', tom: 'cinza' },
  nao_enviada: { texto: 'Não enviada', tom: 'laranja' },
  falha_assinatura: { texto: 'Falha na assinatura', tom: 'vermelho' },
  inutilizada: { texto: 'Inutilizada', tom: 'cinza' },
}

export const STATUS_INUTILIZACAO: Record<StatusInutilizacao, { texto: string; tom: Tom }> = {
  homologada: { texto: 'Homologada', tom: 'verde' },
  enviando: { texto: 'Enviando', tom: 'azul' },
  sem_resposta: { texto: 'Sem resposta', tom: 'laranja' },
  rejeitada: { texto: 'Recusada', tom: 'vermelho' },
}

export function SeloNota({ status, motivo }: { status: StatusNota; motivo?: string | null }) {
  const s = STATUS_NOTA[status] ?? { texto: status, tom: 'cinza' as Tom }
  return <Selo texto={s.texto} tom={s.tom} titulo={motivo ?? undefined} />
}

export const STATUS_PEDIDO: Record<StatusPedido, { texto: string; tom: Tom }> = {
  aberto: { texto: 'Aberto', tom: 'azul' },
  faturado: { texto: 'Faturado', tom: 'verde' },
  cancelado: { texto: 'Cancelado', tom: 'cinza' },
}

export function SeloPedido({ status }: { status: StatusPedido }) {
  const s = STATUS_PEDIDO[status] ?? { texto: status, tom: 'cinza' as Tom }
  return <Selo texto={s.texto} tom={s.tom} />
}

export function SeloParcela({ status, vencida }: { status: StatusParcela; vencida: boolean }) {
  if (status === 'aberta' && vencida) return <Selo texto="Vencida" tom="vermelho" />
  if (status === 'aberta') return <Selo texto="Aberta" tom="laranja" />
  if (status === 'recebida') return <Selo texto="Recebida" tom="verde" />
  return <Selo texto="Cancelada" tom="cinza" />
}

export function SeloAmbiente({ ambiente }: { ambiente: 1 | 2 }) {
  return ambiente === 1 ? <Selo texto="Produção" tom="verde" /> : <Selo texto="Homologação" tom="laranja" />
}

/** Validade do certificado: vencido, perto de vencer (30 dias) ou em dia. */
export function SeloCertificado({ validade, dias }: { validade: string | null | undefined; dias?: number }) {
  if (!validade) return <Selo texto="Sem certificado" tom="vermelho" />
  const restantes = dias ?? Math.floor((new Date(validade).getTime() - Date.now()) / 86_400_000)
  if (!Number.isFinite(restantes)) return <Selo texto="Validade desconhecida" tom="cinza" />
  if (restantes < 0) return <Selo texto="Vencido" tom="vermelho" />
  if (restantes <= 30) return <Selo texto={`Vence em ${restantes} dia${restantes === 1 ? '' : 's'}`} tom="laranja" />
  return <Selo texto="Em dia" tom="verde" />
}
