// Carrega produtos (com perfil fiscal) e clientes para o cálculo e a emissão.
import { calcularDocumento } from "../fiscal/calculo.js";
import { invalido, naoEncontrado } from "../util.js";

/** itens: [{ produto_id, quantidade, valor_unitario_cent?, desconto_cent? }] */
export async function carregarItens(q, empresaId, itens) {
  if (!Array.isArray(itens) || !itens.length) throw invalido("Adicione pelo menos um produto.");
  const ids = [...new Set(itens.map((i) => Number(i.produto_id)))];
  const linhas = await q.many(
    `SELECT p.*, row_to_json(f.*) AS perfil FROM produtos p JOIN perfis_fiscais f ON f.id = p.perfil_id
      WHERE p.empresa_id = $1 AND p.id = ANY($2::int[])`,
    [empresaId, ids]
  );
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return itens.map((i) => {
    const p = porId.get(Number(i.produto_id));
    if (!p) throw invalido(`Produto ${i.produto_id} não encontrado nesta empresa.`);
    const { perfil, ...produto } = p;
    // row_to_json devolve numeric como número já; garante tipos.
    for (const k of Object.keys(perfil)) if (/^(aliq|mva|reducao)/.test(k)) perfil[k] = Number(perfil[k]);
    const qtd = Number(i.quantidade);
    if (!(qtd > 0)) throw invalido(`Quantidade inválida para ${p.codigo}.`);
    return {
      produto,
      perfil,
      quantidade: qtd,
      valor_unitario_cent: i.valor_unitario_cent != null ? Math.round(Number(i.valor_unitario_cent)) : Number(p.preco_cent),
      desconto_cent: Math.round(Number(i.desconto_cent || 0)),
    };
  });
}

export async function carregarCliente(q, empresaId, clienteId) {
  if (!clienteId) return null;
  const c = await q.one("SELECT * FROM pessoas WHERE id = $1 AND empresa_id = $2", [Number(clienteId), empresaId]);
  if (!c) throw naoEncontrado("Cliente não encontrado.");
  return c;
}

export async function calcular(q, empresa, { modelo = "55", cliente_id, itens, operacao = "venda" }) {
  const cliente = await carregarCliente(q, empresa.id, cliente_id);
  const carregados = await carregarItens(q, empresa.id, itens);
  return { cliente, calculo: calcularDocumento({ empresa, cliente, modelo, itens: carregados, operacao }) };
}

/** Versão enxuta do item calculado para devolver ao front (sem campos internos). */
export function itemPublico(it) {
  const { difal, ...resto } = it;
  return resto;
}
