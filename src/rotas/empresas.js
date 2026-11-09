// Empresas da carteira, certificado, CSC, ambiente, perfis fiscais, status SEFAZ e painel.
import { exigir, enxergaEmpresa, empresaDaRota } from "../acesso.js";
import { lerCertificado, conferirCertificado } from "../certificado.js";
import { cifrar } from "../seguranca.js";
import { perfisPadrao } from "../fiscal/perfis-padrao.js";
import { criarSefaz } from "../nfe/sefaz.js";
import { XMLParser } from "fast-xml-parser";
import { invalido, naoEncontrado, pegar, montarSet, soDigitos, validarCNPJ, texto } from "../util.js";
import { resumoNota } from "../servicos/notas-vista.js";

const CAMPOS_EMPRESA = [
  "cnpj", "razao_social", "nome_fantasia", "ie", "im", "crt", "cnae", "logradouro", "numero", "complemento", "bairro",
  "cod_municipio", "municipio", "uf", "cep", "fone", "email", "serie_nfe", "proximo_nfe", "serie_nfce", "proximo_nfce",
];
const UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");

export const CAMPOS_PERFIL = [
  "nome", "ativo", "cfop_interno", "cfop_interestadual", "cfop_nfce", "origem", "cst_icms", "aliq_icms_interna",
  "aliq_icms_interestadual", "reducao_bc_icms", "mva_st", "aliq_icms_st", "cst_pis", "aliq_pis", "cst_cofins", "aliq_cofins",
  "cst_ipi", "aliq_ipi", "informar_ibscbs", "cst_ibscbs", "cclass_trib", "aliq_ibs_uf", "aliq_ibs_mun", "aliq_cbs", "ibscbs_base_liquida",
];

export function empresaPublica(e) {
  const dias = e.cert_validade ? Math.floor((new Date(e.cert_validade).getTime() - Date.now()) / 86400000) : null;
  const r = {};
  for (const k of ["id", ...CAMPOS_EMPRESA, "ambiente", "csc_id", "criado_em"]) r[k] = e[k];
  r.tem_csc = !!e.csc_cifrado;
  r.certificado = e.cert_validade ? { titular: e.cert_titular, validade: e.cert_validade, dias_restantes: dias } : null;
  return r;
}

function normalizarEmpresa(d, parcial) {
  const c = pegar(d, CAMPOS_EMPRESA);
  for (const k of ["razao_social", "nome_fantasia", "logradouro", "numero", "complemento", "bairro", "municipio", "email", "im"]) {
    if (c[k] !== undefined) c[k] = texto(c[k], 120);
  }
  for (const k of ["cnpj", "ie", "cod_municipio", "cep", "fone", "cnae"]) if (c[k] !== undefined) c[k] = soDigitos(c[k]);
  if (c.ie !== undefined && /isento/i.test(String(d.ie))) c.ie = "ISENTO";
  if (c.uf !== undefined) c.uf = String(c.uf).toUpperCase();
  for (const k of ["serie_nfe", "proximo_nfe", "serie_nfce", "proximo_nfce"]) if (c[k] !== undefined) c[k] = Number(c[k]);

  const obrig = parcial ? Object.keys(c) : ["cnpj", "razao_social", "ie", "crt", "logradouro", "numero", "bairro", "cod_municipio", "municipio", "uf", "cep"];
  for (const k of obrig) if (["cnpj", "razao_social", "logradouro", "numero", "bairro", "municipio"].includes(k) && !c[k]) throw invalido(`Preencha o campo ${k.replace("_", " ")}.`);
  if (c.cnpj !== undefined && !validarCNPJ(c.cnpj)) throw invalido("CNPJ inválido.");
  if (c.crt !== undefined && !["1", "2", "3"].includes(String(c.crt))) throw invalido("Regime (CRT) inválido: use 1, 2 ou 3.");
  if (c.cod_municipio !== undefined && c.cod_municipio.length !== 7) throw invalido("O código IBGE do município tem 7 dígitos.");
  if (c.uf !== undefined && !UFS.includes(c.uf)) throw invalido("UF inválida.");
  if (c.cep !== undefined && c.cep.length !== 8) throw invalido("CEP deve ter 8 dígitos.");
  if (c.ie !== undefined && !c.ie) throw invalido("Preencha a inscrição estadual.");
  for (const k of ["serie_nfe", "serie_nfce"]) if (c[k] !== undefined && !(c[k] >= 0 && c[k] <= 999)) throw invalido("Série deve ficar entre 0 e 999.");
  for (const k of ["proximo_nfe", "proximo_nfce"]) if (c[k] !== undefined && !(c[k] >= 1 && c[k] <= 999999999)) throw invalido("Próximo número inválido.");
  return c;
}

export function normalizarPerfil(d, parcial) {
  const c = pegar(d, CAMPOS_PERFIL);
  if (!parcial || c.nome !== undefined) if (!texto(c.nome)) throw invalido("Dê um nome ao perfil fiscal.");
  for (const k of ["cfop_interno", "cfop_interestadual", "cfop_nfce"]) {
    if (c[k] !== undefined || !parcial) {
      c[k] = soDigitos(c[k]);
      if (c[k].length !== 4) throw invalido("CFOP deve ter 4 dígitos.");
    }
  }
  if (c.cfop_interno && !/^5/.test(c.cfop_interno)) throw invalido("O CFOP dentro do estado começa com 5.");
  if (c.cfop_interestadual && !/^6/.test(c.cfop_interestadual)) throw invalido("O CFOP fora do estado começa com 6.");
  for (const k of ["aliq_icms_interna", "aliq_icms_interestadual", "reducao_bc_icms", "mva_st", "aliq_icms_st", "aliq_pis", "aliq_cofins", "aliq_ipi", "aliq_ibs_uf", "aliq_ibs_mun", "aliq_cbs"]) {
    if (c[k] !== undefined) {
      c[k] = Number(c[k] || 0);
      if (!(c[k] >= 0 && c[k] <= 1000)) throw invalido(`Alíquota inválida em ${k}.`);
    }
  }
  if (c.cst_ipi !== undefined) c.cst_ipi = c.cst_ipi ? String(c.cst_ipi) : null;
  return c;
}

async function aplicarSegredos(d, empresa, config, campos) {
  if (d.certificado_base64) {
    const pfx = Buffer.from(String(d.certificado_base64).replace(/^data:[^,]+,/, ""), "base64");
    const info = await lerCertificado(pfx, d.certificado_senha, { openssl: config.openssl });
    conferirCertificado(info, campos.cnpj ?? empresa?.cnpj);
    campos.cert_cifrado = cifrar(pfx, config.masterKey);
    campos.cert_senha_cifrada = cifrar(String(d.certificado_senha ?? ""), config.masterKey);
    campos.cert_titular = info.titular;
    campos.cert_validade = info.validade.toISOString();
  }
  if (d.csc_id !== undefined) campos.csc_id = soDigitos(d.csc_id) || null;
  if (d.csc) campos.csc_cifrado = cifrar(String(d.csc).trim(), config.masterKey);
}

export async function rotasEmpresas(api, { db, config }) {
  api.get("/empresas", async (req) => {
    const todas = await db.many("SELECT * FROM empresas WHERE ativo ORDER BY razao_social");
    return todas
      .filter((e) => enxergaEmpresa(req.usuario, e.id))
      .map((e) => ({
        id: e.id, cnpj: e.cnpj, razao_social: e.razao_social, nome_fantasia: e.nome_fantasia, uf: e.uf, crt: e.crt,
        ambiente: e.ambiente, certificado_validade: e.cert_validade,
      }));
  });

  api.post("/empresas", async (req) => {
    exigir(req, "gerir_empresas");
    const d = req.body ?? {};
    const campos = normalizarEmpresa(d, false);
    if (config.modoSefaz === "sefaz" && !d.certificado_base64) throw invalido("Escolha o arquivo do certificado A1 (.pfx) e digite a senha.");
    await aplicarSegredos(d, null, config, campos);
    campos.ambiente = 2; // sempre começa em homologação
    return db.tx(async (q) => {
      const cols = Object.keys(campos);
      const e = await q.one(
        `INSERT INTO empresas (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
        cols.map((k) => campos[k])
      );
      for (const p of perfisPadrao(e.crt)) {
        const k = Object.keys(p);
        await q.query(
          `INSERT INTO perfis_fiscais (empresa_id, ${k.join(",")}) VALUES ($1, ${k.map((_, i) => `$${i + 2}`).join(",")})`,
          [e.id, ...k.map((x) => p[x])]
        );
      }
      return empresaPublica(e);
    });
  });

  api.get("/empresas/:eid", async (req) => empresaPublica(await empresaDaRota(req, db)));

  api.put("/empresas/:eid", async (req) => {
    exigir(req, "gerir_empresas");
    const empresa = await empresaDaRota(req, db);
    const d = req.body ?? {};
    const campos = normalizarEmpresa(d, true);
    if (campos.cnpj && campos.cnpj !== empresa.cnpj) {
      const { n } = await db.one("SELECT count(*)::int AS n FROM notas WHERE empresa_id = $1", [empresa.id]);
      if (n) throw invalido("Não é possível trocar o CNPJ de uma empresa que já emitiu notas.");
    }
    await aplicarSegredos(d, empresa, config, campos);
    if (!Object.keys(campos).length) return empresaPublica(empresa);
    const { sql, valores } = montarSet(campos, 2);
    return empresaPublica(await db.one(`UPDATE empresas SET ${sql} WHERE id = $1 RETURNING *`, [empresa.id, ...valores]));
  });

  api.post("/empresas/:eid/producao", async (req) => {
    exigir(req, "liberar_producao");
    const empresa = await empresaDaRota(req, db);
    if (req.body?.confirmacao !== "LIBERAR PRODUCAO") throw invalido('Para liberar a produção, digite exatamente "LIBERAR PRODUCAO".');
    if (config.modoSefaz === "simulado") throw invalido("O servidor está em SEFAZ simulada: produção não pode ser liberada.");
    if (!empresa.cert_cifrado) throw invalido("Cadastre o certificado A1 antes de liberar a produção.");
    return empresaPublica(await db.one("UPDATE empresas SET ambiente = 1 WHERE id = $1 RETURNING *", [empresa.id]));
  });

  api.post("/empresas/:eid/homologacao", async (req) => {
    exigir(req, "gerir_empresas");
    const empresa = await empresaDaRota(req, db);
    return empresaPublica(await db.one("UPDATE empresas SET ambiente = 2 WHERE id = $1 RETURNING *", [empresa.id]));
  });

  api.get("/empresas/:eid/sefaz/status", async (req) => {
    const empresa = await empresaDaRota(req, db);
    const xml = await criarSefaz({ config, empresa, modelo: "55" }).status();
    const j = new XMLParser({ removeNSPrefix: true, parseTagValue: false }).parse(xml);
    const ret = j.retConsStatServ ?? Object.values(j).find((v) => v?.retConsStatServ)?.retConsStatServ ?? j;
    return { cStat: String(ret?.cStat ?? ""), xMotivo: String(ret?.xMotivo ?? xml.slice(0, 200)), modelo: "55" };
  });

  // ---- Perfis fiscais ----
  api.get("/empresas/:eid/perfis", async (req) => {
    const e = await empresaDaRota(req, db);
    return db.many("SELECT * FROM perfis_fiscais WHERE empresa_id = $1 ORDER BY ativo DESC, nome", [e.id]);
  });

  api.post("/empresas/:eid/perfis", async (req) => {
    exigir(req, "editar_perfis");
    const e = await empresaDaRota(req, db);
    const c = normalizarPerfil(req.body ?? {}, false);
    if (!c.cst_icms || !c.cst_pis || !c.cst_cofins) throw invalido("Informe CST/CSOSN do ICMS, CST do PIS e da COFINS.");
    const k = Object.keys(c);
    return db.one(
      `INSERT INTO perfis_fiscais (empresa_id, ${k.join(",")}) VALUES ($1, ${k.map((_, i) => `$${i + 2}`).join(",")}) RETURNING *`,
      [e.id, ...k.map((x) => c[x])]
    );
  });

  api.put("/empresas/:eid/perfis/:id", async (req) => {
    exigir(req, "editar_perfis");
    const e = await empresaDaRota(req, db);
    const c = normalizarPerfil(req.body ?? {}, true);
    if (!Object.keys(c).length) throw invalido("Nada para alterar.");
    const { sql, valores } = montarSet(c, 3);
    const p = await db.one(`UPDATE perfis_fiscais SET ${sql} WHERE id = $1 AND empresa_id = $2 RETURNING *`, [Number(req.params.id), e.id, ...valores]);
    if (!p) throw naoEncontrado("Perfil fiscal não encontrado.");
    return p;
  });

  // ---- Painel ----
  api.get("/empresas/:eid/painel", async (req) => {
    const e = await empresaDaRota(req, db);
    const mes = await db.one(
      `SELECT count(*)::int AS notas, coalesce(sum(total_cent),0)::bigint AS total,
              coalesce(sum((totais->>'ibs_cent')::bigint),0)::bigint AS ibs,
              coalesce(sum((totais->>'cbs_cent')::bigint),0)::bigint AS cbs,
              coalesce(sum((totais->>'icms_cent')::bigint),0)::bigint AS icms
         FROM notas WHERE empresa_id = $1 AND status = 'autorizada' AND emitida_em >= date_trunc('month', now())`,
      [e.id]
    );
    const rec = await db.one(
      `SELECT coalesce(sum(valor_cent),0)::bigint AS aberto,
              coalesce(sum(valor_cent) FILTER (WHERE vencimento < current_date),0)::bigint AS vencido
         FROM contas_receber WHERE empresa_id = $1 AND status = 'aberta'`,
      [e.id]
    );
    const ped = await db.one("SELECT count(*)::int AS n FROM pedidos WHERE empresa_id = $1 AND status = 'aberto'", [e.id]);
    const baixo = await db.many(
      `SELECT id, codigo, descricao, estoque FROM produtos
        WHERE empresa_id = $1 AND ativo AND estoque <= estoque_minimo ORDER BY estoque LIMIT 10`,
      [e.id]
    );
    const ultimas = await db.many("SELECT * FROM notas WHERE empresa_id = $1 ORDER BY id DESC LIMIT 8", [e.id]);
    const dias = await db.many(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia, coalesce(sum(n.total_cent),0)::bigint AS total_cent
         FROM generate_series(current_date - 29, current_date, interval '1 day') d
         LEFT JOIN notas n ON n.empresa_id = $1 AND n.status = 'autorizada' AND n.emitida_em::date = d::date
        GROUP BY d ORDER BY d`,
      [e.id]
    );
    return {
      notas_mes: mes.notas, faturamento_mes_cent: mes.total, ibs_mes_cent: mes.ibs, cbs_mes_cent: mes.cbs, icms_mes_cent: mes.icms,
      receber_aberto_cent: rec.aberto, receber_vencido_cent: rec.vencido, pedidos_abertos: ped.n,
      estoque_baixo: baixo, ultimas_notas: ultimas.map(resumoNota), faturamento_dias: dias,
    };
  });
}
