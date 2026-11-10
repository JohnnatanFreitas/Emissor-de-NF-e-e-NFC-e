// Classificação das notas de entrada para o SPED: guarda, sugere e lembra por fornecedor.
import { lerNfe } from "../sped/nfe-xml.js";
import { DESTINOS, sugerir, normalizarClassificacao } from "../sped/classificacao.js";
import { invalido, hojeISO } from "../util.js";

const industrial = (empresa) => (empresa.sped?.atividade ?? "1") === "0";

/** Lê o XML guardado da entrada (erro claro se estiver corrompido). */
export function xmlDaEntrada(entrada) {
  try {
    return lerNfe(entrada.xml);
  } catch (e) {
    throw invalido(`O XML da nota de entrada ${entrada.numero ?? entrada.id} não pôde ser lido: ${e.message}`);
  }
}

/** Sugestões para todos os itens de uma nota (usa o que foi lembrado do fornecedor). */
export async function sugestoes(q, empresa, nota, produtosPorItem = new Map()) {
  const cnpj = nota.emit?.cnpj || nota.emit?.cpf || "";
  const lembradas = await q.many("SELECT * FROM classificacao_lembrada WHERE empresa_id = $1 AND fornecedor_cnpj = $2", [empresa.id, cnpj]);
  const porCodigo = new Map(lembradas.map((l) => [l.codigo_fornecedor, l]));
  const out = new Map();
  for (const it of nota.itens) {
    const prod = produtosPorItem.get(it.num);
    out.set(it.num, sugerir(it, {
      ufEmitente: nota.emit?.uf, ufEmpresa: empresa.uf, industrial: industrial(empresa),
      lembrada: porCodigo.get(it.cProd), tipoItemProduto: prod?.tipo_item,
    }));
  }
  return out;
}

/** Cria a classificação sugerida para entradas lançadas antes do SPED existir (fica "a conferir"). */
export async function garantirItens(q, empresa, entrada) {
  const ja = await q.one("SELECT count(*)::int AS n FROM entrada_itens WHERE entrada_id = $1", [entrada.id]);
  if (ja.n > 0) return;
  const nota = xmlDaEntrada(entrada);
  // Produtos já vinculados a este fornecedor (o lançamento no estoque guardou o vínculo).
  const vinc = await q.many(
    `SELECT v.codigo_fornecedor, p.id, p.tipo_item FROM vinculos_fornecedor v JOIN produtos p ON p.id = v.produto_id
      WHERE v.empresa_id = $1 AND v.fornecedor_cnpj = $2`,
    [empresa.id, nota.emit?.cnpj || nota.emit?.cpf || ""]
  );
  const porCod = new Map(vinc.map((v) => [v.codigo_fornecedor, v]));
  const prodPorItem = new Map(nota.itens.map((it) => [it.num, porCod.get(it.cProd)]).filter(([, p]) => p));
  const sug = await sugestoes(q, empresa, nota, prodPorItem);
  for (const it of nota.itens) {
    const s = sug.get(it.num);
    await q.query(
      `INSERT INTO entrada_itens (entrada_id, num_item, produto_id, codigo_fornecedor, descricao, destino, cfop, cst_icms, credito_icms, credito_ipi)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [entrada.id, it.num, prodPorItem.get(it.num)?.id ?? null, it.cProd, it.xProd.slice(0, 255), s.destino, s.cfop, s.cst_icms, s.credito_icms, s.credito_ipi]
    );
  }
  if (!entrada.data_entrada) {
    await q.query("UPDATE entradas_xml SET data_entrada = coalesce(data_entrada, (criado_em AT TIME ZONE 'America/Sao_Paulo')::date) WHERE id = $1", [entrada.id]);
  }
}

export function validarDataEntrada(dataEntrada, nota) {
  const d = String(dataEntrada ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw invalido("Informe a data de entrada da mercadoria (AAAA-MM-DD).");
  if (nota.dt_emissao && d < nota.dt_emissao) throw invalido(`A data de entrada (${d}) não pode ser anterior à emissão da nota (${nota.dt_emissao}).`);
  if (d > hojeISO()) throw invalido("A data de entrada não pode estar no futuro.");
  return d;
}

/**
 * Grava a classificação de todos os itens (substitui a anterior) e lembra para as próximas notas.
 * itens: [{ num_item, destino, cfop, cst_icms, credito_icms, credito_ipi, produto_id? }]
 */
export async function salvarClassificacao(q, empresa, entrada, nota, { data_entrada, itens, conferida = true }) {
  const d = validarDataEntrada(data_entrada, nota);
  const porNum = new Map((itens ?? []).map((i) => [Number(i.num_item), i]));
  const atuais = new Map((await q.many("SELECT * FROM entrada_itens WHERE entrada_id = $1", [entrada.id])).map((r) => [r.num_item, r]));
  const cnpj = nota.emit?.cnpj || nota.emit?.cpf || "";
  for (const it of nota.itens) {
    const enviado = porNum.get(it.num);
    if (!enviado) throw invalido(`Classifique o item ${it.num} (${it.xProd.slice(0, 40)}).`);
    const c = normalizarClassificacao(enviado, it);
    const produtoId = enviado.produto_id !== undefined ? (Number(enviado.produto_id) || null) : atuais.get(it.num)?.produto_id ?? null;
    if (produtoId) {
      const p = await q.one("SELECT id FROM produtos WHERE id = $1 AND empresa_id = $2", [produtoId, empresa.id]);
      if (!p) throw invalido(`Produto do item ${it.num} não encontrado.`);
      // O destino escolhido define o tipo do item no 0200 do SPED.
      await q.query("UPDATE produtos SET tipo_item = $2 WHERE id = $1", [produtoId, DESTINOS[c.destino].tipo_item]);
    }
    await q.query(
      `INSERT INTO entrada_itens (entrada_id, num_item, produto_id, codigo_fornecedor, descricao, destino, cfop, cst_icms, credito_icms, credito_ipi)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (entrada_id, num_item) DO UPDATE SET produto_id = EXCLUDED.produto_id, destino = EXCLUDED.destino, cfop = EXCLUDED.cfop,
         cst_icms = EXCLUDED.cst_icms, credito_icms = EXCLUDED.credito_icms, credito_ipi = EXCLUDED.credito_ipi`,
      [entrada.id, it.num, produtoId, it.cProd, it.xProd.slice(0, 255), c.destino, c.cfop, c.cst_icms, c.credito_icms, c.credito_ipi]
    );
    if (conferida) {
      await q.query(
        `INSERT INTO classificacao_lembrada (empresa_id, fornecedor_cnpj, codigo_fornecedor, destino, cfop_final, credito_icms, credito_ipi)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (empresa_id, fornecedor_cnpj, codigo_fornecedor) DO UPDATE SET destino = EXCLUDED.destino, cfop_final = EXCLUDED.cfop_final,
           credito_icms = EXCLUDED.credito_icms, credito_ipi = EXCLUDED.credito_ipi`,
        [empresa.id, cnpj, it.cProd, c.destino, c.cfop.slice(1), c.credito_icms, c.credito_ipi]
      );
    }
  }
  await q.query("UPDATE entradas_xml SET data_entrada = $2, classificada = $3 WHERE id = $1", [entrada.id, d, conferida]);
}
