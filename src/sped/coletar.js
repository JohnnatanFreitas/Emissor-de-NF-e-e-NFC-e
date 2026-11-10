// Junta do banco tudo o que a EFD de um período precisa e confere antes de montar.
// Erros impedem a geração; alertas aparecem na prévia e no arquivo gerado.
import { lerNfe } from "./nfe-xml.js";
import { DESTINOS } from "./classificacao.js";
import { montarEfd } from "./efd.js";
import { garantirItens } from "../servicos/classificar.js";
import { invalido } from "../util.js";

export function periodoDe(texto) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(texto ?? ""));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw invalido("Informe o período no formato AAAA-MM.");
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { codigo: `${m[1]}-${m[2]}`, ini: `${m[1]}-${m[2]}-01`, fim: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, "0")}` };
}

export function configSped(empresa) {
  const c = empresa.sped ?? {};
  return {
    perfil: c.perfil === "A" ? "A" : "B",
    atividade: c.atividade === "0" ? "0" : "1",
    ind_classif: c.ind_classif ?? "",
    contabilista: c.contabilista ?? {},
    cod_receita: c.cod_receita ?? "",
    cod_receita_st: c.cod_receita_st ?? "",
    cod_receita_difal: c.cod_receita_difal ?? "",
    dia_vencimento: Number(c.dia_vencimento) || 20,
    saldo_credor_inicial_cent: Math.max(0, Math.round(Number(c.saldo_credor_inicial_cent) || 0)),
    incluir_homologacao: !!c.incluir_homologacao,
  };
}

/** Saldo credor do mês anterior: o último arquivo gerado dele, ou o saldo inicial configurado. */
export async function saldoAnterior(db, empresa, periodo) {
  const d = new Date(`${periodo.ini}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const ant = d.toISOString().slice(0, 7);
  const r = await db.one(
    "SELECT saldo_credor_transportar_cent FROM sped_arquivos WHERE empresa_id = $1 AND periodo = $2 ORDER BY gerado_em DESC LIMIT 1",
    [empresa.id, ant]
  );
  return r ? { cent: Number(r.saldo_credor_transportar_cent), origem: `arquivo de ${ant.slice(5)}/${ant.slice(0, 4)}` } : { cent: configSped(empresa).saldo_credor_inicial_cent, origem: "saldo inicial da configuração" };
}

/**
 * Monta a escrituração do período. Devolve { erros, alertas, efd? } — efd só quando não há erro.
 * opcoes: { perfil?, finalidade?, saldoCredorAnteriorCent? }
 */
export async function prepararEfd(db, empresa, periodo, opcoes = {}) {
  const config = { ...configSped(empresa), ...(opcoes.perfil ? { perfil: opcoes.perfil === "A" ? "A" : "B" } : {}) };
  const erros = [];
  const alertas = [];

  // ---- empresa e configuração ----
  if (empresa.crt === "1") {
    erros.push("A empresa é do Simples Nacional (CRT 1): ela não entrega a EFD ICMS/IPI, salvo excesso de sublimite ou exigência da UF. A geração está bloqueada.");
  }
  if (!String(empresa.ie ?? "").replace(/\D/g, "")) erros.push("A empresa está sem inscrição estadual (Configurações → Empresa).");
  const ct = config.contabilista;
  if (!ct.nome || !String(ct.cpf ?? "").replace(/\D/g, "") || !ct.crc || !ct.cod_municipio) {
    erros.push("Preencha o contabilista (nome, CPF, CRC e município) na configuração do SPED: o registro 0100 é obrigatório.");
  }
  if (config.atividade === "0" && !/^\d{2}$/.test(config.ind_classif)) {
    erros.push("Estabelecimento industrial: informe a classificação do estabelecimento (registro 0002) na configuração do SPED.");
  }

  // ---- saídas: notas emitidas no período ----
  const ambientes = config.incluir_homologacao ? [1, 2] : [1];
  const notas = await db.many(
    `SELECT * FROM notas WHERE empresa_id = $1 AND emitida_em >= $2::date AND emitida_em < ($3::date + 1) ORDER BY emitida_em, id`,
    [empresa.id, periodo.ini, periodo.fim]
  );
  const homolog = notas.filter((n) => !ambientes.includes(n.ambiente));
  if (homolog.length) alertas.push(`${homolog.length} nota(s) de homologação no período ficaram fora do arquivo (não têm valor fiscal).`);
  const validas = notas.filter((n) => ambientes.includes(n.ambiente));
  const indefinidas = validas.filter((n) => ["pendente", "enviando"].includes(n.status));
  for (const n of indefinidas) erros.push(`${n.modelo === "65" ? "NFC-e" : "NF-e"} ${n.serie}-${n.numero} está "${n.status}": consulte a SEFAZ antes de gerar o SPED.`);
  const situacao = { autorizada: "00", cancelada: "02", denegada: "04" };
  const saidas = [];
  for (const n of validas) {
    const sit = situacao[n.status];
    if (!sit) continue; // rejeitada / não enviada: não existe para a SEFAZ (a numeração é tratada pela inutilização)
    let nfe = null;
    try {
      nfe = lerNfe(n.xml_autorizado ?? n.xml_assinado);
    } catch (e) {
      erros.push(`Não foi possível ler o XML da nota ${n.serie}-${n.numero}: ${e.message}`);
      continue;
    }
    const cliente = n.cliente_id ? await db.one("SELECT uf FROM pessoas WHERE id = $1", [n.cliente_id]) : null;
    saidas.push({ situacao: sit, mod: n.modelo, serie: n.serie, numero: n.numero, chave: n.chave, nfe, uf_dest: nfe.dest?.uf || cliente?.uf || empresa.uf });
  }
  // Numeração inutilizada homologada no período: um C100 (COD_SIT 05) por número.
  const inut = await db.many(
    `SELECT * FROM inutilizacoes WHERE empresa_id = $1 AND status = 'homologada' AND ambiente = ANY($4)
       AND criado_em >= $2::date AND criado_em < ($3::date + 1) ORDER BY id`,
    [empresa.id, periodo.ini, periodo.fim, ambientes]
  );
  for (const i of inut) {
    for (let k = i.numero_inicial; k <= i.numero_final; k++) {
      saidas.push({ situacao: "05", mod: i.modelo, serie: i.serie, numero: k, chave: "", nfe: null });
    }
  }

  // ---- entradas: notas de compra com data de entrada no período ----
  const ents = await db.many(
    `SELECT * FROM entradas_xml WHERE empresa_id = $1
       AND coalesce(data_entrada, (criado_em AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN $2::date AND $3::date ORDER BY id`,
    [empresa.id, periodo.ini, periodo.fim]
  );
  const entradas = [];
  const aConferir = [];
  for (const x of ents) {
    await db.tx((q) => garantirItens(q, empresa, x));
    const atual = await db.one("SELECT * FROM entradas_xml WHERE id = $1", [x.id]);
    let nfe;
    try {
      nfe = lerNfe(atual.xml);
    } catch (e) {
      erros.push(`Não foi possível ler o XML da nota de entrada ${atual.numero}: ${e.message}`);
      continue;
    }
    if (!atual.classificada) aConferir.push(`${nfe.numero} (${nfe.emit?.nome ?? ""})`);
    const linhas = await db.many(
      `SELECT i.*, p.codigo, p.descricao AS p_descricao, p.ean, p.unidade, p.tipo_item, p.ncm, p.cest, v.fator
         FROM entrada_itens i LEFT JOIN produtos p ON p.id = i.produto_id
         LEFT JOIN vinculos_fornecedor v ON v.empresa_id = $2 AND v.fornecedor_cnpj = $3 AND v.codigo_fornecedor = i.codigo_fornecedor
        WHERE i.entrada_id = $1`,
      [atual.id, empresa.id, nfe.emit?.cnpj || nfe.emit?.cpf || ""]
    );
    const itens = new Map(linhas.map((r) => [r.num_item, {
      classificacao: { destino: r.destino, cfop: r.cfop, cst_icms: r.cst_icms, credito_icms: r.credito_icms, credito_ipi: r.credito_ipi, tipo_item: DESTINOS[r.destino]?.tipo_item ?? "99" },
      produto: r.produto_id ? { codigo: r.codigo, descricao: r.p_descricao, ean: r.ean, unidade: r.unidade, tipo_item: r.tipo_item, ncm: r.ncm, cest: r.cest } : null,
      fator: Number(r.fator) || 1,
    }]));
    if (nfe.itens.some((it) => !itens.has(it.num))) {
      erros.push(`A nota de entrada ${nfe.numero} tem item sem classificação.`);
      continue;
    }
    if (nfe.dt_emissao && atual.data_entrada && String(atual.data_entrada) < nfe.dt_emissao) {
      erros.push(`A nota de entrada ${nfe.numero} tem data de entrada anterior à emissão.`);
    }
    entradas.push({ nfe, data_entrada: String(atual.data_entrada), itens });
  }
  if (aConferir.length) {
    alertas.push(`${aConferir.length} nota(s) de entrada com classificação sugerida e ainda não conferida: ${aConferir.slice(0, 5).join(", ")}${aConferir.length > 5 ? "…" : ""}. Confira em Entradas (SPED).`);
  }

  const produtos = new Map((await db.many("SELECT * FROM produtos WHERE empresa_id = $1", [empresa.id])).map((p) => [p.codigo, p]));
  const saldo = opcoes.saldoCredorAnteriorCent != null
    ? { cent: Math.max(0, Math.round(Number(opcoes.saldoCredorAnteriorCent) || 0)), origem: "informado na geração" }
    : await saldoAnterior(db, empresa, periodo);

  if (erros.length) return { erros, alertas, saldo_anterior: saldo };

  const efd = montarEfd({
    empresa, config, periodo, finalidade: opcoes.finalidade === "1" ? "1" : "0",
    saldoCredorAnteriorCent: saldo.cent, saidas, entradas, produtos,
  });
  if (efd.apuracao.icms_recolher_cent > 0 && !config.cod_receita) {
    return { erros: ["Há ICMS a recolher: informe o código de receita do ICMS (registro E116) na configuração do SPED."], alertas, saldo_anterior: saldo };
  }
  return { erros: [], alertas: [...alertas, ...efd.avisos.map((a) => a.texto)], saldo_anterior: saldo, efd, config };
}
