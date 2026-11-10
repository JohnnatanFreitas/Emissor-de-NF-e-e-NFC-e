// NFS-e no padrão nacional: serviços da empresa, cálculo, emissão, consulta, DANFSe e cancelamento.
import { exigir, empresaDaRota } from "../acesso.js";
import { conflito, invalido, naoEncontrado, soDigitos, texto, validarCNPJ, validarCPF, hojeISO } from "../util.js";
import { CATALOGO_SERVICOS, calcularNfse } from "../nfse/regras.js";
import { montarDps, gerarDanfse } from "../nfse/dps.js";
import { criarTransmissor, modoNfse } from "../nfse/transmissao.js";
import { CSP_DANFE } from "../cabecalhos.js";

const regimeDe = (empresa) => (empresa.nfse?.mei ? "mei" : empresa.crt === "3" ? "normal" : "simples");

function normalizarServico(d) {
  const cod = soDigitos(d.cod_trib_nac);
  if (!/^\d{6}$/.test(cod)) throw invalido("Código de tributação nacional deve ter 6 dígitos (item, subitem e desdobramento).");
  const descricao = texto(d.descricao, 255);
  if (descricao.length < 3) throw invalido("Descreva o serviço.");
  const aliq = Number(d.aliq_iss);
  if (!(aliq >= 0 && aliq <= 5)) throw invalido("Alíquota do ISS deve ficar entre 0% e 5% (LC 116/2003).");
  const nbs = soDigitos(d.nbs);
  if (nbs && nbs.length !== 9) throw invalido("Código NBS deve ter 9 dígitos.");
  return { cod_trib_nac: cod, item_lc116: texto(d.item_lc116, 5), nbs, descricao, aliq_iss: aliq, iss_retido: !!d.iss_retido, ativo: d.ativo !== false };
}

const publica = (n) => ({
  id: n.id, serie_dps: n.serie_dps, numero_dps: n.numero_dps, numero_nfse: n.numero_nfse, chave: n.chave, modo: n.modo, ambiente: n.ambiente,
  status: n.status, tomador_id: n.tomador_id, tomador_nome: n.tomador_nome, servico_id: n.servico_id, competencia: n.competencia,
  valor_cent: Number(n.valor_cent), valores: n.valores, descricao: n.dados?.descricao ?? "", servico: n.dados?.servico ?? null,
  mensagem: n.mensagem, motivo_cancelamento: n.motivo_cancelamento, emitida_em: n.emitida_em, cancelada_em: n.cancelada_em,
});

export async function rotasNfse(api, { db, config }) {
  api.get("/nfse/catalogo", async () => CATALOGO_SERVICOS);

  api.get("/empresas/:eid/nfse/config", async (req) => {
    const e = await empresaDaRota(req, db);
    return { mei: !!e.nfse?.mei, regime: regimeDe(e), serie_dps: e.serie_dps, proximo_dps: e.proximo_dps, modo: modoNfse(), ambiente: e.ambiente, im: e.im };
  });

  api.put("/empresas/:eid/nfse/config", async (req) => {
    exigir(req, "gerir_empresas");
    const e = await empresaDaRota(req, db);
    const serie = Number(req.body?.serie_dps ?? e.serie_dps);
    if (!Number.isInteger(serie) || serie < 1 || serie > 99999) throw invalido("Série da DPS deve ser de 1 a 99999.");
    const r = await db.one("UPDATE empresas SET nfse = $2, serie_dps = $3 WHERE id = $1 RETURNING *", [e.id, JSON.stringify({ mei: !!req.body?.mei }), serie]);
    return { mei: !!r.nfse?.mei, regime: regimeDe(r), serie_dps: r.serie_dps, proximo_dps: r.proximo_dps, modo: modoNfse(), ambiente: r.ambiente, im: r.im };
  });

  // ---- serviços ----
  api.get("/empresas/:eid/nfse/servicos", async (req) => {
    const e = await empresaDaRota(req, db);
    return db.many("SELECT * FROM nfse_servicos WHERE empresa_id = $1 ORDER BY ativo DESC, descricao", [e.id]);
  });
  api.post("/empresas/:eid/nfse/servicos", async (req) => {
    exigir(req, "editar_produtos");
    const e = await empresaDaRota(req, db);
    const s = normalizarServico(req.body ?? {});
    return db.one(
      `INSERT INTO nfse_servicos (empresa_id, cod_trib_nac, item_lc116, nbs, descricao, aliq_iss, iss_retido, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [e.id, s.cod_trib_nac, s.item_lc116, s.nbs, s.descricao, s.aliq_iss, s.iss_retido, s.ativo]
    );
  });
  api.put("/empresas/:eid/nfse/servicos/:id", async (req) => {
    exigir(req, "editar_produtos");
    const e = await empresaDaRota(req, db);
    const s = normalizarServico(req.body ?? {});
    const r = await db.one(
      `UPDATE nfse_servicos SET cod_trib_nac=$3, item_lc116=$4, nbs=$5, descricao=$6, aliq_iss=$7, iss_retido=$8, ativo=$9 WHERE id=$1 AND empresa_id=$2 RETURNING *`,
      [Number(req.params.id), e.id, s.cod_trib_nac, s.item_lc116, s.nbs, s.descricao, s.aliq_iss, s.iss_retido, s.ativo]
    );
    if (!r) throw naoEncontrado("Serviço não encontrado.");
    return r;
  });

  // ---- cálculo e emissão ----
  async function preparar(e, d) {
    const servico = await db.one("SELECT * FROM nfse_servicos WHERE id = $1 AND empresa_id = $2", [Number(d.servico_id), e.id]);
    if (!servico) throw invalido("Escolha o serviço prestado.");
    const tomador = await db.one("SELECT * FROM pessoas WHERE id = $1 AND empresa_id = $2", [Number(d.tomador_id), e.id]);
    if (!tomador) throw invalido("Escolha o tomador do serviço (cadastro de clientes).");
    const doc = soDigitos(tomador.cpf_cnpj);
    if (doc.length === 14 ? !validarCNPJ(doc) : !validarCPF(doc)) throw invalido("CPF/CNPJ do tomador inválido.");
    const competencia = /^\d{4}-\d{2}-\d{2}$/.test(d.competencia ?? "") ? d.competencia : hojeISO();
    if (competencia > hojeISO()) throw invalido("A competência não pode estar no futuro.");
    const valor = Math.round(Number(d.valor_servico_cent));
    if (!(valor > 0)) throw invalido("Informe o valor do serviço.");
    const calculo = calcularNfse({
      ano: Number(competencia.slice(0, 4)), valor_servico_cent: valor, deducoes_cent: d.deducoes_cent, desconto_incond_cent: d.desconto_incond_cent,
      regime: regimeDe(e), aliq_iss: Number(servico.aliq_iss), iss_retido: d.iss_retido ?? servico.iss_retido, tomador_pj: doc.length === 14,
      reter_irrf: d.reter_irrf, reter_csrf: d.reter_csrf, reter_inss: !!d.reter_inss, aliq_inss: Number(d.aliq_inss) || 11,
    });
    return { servico, tomador, competencia, calculo };
  }

  api.post("/empresas/:eid/nfse/calculo", async (req) => {
    const e = await empresaDaRota(req, db);
    const { calculo } = await preparar(e, req.body ?? {});
    return calculo;
  });

  api.post("/empresas/:eid/nfse", async (req) => {
    exigir(req, "emitir");
    const e0 = await empresaDaRota(req, db);
    const d = req.body ?? {};
    const descricao = texto(d.descricao, 2000);
    if (descricao.length < 5) throw invalido("Descreva o serviço prestado (discriminação).");
    const { servico, tomador, competencia, calculo } = await preparar(e0, d);
    const transmissor = criarTransmissor({ config, empresa: e0 }); // valida certificado antes de gastar número

    const nota = await db.tx(async (q) => {
      const e = await q.one("SELECT * FROM empresas WHERE id = $1 FOR UPDATE", [e0.id]);
      const numero = e.proximo_dps;
      const dhEmi = new Date().toISOString().replace(/\.\d{3}Z$/, "-00:00");
      const dados = {
        descricao, regime: regimeDe(e),
        servico: { cod_trib_nac: servico.cod_trib_nac, item_lc116: servico.item_lc116, nbs: servico.nbs, descricao: servico.descricao },
        tomador: { cpf_cnpj: tomador.cpf_cnpj, nome: tomador.nome, email: tomador.email, fone: tomador.fone, logradouro: tomador.logradouro, numero: tomador.numero,
          complemento: tomador.complemento, bairro: tomador.bairro, cod_municipio: tomador.cod_municipio, municipio: tomador.municipio, uf: tomador.uf, cep: tomador.cep },
      };
      const xml = montarDps({ ambiente: e.ambiente, dhEmi, serie: e.serie_dps, numero, competencia, empresa: e, regime: dados.regime, tomador: dados.tomador, servico, calculo, descricao });
      await q.query("UPDATE empresas SET proximo_dps = proximo_dps + 1 WHERE id = $1", [e.id]);
      return q.one(
        `INSERT INTO nfse (empresa_id, serie_dps, numero_dps, modo, ambiente, status, tomador_id, tomador_nome, servico_id, competencia, valor_cent, valores, dados, xml_dps, usuario_id)
         VALUES ($1,$2,$3,$4,$5,'enviando',$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [e.id, e.serie_dps, numero, transmissor.modo, e.ambiente, tomador.id, tomador.nome, servico.id, competencia, calculo.valor_servico_cent,
          JSON.stringify(calculo), JSON.stringify(dados), xml, req.usuario.id]
      );
    });

    let r;
    try {
      let numeroNfse = null;
      if (transmissor.modo === "simulado") {
        numeroNfse = (await db.one("UPDATE empresas SET proximo_nfse_simulada = proximo_nfse_simulada + 1 WHERE id = $1 RETURNING proximo_nfse_simulada - 1 AS n", [e0.id])).n;
      }
      r = await transmissor.emitir({ empresa: e0, xmlDps: nota.xml_dps, numeroNfse, data: competencia, ambiente: nota.ambiente });
    } catch (err) {
      await db.query("UPDATE nfse SET status = 'pendente', mensagem = $2 WHERE id = $1", [nota.id, String(err.message ?? err).slice(0, 500)]);
      throw err;
    }
    const final = await db.one(
      `UPDATE nfse SET status = $2, chave = $3, numero_nfse = $4, xml_nfse = $5, xml_dps = coalesce($6, xml_dps), mensagem = $7 WHERE id = $1 RETURNING *`,
      [nota.id, r.autorizada ? "autorizada" : "rejeitada", r.chave ?? null, r.numero_nfse ?? null, r.xml_nfse ?? null, r.xml_dps ?? null, r.mensagem]
    );
    return publica(final);
  });

  api.get("/empresas/:eid/nfse", async (req) => {
    const e = await empresaDaRota(req, db);
    const p = [e.id];
    let w = "empresa_id = $1";
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.de ?? "")) w += ` AND emitida_em >= $${p.push(req.query.de)}::date`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.ate ?? "")) w += ` AND emitida_em < ($${p.push(req.query.ate)}::date + 1)`;
    if (req.query.status) w += ` AND status = $${p.push(String(req.query.status))}`;
    return (await db.many(`SELECT * FROM nfse WHERE ${w} ORDER BY id DESC LIMIT 500`, p)).map(publica);
  });

  async function notaDaRota(req) {
    const e = await empresaDaRota(req, db);
    const n = await db.one("SELECT * FROM nfse WHERE id = $1 AND empresa_id = $2", [Number(req.params.id), e.id]);
    if (!n) throw naoEncontrado("NFS-e não encontrada.");
    return { e, n };
  }

  api.get("/empresas/:eid/nfse/:id", async (req) => publica((await notaDaRota(req)).n));

  api.get("/empresas/:eid/nfse/:id/xml", async (req, reply) => {
    const { n } = await notaDaRota(req);
    const xml = n.xml_nfse ?? n.xml_dps;
    reply.header("content-type", "application/xml; charset=utf-8").header("content-disposition", `attachment; filename="${n.chave ?? `DPS-${n.serie_dps}-${n.numero_dps}`}.xml"`);
    return xml;
  });

  api.get("/empresas/:eid/nfse/:id/danfse", async (req, reply) => {
    const { e, n } = await notaDaRota(req);
    reply.header("content-type", "text/html; charset=utf-8").header("content-security-policy", CSP_DANFE);
    return gerarDanfse({ empresa: e, nota: n });
  });

  api.post("/empresas/:eid/nfse/:id/cancelar", async (req) => {
    exigir(req, "cancelar_nota");
    const { e, n } = await notaDaRota(req);
    const motivo = texto(req.body?.motivo, 255);
    if (motivo.length < 15) throw invalido("O motivo do cancelamento precisa ter de 15 a 255 caracteres.");
    if (n.status !== "autorizada") throw conflito("Só NFS-e autorizada pode ser cancelada.");
    const t = criarTransmissor({ config, empresa: e, modo: n.modo });
    await t.cancelar({ chave: n.chave, motivo });
    return publica(await db.one("UPDATE nfse SET status = 'cancelada', cancelada_em = now(), motivo_cancelamento = $2 WHERE id = $1 RETURNING *", [n.id, motivo]));
  });
}
