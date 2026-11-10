// SPED Fiscal (EFD ICMS/IPI): configuração por empresa, prévia, geração e download dos arquivos.
import { exigir, empresaDaRota } from "../acesso.js";
import { invalido, naoEncontrado, texto } from "../util.js";
import { configSped, periodoDe, prepararEfd } from "../sped/coletar.js";
import { paraLatin1 } from "../sped/efd.js";

const so = (v, n) => String(v ?? "").replace(/\D/g, "").slice(0, n);

function normalizarConfig(d) {
  const perfil = d.perfil === "A" ? "A" : "B";
  const atividade = d.atividade === "0" ? "0" : "1";
  const dia = Number(d.dia_vencimento ?? 20);
  if (!Number.isInteger(dia) || dia < 1 || dia > 28) throw invalido("Dia de vencimento do ICMS deve ser de 1 a 28.");
  const ct = d.contabilista ?? {};
  return {
    perfil,
    atividade,
    ind_classif: atividade === "0" ? so(d.ind_classif, 2) : "",
    contabilista: {
      nome: texto(ct.nome, 100), cpf: so(ct.cpf, 11), crc: texto(ct.crc, 15), cnpj: so(ct.cnpj, 14),
      cep: so(ct.cep, 8), logradouro: texto(ct.logradouro, 60), numero: texto(ct.numero, 10), complemento: texto(ct.complemento, 60),
      bairro: texto(ct.bairro, 60), fone: so(ct.fone, 11), email: texto(ct.email, 255), cod_municipio: so(ct.cod_municipio, 7),
    },
    cod_receita: texto(d.cod_receita, 15),
    cod_receita_st: texto(d.cod_receita_st, 15),
    cod_receita_difal: texto(d.cod_receita_difal, 15),
    dia_vencimento: dia,
    saldo_credor_inicial_cent: Math.max(0, Math.round(Number(d.saldo_credor_inicial_cent) || 0)),
    incluir_homologacao: !!d.incluir_homologacao,
  };
}

const resumoArquivo = (a) => ({
  id: a.id, periodo: a.periodo, perfil: a.perfil, finalidade: a.finalidade, linhas: a.linhas,
  apuracao: a.apuracao, gerado_em: a.gerado_em, usuario_nome: a.usuario_nome ?? null,
});

export async function rotasSped(api, { db }) {
  api.get("/empresas/:eid/sped/config", async (req) => {
    exigir(req, "sped");
    return configSped(await empresaDaRota(req, db));
  });

  api.put("/empresas/:eid/sped/config", async (req) => {
    exigir(req, "sped");
    const e = await empresaDaRota(req, db);
    const c = normalizarConfig(req.body ?? {});
    await db.query("UPDATE empresas SET sped = $2 WHERE id = $1", [e.id, JSON.stringify(c)]);
    return c;
  });

  function opcoes(body) {
    const perfil = body?.perfil;
    if (perfil != null && !["A", "B"].includes(perfil)) throw invalido("Perfil deve ser A ou B.");
    const finalidade = String(body?.finalidade ?? "0");
    if (!["0", "1"].includes(finalidade)) throw invalido("Finalidade deve ser 0 (original) ou 1 (substituto).");
    const saldo = body?.saldo_credor_anterior_cent;
    return { perfil, finalidade, saldoCredorAnteriorCent: saldo === "" || saldo == null ? null : Number(saldo) };
  }

  // Prévia: confere tudo e mostra a apuração, sem gravar.
  api.post("/empresas/:eid/sped/previa", async (req) => {
    exigir(req, "sped");
    const e = await empresaDaRota(req, db);
    const periodo = periodoDe(req.body?.periodo);
    const r = await prepararEfd(db, e, periodo, opcoes(req.body));
    return {
      periodo: periodo.codigo, erros: r.erros, alertas: r.alertas, saldo_anterior: r.saldo_anterior,
      ...(r.efd ? { linhas: r.efd.linhas, contagem: r.efd.contagem, apuracao: r.efd.apuracao, resumo: r.efd.resumo } : {}),
    };
  });

  api.post("/empresas/:eid/sped/gerar", async (req, reply) => {
    exigir(req, "sped");
    const e = await empresaDaRota(req, db);
    const periodo = periodoDe(req.body?.periodo);
    const r = await prepararEfd(db, e, periodo, opcoes(req.body));
    if (r.erros.length) {
      reply.code(422);
      return { erro: "O SPED não foi gerado: corrija os erros da prévia.", erros: r.erros, alertas: r.alertas };
    }
    const a = await db.one(
      `INSERT INTO sped_arquivos (empresa_id, periodo, perfil, finalidade, linhas, apuracao, contagem, saldo_credor_transportar_cent, conteudo, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [e.id, periodo.codigo, r.efd.resumo.perfil, req.body?.finalidade === "1" ? "1" : "0", r.efd.linhas, JSON.stringify(r.efd.apuracao),
        JSON.stringify(r.efd.contagem), r.efd.apuracao.saldo_credor_transportar_cent, r.efd.txt, req.usuario.id]
    );
    return { ...resumoArquivo(a), alertas: r.alertas, resumo: r.efd.resumo };
  });

  api.get("/empresas/:eid/sped/arquivos", async (req) => {
    exigir(req, "sped");
    const e = await empresaDaRota(req, db);
    const linhas = await db.many(
      `SELECT a.id, a.periodo, a.perfil, a.finalidade, a.linhas, a.apuracao, a.gerado_em, u.nome AS usuario_nome
         FROM sped_arquivos a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.empresa_id = $1 ORDER BY a.gerado_em DESC LIMIT 100`,
      [e.id]
    );
    return linhas.map(resumoArquivo);
  });

  api.get("/empresas/:eid/sped/arquivos/:id/download", async (req, reply) => {
    exigir(req, "sped");
    const e = await empresaDaRota(req, db);
    const a = await db.one("SELECT * FROM sped_arquivos WHERE id = $1 AND empresa_id = $2", [Number(req.params.id), e.id]);
    if (!a) throw naoEncontrado("Arquivo não encontrado.");
    const nome = `SpedEFD-${e.cnpj}-${a.periodo.slice(5)}${a.periodo.slice(0, 4)}-perfil${a.perfil}${a.finalidade === "1" ? "-substituto" : ""}.txt`;
    reply.header("content-type", "text/plain; charset=iso-8859-1").header("content-disposition", `attachment; filename="${nome}"`);
    return paraLatin1(a.conteudo);
  });
}
