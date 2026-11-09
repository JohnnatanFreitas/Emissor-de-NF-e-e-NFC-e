// Pedidos e orçamentos, venda balcão (NFC-e) e notas fiscais.
import { exigir, empresaDaRota } from "../acesso.js";
import { calcular, carregarCliente, itemPublico } from "../servicos/carregar.js";
import { emitirNota, consultarNota, reenviarNota, cancelarNota, cceNota } from "../servicos/emissao.js";
import { resumoNota, notaCompleta } from "../servicos/notas-vista.js";
import { inutilizarNumeracao, inutilizacaoPublica } from "../servicos/inutilizacao.js";
import { gerarDanfe } from "../nfe/danfe.js";
import { conflito, invalido, naoEncontrado, texto, hojeISO, somarDias } from "../util.js";

const FORMAS = ["01", "02", "03", "04", "05", "10", "11", "12", "13", "15", "16", "17", "18", "19", "90", "99"];

function normalizarPedido(d) {
  if (!["orcamento", "pedido"].includes(d.tipo ?? "pedido")) throw invalido("Tipo deve ser orçamento ou pedido.");
  const forma = String(d.forma_pagamento ?? "01").padStart(2, "0");
  if (!FORMAS.includes(forma)) throw invalido("Forma de pagamento inválida.");
  const parcelas = Math.max(1, Math.min(48, Number(d.parcelas || 1)));
  const intervalo = Math.max(1, Math.min(365, Number(d.intervalo_dias || 30)));
  if (d.primeiro_vencimento && !/^\d{4}-\d{2}-\d{2}$/.test(d.primeiro_vencimento)) throw invalido("Data do 1º vencimento inválida.");
  if (!Array.isArray(d.itens) || !d.itens.length) throw invalido("Adicione pelo menos um produto.");
  return {
    tipo: d.tipo ?? "pedido",
    cliente_id: Number(d.cliente_id),
    itens: d.itens.map((i) => ({
      produto_id: Number(i.produto_id),
      quantidade: Number(i.quantidade),
      valor_unitario_cent: Math.round(Number(i.valor_unitario_cent)),
      desconto_cent: Math.round(Number(i.desconto_cent || 0)),
    })),
    forma_pagamento: forma,
    parcelas,
    primeiro_vencimento: d.primeiro_vencimento || null,
    intervalo_dias: intervalo,
    observacoes: texto(d.observacoes, 2000),
  };
}

/** Parcelas: boleto (15) ou mais de uma parcela geram duplicatas com vencimentos. */
export function montarDuplicatas(p, totalCent) {
  if (p.forma_pagamento !== "15" && p.parcelas <= 1) return [];
  const n = p.parcelas;
  const primeiro = p.primeiro_vencimento || somarDias(hojeISO(), p.intervalo_dias);
  const base = Math.floor(totalCent / n);
  return Array.from({ length: n }, (_, i) => ({
    numero: String(i + 1).padStart(3, "0"),
    vencimento: somarDias(primeiro, i * p.intervalo_dias),
    valor_cent: base + (i === 0 ? totalCent - base * n : 0),
  }));
}

async function pedidoCompleto(q, empresa, id) {
  const p = await q.one(
    `SELECT pe.*, c.nome AS cliente_nome, n.numero AS nota_numero FROM pedidos pe
       JOIN pessoas c ON c.id = pe.cliente_id LEFT JOIN notas n ON n.id = pe.nota_id
      WHERE pe.id = $1 AND pe.empresa_id = $2`,
    [id, empresa.id]
  );
  if (!p) throw naoEncontrado("Pedido não encontrado.");
  const itens = await q.many(
    `SELECT i.id, i.produto_id, i.quantidade, i.valor_unitario_cent, i.desconto_cent, pr.codigo, pr.descricao, pr.unidade
       FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id WHERE i.pedido_id = $1 ORDER BY i.id`,
    [id]
  );
  const { calculo } = await calcular(q, empresa, { modelo: "55", cliente_id: p.cliente_id, itens });
  return { ...p, itens, calculo: { ...calculo, itens: calculo.itens.map(itemPublico) } };
}

export async function rotasVendas(api, { db, config }) {
  // ---- Pedidos ----
  api.get("/empresas/:eid/pedidos", async (req) => {
    const e = await empresaDaRota(req, db);
    const params = [e.id];
    let where = "pe.empresa_id = $1";
    if (["aberto", "faturado", "cancelado"].includes(req.query.status)) where += ` AND pe.status = $${params.push(req.query.status)}`;
    if (["orcamento", "pedido"].includes(req.query.tipo)) where += ` AND pe.tipo = $${params.push(req.query.tipo)}`;
    const busca = texto(req.query.busca, 80);
    if (busca) where += ` AND (c.nome ILIKE $${params.push(`%${busca}%`)} OR pe.numero::text = $${params.push(busca)})`;
    return db.many(
      `SELECT pe.id, pe.numero, pe.tipo, pe.status, c.nome AS cliente_nome, pe.total_cent, pe.criado_em, pe.nota_id, n.numero AS nota_numero
         FROM pedidos pe JOIN pessoas c ON c.id = pe.cliente_id LEFT JOIN notas n ON n.id = pe.nota_id
        WHERE ${where} ORDER BY pe.id DESC LIMIT 300`,
      params
    );
  });

  api.get("/empresas/:eid/pedidos/:id", async (req) => pedidoCompleto(db, await empresaDaRota(req, db), Number(req.params.id)));

  async function salvar(req, id) {
    exigir(req, "pedidos");
    const e = await empresaDaRota(req, db);
    const p = normalizarPedido(req.body ?? {});
    const cliente = await carregarCliente(db, e.id, p.cliente_id);
    if (!cliente) throw invalido("Escolha o cliente.");
    const { calculo } = await calcular(db, e, { modelo: "55", cliente_id: p.cliente_id, itens: p.itens });
    const pedidoId = await db.tx(async (q) => {
      let pid = id;
      const valores = [p.tipo, p.cliente_id, p.forma_pagamento, p.parcelas, p.primeiro_vencimento, p.intervalo_dias, p.observacoes, calculo.totais.total_cent];
      if (!pid) {
        const emp = await q.one("SELECT proximo_pedido FROM empresas WHERE id = $1 FOR UPDATE", [e.id]);
        const r = await q.one(
          `INSERT INTO pedidos (empresa_id, numero, vendedor_id, tipo, cliente_id, forma_pagamento, parcelas, primeiro_vencimento, intervalo_dias, observacoes, total_cent)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [e.id, emp.proximo_pedido, req.usuario.id, ...valores]
        );
        await q.query("UPDATE empresas SET proximo_pedido = proximo_pedido + 1 WHERE id = $1", [e.id]);
        pid = r.id;
      } else {
        const atual = await q.one("SELECT status FROM pedidos WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [pid, e.id]);
        if (!atual) throw naoEncontrado("Pedido não encontrado.");
        if (atual.status !== "aberto") throw conflito("Só pedido em aberto pode ser alterado.");
        await q.query(
          `UPDATE pedidos SET tipo=$2, cliente_id=$3, forma_pagamento=$4, parcelas=$5, primeiro_vencimento=$6, intervalo_dias=$7,
                  observacoes=$8, total_cent=$9, atualizado_em=now() WHERE id = $1`,
          [pid, ...valores]
        );
        await q.query("DELETE FROM pedido_itens WHERE pedido_id = $1", [pid]);
      }
      for (const it of p.itens) {
        await q.query("INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, valor_unitario_cent, desconto_cent) VALUES ($1,$2,$3,$4,$5)", [
          pid, it.produto_id, it.quantidade, it.valor_unitario_cent, it.desconto_cent,
        ]);
      }
      return pid;
    });
    if (req.body?.emitir) return emitirPedido(req, e, pedidoId);
    return { pedido: await pedidoCompleto(db, e, pedidoId) };
  }

  async function emitirPedido(req, e, pedidoId) {
    exigir(req, "emitir");
    const pedido = await pedidoCompleto(db, e, pedidoId);
    if (pedido.status !== "aberto") throw conflito("Este pedido não está em aberto.");
    const emAndamento = await db.one(
      "SELECT id, status FROM notas WHERE pedido_id = $1 AND status IN ('enviando','pendente','autorizada') ORDER BY id DESC LIMIT 1",
      [pedidoId]
    );
    if (emAndamento) throw conflito(`O pedido já tem uma nota ${emAndamento.status}. Veja em Notas fiscais.`);
    const total = pedido.calculo.totais.total_cent;
    const entrada = {
      cliente_id: pedido.cliente_id,
      itens: pedido.itens.map((i) => ({ produto_id: i.produto_id, quantidade: Number(i.quantidade), valor_unitario_cent: Number(i.valor_unitario_cent), desconto_cent: Number(i.desconto_cent) })),
      pagamentos: [{ tPag: pedido.forma_pagamento, valor_cent: total }],
      duplicatas: montarDuplicatas(pedido, total),
      infCpl: [`Pedido ${pedido.numero}.`, pedido.observacoes].filter(Boolean).join(" "),
    };
    let nota;
    try {
      // Nota rejeitada deste pedido: reaproveita o mesmo número com os dados atuais do pedido.
      const rejeitada = await db.one("SELECT * FROM notas WHERE pedido_id = $1 AND status IN ('rejeitada','nao_enviada') ORDER BY id DESC LIMIT 1", [pedidoId]);
      if (rejeitada) {
        const r = await db.one("UPDATE notas SET dados = jsonb_set(dados, '{entrada}', $2::jsonb) WHERE id = $1 RETURNING *", [rejeitada.id, JSON.stringify(entrada)]);
        nota = await reenviarNota({ db, config, nota: r, usuarioId: req.usuario.id });
      } else {
        nota = await emitirNota({ db, config, empresaId: e.id, modelo: "55", entrada, pedidoId, usuarioId: req.usuario.id });
      }
    } catch (erro) {
      if (erro.status && erro.status < 500) return { pedido: await pedidoCompleto(db, e, pedidoId), erro_emissao: erro.message };
      throw erro;
    }
    const resp = { pedido: await pedidoCompleto(db, e, pedidoId), nota: notaCompleta(nota) };
    if (nota.status !== "autorizada") resp.erro_emissao = `NF-e ${nota.status}: ${nota.c_stat ?? ""} ${nota.x_motivo ?? ""}`.trim();
    return resp;
  }

  api.post("/empresas/:eid/pedidos", async (req) => salvar(req, null));
  api.put("/empresas/:eid/pedidos/:id", async (req) => salvar(req, Number(req.params.id)));
  api.post("/empresas/:eid/pedidos/:id/emitir", async (req) => emitirPedido(req, await empresaDaRota(req, db), Number(req.params.id)));

  api.post("/empresas/:eid/pedidos/:id/cancelar", async (req) => {
    exigir(req, "pedidos");
    const e = await empresaDaRota(req, db);
    const id = Number(req.params.id);
    const p = await db.one("SELECT * FROM pedidos WHERE id = $1 AND empresa_id = $2", [id, e.id]);
    if (!p) throw naoEncontrado("Pedido não encontrado.");
    if (p.status !== "aberto") throw conflito("Só pedido em aberto pode ser cancelado. Para pedido faturado, cancele a nota.");
    const viva = await db.one("SELECT id FROM notas WHERE pedido_id = $1 AND status IN ('enviando','pendente','autorizada')", [id]);
    if (viva) throw conflito("O pedido tem nota em andamento ou autorizada.");
    await db.query("UPDATE pedidos SET status = 'cancelado', atualizado_em = now() WHERE id = $1", [id]);
    return pedidoCompleto(db, e, id);
  });

  // ---- Venda balcão (NFC-e) ----
  api.post("/empresas/:eid/nfce", async (req) => {
    exigir(req, "emitir");
    const e = await empresaDaRota(req, db);
    const d = req.body ?? {};
    const entrada = {
      consumidor: d.cpf ? { cpf: d.cpf, nome: d.nome } : null,
      itens: (d.itens ?? []).map((i) => ({ produto_id: Number(i.produto_id), quantidade: Number(i.quantidade), ...(i.valor_unitario_cent != null ? { valor_unitario_cent: Math.round(i.valor_unitario_cent) } : {}) })),
      pagamentos: (d.pagamentos ?? []).map((p) => ({ tPag: String(p.tPag).padStart(2, "0"), valor_cent: Math.round(Number(p.valor_cent)) })),
    };
    if (!entrada.pagamentos.length) throw invalido("Informe a forma de pagamento.");
    const nota = await emitirNota({ db, config, empresaId: e.id, modelo: "65", entrada, usuarioId: req.usuario.id });
    return notaCompleta(nota);
  });

  // ---- Notas ----
  async function notaDaRota(req) {
    const e = await empresaDaRota(req, db);
    const n = await db.one("SELECT * FROM notas WHERE id = $1 AND empresa_id = $2", [Number(req.params.id), e.id]);
    if (!n) throw naoEncontrado("Nota não encontrada.");
    return { e, n };
  }
  const completa = async (n) => notaCompleta(n, await db.many("SELECT * FROM nota_eventos WHERE nota_id = $1 ORDER BY id", [n.id]));

  api.get("/empresas/:eid/notas", async (req) => {
    const e = await empresaDaRota(req, db);
    const params = [e.id];
    let where = "empresa_id = $1";
    if (["55", "65"].includes(req.query.modelo)) where += ` AND modelo = $${params.push(req.query.modelo)}`;
    if (req.query.status) where += ` AND status = $${params.push(String(req.query.status))}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.de ?? "")) where += ` AND emitida_em >= $${params.push(req.query.de)}::date`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.ate ?? "")) where += ` AND emitida_em < ($${params.push(req.query.ate)}::date + 1)`;
    const busca = texto(req.query.busca, 80);
    if (busca) where += ` AND (destinatario ILIKE $${params.push(`%${busca}%`)} OR numero::text = $${params.push(busca)} OR chave = $${params.push(busca)})`;
    return (await db.many(`SELECT * FROM notas WHERE ${where} ORDER BY id DESC LIMIT 500`, params)).map(resumoNota);
  });

  api.get("/empresas/:eid/notas/:id", async (req) => completa((await notaDaRota(req)).n));

  api.get("/empresas/:eid/notas/:id/xml", async (req, reply) => {
    const { n } = await notaDaRota(req);
    const xml = n.xml_autorizado ?? n.xml_assinado;
    if (!xml) throw naoEncontrado("A nota não tem XML.");
    const nome = `${n.chave ?? `nota-${n.numero}`}${n.xml_autorizado ? "-procNFe" : ""}.xml`;
    reply.header("content-type", "application/xml; charset=utf-8").header("content-disposition", `attachment; filename="${nome}"`);
    return xml;
  });

  api.get("/empresas/:eid/notas/:id/danfe", async (req, reply) => {
    const { e, n } = await notaDaRota(req);
    const eventos = await db.many("SELECT * FROM nota_eventos WHERE nota_id = $1 AND registrado ORDER BY id", [n.id]);
    const html = await gerarDanfe({ empresa: e, nota: n, eventos });
    reply.header("content-type", "text/html; charset=utf-8");
    return html;
  });

  api.post("/empresas/:eid/notas/:id/consultar", async (req) => {
    const { n } = await notaDaRota(req);
    return completa(await consultarNota({ db, config, nota: n, usuarioId: req.usuario.id }));
  });

  api.post("/empresas/:eid/notas/:id/reenviar", async (req) => {
    exigir(req, "emitir");
    const { n } = await notaDaRota(req);
    return completa(await reenviarNota({ db, config, nota: n, usuarioId: req.usuario.id }));
  });

  api.post("/empresas/:eid/notas/:id/cancelar", async (req) => {
    exigir(req, "cancelar_nota");
    const { n } = await notaDaRota(req);
    return completa(await cancelarNota({ db, config, nota: n, justificativa: req.body?.justificativa, usuarioId: req.usuario.id }));
  });

  api.post("/empresas/:eid/notas/:id/cce", async (req) => {
    exigir(req, "emitir");
    const { n } = await notaDaRota(req);
    return completa(await cceNota({ db, config, nota: n, correcao: req.body?.correcao }));
  });

  // ---- Inutilização de numeração ----
  api.get("/empresas/:eid/inutilizacoes", async (req) => {
    const e = await empresaDaRota(req, db);
    const linhas = await db.many(
      `SELECT i.*, u.nome AS usuario_nome FROM inutilizacoes i LEFT JOIN usuarios u ON u.id = i.usuario_id
        WHERE i.empresa_id = $1 ORDER BY i.id DESC LIMIT 200`,
      [e.id]
    );
    return linhas.map(inutilizacaoPublica);
  });

  api.post("/empresas/:eid/inutilizacoes", async (req, reply) => {
    exigir(req, "cancelar_nota");
    const e = await empresaDaRota(req, db);
    const r = await inutilizarNumeracao({ db, config, empresaId: e.id, dados: req.body, usuarioId: req.usuario.id });
    if (r.status === "rejeitada") throw conflito(`A SEFAZ recusou a inutilização: ${r.c_stat} - ${r.x_motivo}`);
    if (r.status === "sem_resposta") {
      reply.code(202);
    }
    return inutilizacaoPublica(r);
  });
}
