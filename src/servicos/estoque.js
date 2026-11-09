// Movimento de estoque: atualiza saldo e custo médio do produto e grava o histórico.
import { invalido } from "../util.js";

/**
 * @param q  conexão (dentro de transação)
 * @param m  { empresa_id, produto_id, tipo, quantidade (com sinal), custo_unitario_cent?, nota_id?, entrada_id?, observacao?, usuario_id? }
 */
export async function movimentar(q, m) {
  const p = await q.one("SELECT id, estoque, custo_medio_cent FROM produtos WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [m.produto_id, m.empresa_id]);
  if (!p) throw invalido("Produto não encontrado.");
  const qtd = Number(m.quantidade);
  const saldoAntes = Number(p.estoque);
  const saldo = Math.round((saldoAntes + qtd) * 10000) / 10000;
  let custoMedio = Number(p.custo_medio_cent);
  const custo = m.custo_unitario_cent != null ? Number(m.custo_unitario_cent) : custoMedio;
  // Custo médio ponderado só muda em entrada com custo informado.
  if (qtd > 0 && m.custo_unitario_cent != null && ["entrada_manual", "entrada_xml", "inventario"].includes(m.tipo)) {
    const base = Math.max(saldoAntes, 0);
    custoMedio = base + qtd > 0 ? (base * custoMedio + qtd * custo) / (base + qtd) : custo;
  }
  await q.query("UPDATE produtos SET estoque = $1, custo_medio_cent = $2 WHERE id = $3", [saldo, Math.round(custoMedio * 10000) / 10000, p.id]);
  return q.one(
    `INSERT INTO estoque_movimentos (empresa_id, produto_id, tipo, quantidade, custo_unitario_cent, saldo_apos, nota_id, entrada_id, observacao, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [m.empresa_id, p.id, m.tipo, qtd, Math.round(custo * 10000) / 10000, saldo, m.nota_id ?? null, m.entrada_id ?? null, m.observacao ?? "", m.usuario_id ?? null]
  );
}
