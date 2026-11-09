// Formato das notas para o front.

export function resumoNota(n) {
  return {
    id: n.id, modelo: n.modelo, serie: n.serie, numero: n.numero, chave: n.chave, status: n.status, ambiente: n.ambiente,
    destinatario: n.destinatario, total_cent: Number(n.total_cent), emitida_em: n.emitida_em, c_stat: n.c_stat,
    x_motivo: n.x_motivo, pedido_id: n.pedido_id,
  };
}

const PODE_REENVIAR = ["rejeitada", "nao_enviada", "falha_assinatura"];

export function notaCompleta(n, eventos = []) {
  const ccePermitida = n.modelo === "55" && n.status === "autorizada";
  return {
    ...resumoNota(n),
    protocolo: n.protocolo,
    natureza: n.natureza,
    totais: n.totais,
    itens: n.dados?.itens ?? [],
    pagamentos: n.dados?.pagamentos ?? [],
    duplicatas: n.dados?.duplicatas ?? [],
    autorizada_em: n.autorizada_em,
    cancelada_em: n.cancelada_em,
    eventos: eventos.map((e) => ({
      id: e.id, tipo: e.tipo, sequencia: e.sequencia, texto: e.texto, protocolo: e.protocolo, c_stat: e.c_stat,
      x_motivo: e.x_motivo, registrado: e.registrado, criado_em: e.criado_em,
    })),
    pode: {
      cancelar: n.status === "autorizada",
      cce: ccePermitida,
      reenviar: PODE_REENVIAR.includes(n.status),
      consultar: !!n.chave && n.status !== "enviando",
    },
  };
}
