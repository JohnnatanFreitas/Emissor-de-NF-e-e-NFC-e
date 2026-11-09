// Motor de cálculo dos tributos de cada item a partir do perfil fiscal. Função pura (sem banco).
// Valores em centavos inteiros; alíquotas em %.
import { aliquotaInterestadual, ALIQ_INTERNA_UF } from "./perfis-padrao.js";
import { arred, soDigitos } from "../util.js";

const CST_PIS_ALIQ = new Set(["01", "02"]);
const CST_PIS_NT = new Set(["04", "05", "06", "07", "08", "09"]);
const CST_IPI_TRIB = new Set(["00", "49", "50", "99"]);

/** Situação da operação: destino, consumidor final, interestadual. */
export function contextoOperacao({ empresa, cliente, modelo }) {
  const doc = soDigitos(cliente?.cpf_cnpj);
  const interestadual = modelo === "55" && !!cliente?.uf && cliente.uf !== empresa.uf;
  const consumidorFinal = modelo === "65" || !cliente || doc.length === 11 || cliente.ind_ie_dest === "9";
  const naoContribuinte = modelo === "65" || !cliente || cliente.ind_ie_dest === "9";
  return { interestadual, consumidorFinal, naoContribuinte, ufDestino: cliente?.uf || empresa.uf };
}

function escolherCfop(perfil, modelo, ctx) {
  if (modelo === "65") return perfil.cfop_nfce;
  if (!ctx.interestadual) return perfil.cfop_interno;
  let cfop = String(perfil.cfop_interestadual);
  // Venda interestadual a não contribuinte: 6101 → 6107 e 6102 → 6108.
  if (ctx.naoContribuinte) cfop = { 6101: "6107", 6102: "6108" }[cfop] ?? cfop;
  return cfop;
}

const pct = (base, aliq) => arred((base * Number(aliq || 0)) / 100);

export function calcularItem({ empresa, perfil, modelo, ctx, quantidade, valor_unitario_cent, desconto_cent = 0 }) {
  const q = Number(quantidade);
  const vu = Math.round(Number(valor_unitario_cent));
  const valor = arred(q * vu);
  const desc = Math.min(Math.round(Number(desconto_cent || 0)), valor);
  const liquido = valor - desc;
  const simples = empresa.crt === "1";
  const cst = String(perfil.cst_icms);

  // IPI
  const cstIpi = perfil.cst_ipi || null;
  const ipi = cstIpi && CST_IPI_TRIB.has(cstIpi) ? pct(liquido, perfil.aliq_ipi) : 0;

  // ICMS próprio
  const aliqInter = Number(perfil.aliq_icms_interestadual) || aliquotaInterestadual(empresa.uf, ctx.ufDestino, perfil.origem);
  const aliq = ctx.interestadual ? aliqInter : Number(perfil.aliq_icms_interna);
  const baseCheia = liquido + (ctx.consumidorFinal ? ipi : 0);
  let bcIcms = 0;
  let icms = 0;
  let credSN = 0;
  let temST = false;
  let icmsProprioST = 0; // ICMS próprio que se deduz do ST

  if (simples) {
    if (cst === "101" || cst === "201") credSN = pct(liquido, aliq);
    if (["201", "202", "203"].includes(cst)) {
      temST = true;
      icmsProprioST = pct(liquido, aliq);
    }
    if (cst === "900" && aliq > 0) {
      bcIcms = baseCheia;
      icms = pct(bcIcms, aliq);
    }
  } else {
    if (["00", "90", "10"].includes(cst)) bcIcms = baseCheia;
    if (["20", "70"].includes(cst)) bcIcms = arred(baseCheia * (1 - Number(perfil.reducao_bc_icms || 0) / 100));
    if (bcIcms) icms = pct(bcIcms, aliq);
    if (["10", "70", "30"].includes(cst)) {
      temST = true;
      icmsProprioST = cst === "30" ? pct(baseCheia, aliq) : icms;
    }
  }

  // ICMS ST (MVA)
  let bcSt = 0;
  let icmsSt = 0;
  if (temST) {
    bcSt = arred((liquido + ipi) * (1 + Number(perfil.mva_st || 0) / 100));
    icmsSt = Math.max(0, pct(bcSt, perfil.aliq_icms_st) - icmsProprioST);
  }

  // DIFAL (EC 87/2015): regime normal, interestadual, consumidor final não contribuinte.
  let difal = null;
  if (!simples && ctx.interestadual && ctx.naoContribuinte && icms > 0) {
    const aliqDest = ALIQ_INTERNA_UF[ctx.ufDestino] ?? aliq;
    difal = {
      vBCUFDest: bcIcms,
      pICMSUFDest: aliqDest,
      pICMSInter: aliq,
      vICMSUFDest: Math.max(0, pct(bcIcms, aliqDest - aliq)),
    };
  }

  // PIS e COFINS (com o ICMS fora da base: Tema 69 do STF)
  const basePisCofins = Math.max(0, liquido - icms);
  const calcPC = (cstPC, aliqPC) => {
    if (CST_PIS_NT.has(cstPC)) return { bc: 0, valor: 0 };
    if (CST_PIS_ALIQ.has(cstPC) || Number(aliqPC) > 0) return { bc: basePisCofins, valor: pct(basePisCofins, aliqPC) };
    return { bc: 0, valor: 0 };
  };
  const pis = calcPC(String(perfil.cst_pis), perfil.aliq_pis);
  const cofins = calcPC(String(perfil.cst_cofins), perfil.aliq_cofins);

  // IBS e CBS (2026: alíquotas de teste, não somam no total da nota)
  let bcIbsCbs = 0;
  let ibsUf = 0;
  let ibsMun = 0;
  let cbs = 0;
  if (perfil.informar_ibscbs) {
    bcIbsCbs = Math.max(0, liquido - (perfil.ibscbs_base_liquida ? icms + pis.valor + cofins.valor : 0));
    ibsUf = pct(bcIbsCbs, perfil.aliq_ibs_uf);
    ibsMun = pct(bcIbsCbs, perfil.aliq_ibs_mun);
    cbs = pct(bcIbsCbs, perfil.aliq_cbs);
  }

  return {
    quantidade: q,
    valor_unitario_cent: vu,
    desconto_cent: desc,
    valor_cent: valor,
    cfop: escolherCfop(perfil, modelo, ctx),
    origem: String(perfil.origem ?? "0"),
    cst_icms: cst,
    bc_icms_cent: bcIcms,
    aliq_icms: bcIcms || credSN ? aliq : 0,
    reducao_bc_icms: Number(perfil.reducao_bc_icms || 0),
    icms_cent: icms,
    cred_sn_cent: credSN,
    bc_icms_st_cent: bcSt,
    mva_st: Number(perfil.mva_st || 0),
    aliq_icms_st: Number(perfil.aliq_icms_st || 0),
    icms_st_cent: icmsSt,
    difal,
    icms_uf_dest_cent: difal?.vICMSUFDest ?? 0,
    cst_ipi: cstIpi,
    aliq_ipi: Number(perfil.aliq_ipi || 0),
    ipi_cent: ipi,
    cst_pis: String(perfil.cst_pis),
    aliq_pis: Number(perfil.aliq_pis || 0),
    bc_pis_cent: pis.bc,
    pis_cent: pis.valor,
    cst_cofins: String(perfil.cst_cofins),
    aliq_cofins: Number(perfil.aliq_cofins || 0),
    bc_cofins_cent: cofins.bc,
    cofins_cent: cofins.valor,
    informar_ibscbs: !!perfil.informar_ibscbs,
    cst_ibscbs: perfil.cst_ibscbs,
    cclass_trib: perfil.cclass_trib,
    aliq_ibs_uf: Number(perfil.aliq_ibs_uf || 0),
    aliq_ibs_mun: Number(perfil.aliq_ibs_mun || 0),
    aliq_cbs: Number(perfil.aliq_cbs || 0),
    bc_ibscbs_cent: bcIbsCbs,
    ibs_uf_cent: ibsUf,
    ibs_mun_cent: ibsMun,
    ibs_cent: ibsUf + ibsMun,
    cbs_cent: cbs,
  };
}

const CAMPOS_TOTAL = [
  ["produtos_cent", "valor_cent"], ["desconto_cent", "desconto_cent"], ["bc_icms_cent", "bc_icms_cent"], ["icms_cent", "icms_cent"],
  ["bc_icms_st_cent", "bc_icms_st_cent"], ["icms_st_cent", "icms_st_cent"], ["icms_uf_dest_cent", "icms_uf_dest_cent"],
  ["ipi_cent", "ipi_cent"], ["pis_cent", "pis_cent"], ["cofins_cent", "cofins_cent"], ["bc_ibscbs_cent", "bc_ibscbs_cent"],
  ["ibs_uf_cent", "ibs_uf_cent"], ["ibs_mun_cent", "ibs_mun_cent"], ["ibs_cent", "ibs_cent"], ["cbs_cent", "cbs_cent"],
];

/**
 * @param {object} p
 * @param {Array} p.itens [{ produto, perfil, quantidade, valor_unitario_cent, desconto_cent }]
 */
export function calcularDocumento({ empresa, cliente, modelo, itens }) {
  const ctx = contextoOperacao({ empresa, cliente, modelo });
  const calculados = itens.map(({ produto, perfil, quantidade, valor_unitario_cent, desconto_cent }) => {
    if (!(Number(quantidade) > 0)) throw Object.assign(new Error(`Quantidade inválida no item ${produto.codigo}.`), { status: 422 });
    const vu = valor_unitario_cent ?? produto.preco_cent;
    return {
      produto_id: produto.id,
      codigo: produto.codigo,
      descricao: produto.descricao,
      ncm: produto.ncm,
      cest: produto.cest || "",
      ean: produto.ean || "",
      unidade: produto.unidade,
      ...calcularItem({ empresa, perfil, modelo, ctx, quantidade, valor_unitario_cent: vu, desconto_cent }),
    };
  });
  const totais = Object.fromEntries(CAMPOS_TOTAL.map(([t, i]) => [t, calculados.reduce((s, it) => s + it[i], 0)]));
  // vNF = produtos - desconto + ST + IPI (IBS/CBS não somam em 2026)
  totais.total_cent = totais.produtos_cent - totais.desconto_cent + totais.icms_st_cent + totais.ipi_cent;
  return { interestadual: ctx.interestadual, consumidor_final: ctx.consumidorFinal, nao_contribuinte: ctx.naoContribuinte, itens: calculados, totais };
}
