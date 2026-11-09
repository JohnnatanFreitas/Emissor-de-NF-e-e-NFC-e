// Transforma o cálculo (fiscal/calculo.js) no XML da NF-e (55) ou NFC-e (65) com o Make do node-sped-nfe.
// Função pura: não fala com banco nem com a SEFAZ. A ordem das chamadas segue a ordem do schema,
// porque o Make monta o XML na ordem em que os grupos são criados.
import { Make, UF2cUF } from "node-sped-nfe";
import crypto from "node:crypto";
import { reais, soDigitos } from "../util.js";

export const NOME_HOMOLOGACAO = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

const p2 = (v) => Number(v || 0).toFixed(2);
const p4 = (v) => Number(v || 0).toFixed(4);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function gerarCNF(numero) {
  let cnf;
  do cnf = String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
  while (Number(cnf) === Number(numero));
  return cnf;
}

function grupoICMS(nfe, i, it, simples) {
  const orig = it.origem;
  if (simples) {
    const c = it.cst_icms;
    const st = { modBCST: "4", pMVAST: p2(it.mva_st), vBCST: reais(it.bc_icms_st_cent), pICMSST: p2(it.aliq_icms_st), vICMSST: reais(it.icms_st_cent) };
    const cred = { pCredSN: p2(it.aliq_icms), vCredICMSSN: reais(it.cred_sn_cent) };
    const g = { orig, CSOSN: c };
    if (c === "101") Object.assign(g, cred);
    else if (c === "201") Object.assign(g, st, cred);
    else if (c === "202" || c === "203") Object.assign(g, st);
    else if (c === "900" && it.bc_icms_cent) Object.assign(g, { modBC: "3", vBC: reais(it.bc_icms_cent), pICMS: p2(it.aliq_icms), vICMS: reais(it.icms_cent) });
    nfe.tagProdICMSSN(i, g);
    return;
  }
  const c = it.cst_icms;
  const proprio = { modBC: "3", vBC: reais(it.bc_icms_cent), pICMS: p2(it.aliq_icms), vICMS: reais(it.icms_cent) };
  const reduzido = { modBC: "3", pRedBC: p2(it.reducao_bc_icms), vBC: reais(it.bc_icms_cent), pICMS: p2(it.aliq_icms), vICMS: reais(it.icms_cent) };
  const st = { modBCST: "4", pMVAST: p2(it.mva_st), vBCST: reais(it.bc_icms_st_cent), pICMSST: p2(it.aliq_icms_st), vICMSST: reais(it.icms_st_cent) };
  const g = { orig, CST: c };
  if (c === "00" || c === "90") Object.assign(g, proprio);
  else if (c === "10") Object.assign(g, proprio, st);
  else if (c === "20") Object.assign(g, reduzido);
  else if (c === "30") Object.assign(g, st);
  else if (c === "70") Object.assign(g, reduzido, st);
  nfe.tagProdICMS(i, g);
}

function grupoPisCofins(nfe, i, it) {
  const pis = { CST: it.cst_pis };
  if (!["04", "05", "06", "07", "08", "09"].includes(it.cst_pis)) Object.assign(pis, { vBC: reais(it.bc_pis_cent), pPIS: p4(it.aliq_pis), vPIS: reais(it.pis_cent) });
  nfe.tagProdPIS(i, pis);
  const cof = { CST: it.cst_cofins };
  if (!["04", "05", "06", "07", "08", "09"].includes(it.cst_cofins)) Object.assign(cof, { vBC: reais(it.bc_cofins_cent), pCOFINS: p4(it.aliq_cofins), vCOFINS: reais(it.cofins_cent) });
  nfe.tagProdCOFINS(i, cof);
}

function grupoIBSCBS(nfe, i, it) {
  nfe.tagProdIBSCBS(i, {
    CST: it.cst_ibscbs,
    cClassTrib: it.cclass_trib,
    gIBSCBS: {
      vBC: reais(it.bc_ibscbs_cent),
      gIBSUF: { pIBSUF: p4(it.aliq_ibs_uf), vIBSUF: reais(it.ibs_uf_cent) },
      gIBSMun: { pIBSMun: p4(it.aliq_ibs_mun), vIBSMun: reais(it.ibs_mun_cent) },
      vIBS: reais(it.ibs_cent),
      gCBS: { pCBS: p4(it.aliq_cbs), vCBS: reais(it.cbs_cent) },
    },
  });
}

function totalNota(calc) {
  const t = calc.totais;
  const temDifal = calc.itens.some((it) => it.difal);
  const ICMSTot = {
    vBC: reais(t.bc_icms_cent),
    vICMS: reais(t.icms_cent),
    vICMSDeson: "0.00",
    ...(temDifal ? { vFCPUFDest: "0.00", vICMSUFDest: reais(t.icms_uf_dest_cent), vICMSUFRemet: "0.00" } : {}),
    vFCP: "0.00",
    vBCST: reais(t.bc_icms_st_cent),
    vST: reais(t.icms_st_cent),
    vFCPST: "0.00",
    vFCPSTRet: "0.00",
    vProd: reais(t.produtos_cent),
    vFrete: "0.00",
    vSeg: "0.00",
    vDesc: reais(t.desconto_cent),
    vII: "0.00",
    vIPI: reais(t.ipi_cent),
    vIPIDevol: "0.00",
    vPIS: reais(t.pis_cent),
    vCOFINS: reais(t.cofins_cent),
    vOutro: "0.00",
    vNF: reais(t.total_cent),
  };
  const total = { ICMSTot };
  if (calc.itens.some((it) => it.informar_ibscbs)) {
    total.IBSCBSTot = {
      vBCIBSCBS: reais(t.bc_ibscbs_cent),
      gIBS: {
        gIBSUF: { vDif: "0.00", vDevTrib: "0.00", vIBSUF: reais(t.ibs_uf_cent) },
        gIBSMun: { vDif: "0.00", vDevTrib: "0.00", vIBSMun: reais(t.ibs_mun_cent) },
        vIBS: reais(t.ibs_cent),
        vCredPres: "0.00",
        vCredPresCondSus: "0.00",
      },
      gCBS: { vDif: "0.00", vDevTrib: "0.00", vCBS: reais(t.cbs_cent), vCredPres: "0.00", vCredPresCondSus: "0.00" },
    };
  }
  return total;
}

/**
 * @param {object} p
 * @param {object} p.empresa
 * @param {object|null} p.cliente  pessoa (NF-e) ou { cpf_cnpj, nome } (NFC-e) ou null
 * @param {object} p.calculo       saída de calcularDocumento
 * @param {Array}  p.pagamentos    [{ tPag, valor_cent }]
 * @param {Array}  [p.duplicatas]  [{ numero, vencimento, valor_cent }]
 * @param {object} p.nota          { modelo, serie, numero, ambiente, natureza, cNF?, dhEmi?, infCpl? }
 * @param {object} [p.respTec]     { CNPJ, xContato, email, fone }
 */
export function montarXml({ empresa, cliente, calculo, pagamentos, duplicatas = [], nota, respTec }) {
  if (!calculo.itens.length) throw Object.assign(new Error("A nota precisa de pelo menos um item."), { status: 422 });
  const cUF = UF2cUF[empresa.uf];
  if (!cUF) throw Object.assign(new Error(`UF do emitente inválida: ${empresa.uf}`), { status: 422 });
  const nfce = nota.modelo === "65";
  const homologacao = Number(nota.ambiente) === 2;
  const simples = empresa.crt === "1";
  const doc = soDigitos(cliente?.cpf_cnpj);

  const nfe = new Make();
  nfe.tagInfNFe({ Id: null, versao: "4.00" });
  nfe.tagIde({
    cUF,
    cNF: nota.cNF ?? gerarCNF(nota.numero),
    natOp: nota.natureza ?? "VENDA",
    mod: nota.modelo,
    serie: String(nota.serie),
    nNF: String(nota.numero),
    dhEmi: nota.dhEmi ?? nfe.formatData(),
    tpNF: "1",
    idDest: calculo.interestadual ? "2" : "1",
    cMunFG: empresa.cod_municipio,
    tpImp: nfce ? "4" : "1",
    tpEmis: "1",
    cDV: "0",
    tpAmb: String(nota.ambiente),
    finNFe: "1",
    indFinal: calculo.consumidor_final ? "1" : "0",
    indPres: "1",
    indIntermed: "0",
    procEmi: "0",
    verProc: "Argus-Emissor 1.0",
  });

  // O Make só cria o endereço do emitente quando recebe xFant (sem ele o tagEnderEmit quebra).
  nfe.tagEmit({
    CNPJ: soDigitos(empresa.cnpj),
    xNome: empresa.razao_social,
    xFant: empresa.nome_fantasia || empresa.razao_social,
    IE: soDigitos(empresa.ie),
    CRT: empresa.crt,
  });
  nfe.tagEnderEmit({
    xLgr: empresa.logradouro,
    nro: empresa.numero,
    ...(empresa.complemento ? { xCpl: empresa.complemento } : {}),
    xBairro: empresa.bairro,
    cMun: empresa.cod_municipio,
    xMun: empresa.municipio,
    UF: empresa.uf,
    CEP: soDigitos(empresa.cep),
    cPais: "1058",
    xPais: "BRASIL",
    ...(soDigitos(empresa.fone) ? { fone: soDigitos(empresa.fone) } : {}),
  });

  if (nfce) {
    // NFC-e: destinatário opcional, só CPF/CNPJ (consumidor identificado).
    if (doc) {
      nfe.tagDest({
        ...(doc.length === 11 ? { CPF: doc } : { CNPJ: doc }),
        ...(homologacao ? { xNome: NOME_HOMOLOGACAO } : cliente?.nome ? { xNome: cliente.nome } : {}),
        indIEDest: "9",
      });
    }
  } else {
    nfe.tagDest({
      ...(doc.length === 11 ? { CPF: doc } : { CNPJ: doc }),
      // Em homologação a SEFAZ exige este texto no nome do destinatário.
      xNome: homologacao ? NOME_HOMOLOGACAO : cliente.nome,
      indIEDest: cliente.ind_ie_dest,
      ...(cliente.ind_ie_dest === "1" && cliente.ie ? { IE: soDigitos(cliente.ie) } : {}),
      ...(cliente.email ? { email: cliente.email } : {}),
    });
    nfe.tagEnderDest({
      xLgr: cliente.logradouro,
      nro: cliente.numero || "S/N",
      ...(cliente.complemento ? { xCpl: cliente.complemento } : {}),
      xBairro: cliente.bairro,
      cMun: cliente.cod_municipio,
      xMun: cliente.municipio,
      UF: cliente.uf,
      CEP: soDigitos(cliente.cep),
      cPais: "1058",
      xPais: "BRASIL",
      ...(soDigitos(cliente.fone) ? { fone: soDigitos(cliente.fone) } : {}),
    });
  }

  nfe.tagProd(
    calculo.itens.map((it) => ({
      cProd: it.codigo,
      cEAN: it.ean || "SEM GTIN",
      xProd: it.descricao,
      NCM: soDigitos(it.ncm),
      ...(it.cest ? { CEST: soDigitos(it.cest) } : {}),
      CFOP: it.cfop,
      uCom: it.unidade,
      qCom: it.quantidade,
      vUnCom: reais(it.valor_unitario_cent),
      vProd: reais(it.valor_cent),
      cEANTrib: it.ean || "SEM GTIN",
      uTrib: it.unidade,
      qTrib: it.quantidade,
      vUnTrib: reais(it.valor_unitario_cent),
      ...(it.desconto_cent ? { vDesc: reais(it.desconto_cent) } : {}),
      indTot: "1",
    }))
  );

  calculo.itens.forEach((it, i) => {
    grupoICMS(nfe, i, it, simples);
    if (!nfce && it.cst_ipi) {
      const trib = ["00", "49", "50", "99"].includes(it.cst_ipi);
      nfe.tagProdIPI(i, { cEnq: "999", CST: it.cst_ipi, ...(trib ? { vBC: reais(it.valor_cent - it.desconto_cent), pIPI: p2(it.aliq_ipi), vIPI: reais(it.ipi_cent) } : {}) });
    }
    grupoPisCofins(nfe, i, it);
    if (it.difal) {
      nfe.tagProdICMSUFDest(i, {
        vBCUFDest: reais(it.difal.vBCUFDest),
        vBCFCPUFDest: reais(it.difal.vBCUFDest),
        pFCPUFDest: "0.00",
        pICMSUFDest: p2(it.difal.pICMSUFDest),
        pICMSInter: p2(it.difal.pICMSInter),
        pICMSInterPart: "100.00",
        vFCPUFDest: "0.00",
        vICMSUFDest: reais(it.difal.vICMSUFDest),
        vICMSUFRemet: "0.00",
      });
    }
    if (it.informar_ibscbs) grupoIBSCBS(nfe, i, it);
  });

  nfe.tagTotal(totalNota(calculo), true);
  nfe.tagTransp({ modFrete: "9" });

  const totalCent = calculo.totais.total_cent;
  const pags = pagamentos?.length ? pagamentos : [{ tPag: "01", valor_cent: totalCent }];
  const semPagamento = pags.length === 1 && pags[0].tPag === "90";
  const somaPag = pags.reduce((s, p) => s + Math.round(p.valor_cent), 0);
  if (!semPagamento && somaPag < totalCent) {
    throw Object.assign(new Error(`Os pagamentos somam ${reais(somaPag)}, menos que o total da nota (${reais(totalCent)}).`), { status: 422 });
  }
  nfe.tagDetPag(
    pags.map((p) => ({
      indPag: p.tPag === "15" || duplicatas.length > 1 ? "1" : "0",
      tPag: p.tPag,
      vPag: semPagamento ? "0.00" : reais(p.valor_cent),
      ...(["03", "04", "17"].includes(p.tPag) ? { card: { tpIntegra: "2" } } : {}),
    }))
  );
  if (!semPagamento && somaPag > totalCent) nfe.tagTroco(reais(somaPag - totalCent));

  const infCpl = [nota.infCpl, simples ? "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL." : null].filter(Boolean).join(" ");
  if (infCpl) nfe.tagInfAdic({ infCpl: infCpl.slice(0, 5000) });
  if (respTec?.CNPJ) {
    nfe.tagInfRespTec({ CNPJ: respTec.CNPJ, xContato: respTec.xContato, email: respTec.email, fone: respTec.fone });
  }

  let xml = nfe.xml();
  // O Make não implementa cobr/fat/dup: o grupo entra pronto antes do <pag>.
  if (!nfce && duplicatas.length) {
    const nFat = String(nota.numero);
    const cobr =
      `<cobr><fat><nFat>${nFat}</nFat><vOrig>${reais(totalCent)}</vOrig><vDesc>0.00</vDesc><vLiq>${reais(totalCent)}</vLiq></fat>` +
      duplicatas.map((d) => `<dup><nDup>${esc(d.numero)}</nDup><dVenc>${d.vencimento}</dVenc><vDup>${reais(d.valor_cent)}</vDup></dup>`).join("") +
      `</cobr>`;
    xml = xml.replace("<pag>", `${cobr}<pag>`);
  }
  const chave = xml.match(/Id="NFe(\d{44})"/)?.[1];
  if (!chave) throw new Error("O Make não gerou a chave de acesso.");
  return { xml, chave };
}

/** QR Code v2 da NFC-e (emissão normal): url?p=chave|2|tpAmb|idCSC|hash. Usado no modo simulado. */
export function preencherQrCodeNfce(xml, cscId, csc) {
  const chave = xml.match(/Id="NFe(\d{44})"/)?.[1];
  const tpAmb = xml.match(/<tpAmb>(\d)<\/tpAmb>/)?.[1];
  const base = xml.match(/<qrCode>([^<]*)<\/qrCode>/)?.[1];
  if (!chave || !base) return xml;
  const concat = [chave, "2", tpAmb, Number(cscId || 0)].join("|");
  const hash = crypto.createHash("sha1").update(concat + (csc || "")).digest("hex").toUpperCase();
  return xml.replace(/<qrCode>[^<]*<\/qrCode>/, `<qrCode>${base}?p=${concat}|${hash}</qrCode>`);
}
