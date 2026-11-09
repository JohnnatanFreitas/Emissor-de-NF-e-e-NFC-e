// Contas a receber (geradas pelas duplicatas das NF-e autorizadas).
import { exigir, empresaDaRota } from "../acesso.js";
import { conflito, invalido, naoEncontrado, hojeISO, texto } from "../util.js";

const SQL = `SELECT r.*, n.numero AS nota_numero, c.nome AS cliente_nome, (r.status = 'aberta' AND r.vencimento < current_date) AS vencida
               FROM contas_receber r LEFT JOIN notas n ON n.id = r.nota_id LEFT JOIN pessoas c ON c.id = r.cliente_id`;

export async function rotasFinanceiro(api, { db }) {
  api.get("/empresas/:eid/receber", async (req) => {
    exigir(req, "financeiro");
    const e = await empresaDaRota(req, db);
    const params = [e.id];
    let where = "r.empresa_id = $1";
    const st = req.query.status;
    if (st === "vencida") where += " AND r.status = 'aberta' AND r.vencimento < current_date";
    else if (["aberta", "recebida", "cancelada"].includes(st)) where += ` AND r.status = $${params.push(st)}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.de ?? "")) where += ` AND r.vencimento >= $${params.push(req.query.de)}::date`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.ate ?? "")) where += ` AND r.vencimento <= $${params.push(req.query.ate)}::date`;
    return db.many(`${SQL} WHERE ${where} ORDER BY r.vencimento, r.id LIMIT 1000`, params);
  });

  const parcela = async (e, id) => {
    const r = await db.one(`${SQL} WHERE r.id = $1 AND r.empresa_id = $2`, [id, e.id]);
    if (!r) throw naoEncontrado("Parcela não encontrada.");
    return r;
  };

  api.post("/empresas/:eid/receber/:id/baixar", async (req) => {
    exigir(req, "financeiro");
    const e = await empresaDaRota(req, db);
    const r = await parcela(e, Number(req.params.id));
    if (r.status !== "aberta") throw conflito("Só parcela em aberto pode ser baixada.");
    const valor = req.body?.valor_recebido_cent != null ? Math.round(Number(req.body.valor_recebido_cent)) : Number(r.valor_cent);
    if (!(valor > 0)) throw invalido("Valor recebido inválido.");
    const data = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.recebida_em ?? "") ? req.body.recebida_em : hojeISO();
    await db.query("UPDATE contas_receber SET status = 'recebida', valor_recebido_cent = $2, recebida_em = $3, forma = $4 WHERE id = $1", [
      r.id, valor, data, texto(req.body?.forma, 40) || null,
    ]);
    return parcela(e, r.id);
  });

  api.post("/empresas/:eid/receber/:id/estornar", async (req) => {
    exigir(req, "financeiro");
    const e = await empresaDaRota(req, db);
    const r = await parcela(e, Number(req.params.id));
    if (r.status !== "recebida") throw conflito("Só parcela recebida pode ser estornada.");
    await db.query("UPDATE contas_receber SET status = 'aberta', valor_recebido_cent = NULL, recebida_em = NULL, forma = NULL WHERE id = $1", [r.id]);
    return parcela(e, r.id);
  });
}
