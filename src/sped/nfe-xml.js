// Lê o XML de uma NF-e/NFC-e (nfeProc ou NFe) no formato que a EFD ICMS/IPI precisa.
// Serve para as duas pontas: notas emitidas pela empresa (saídas) e notas de compra (entradas).
// Dinheiro em centavos (inteiros); alíquotas e quantidades como número.
import { XMLParser } from "fast-xml-parser";
import { soDigitos } from "../util.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (n) => ["det", "dup", "detPag"].includes(n),
});

const cent = (v) => Math.round(Number(v ?? 0) * 100) || 0;
const num = (v) => Number(v ?? 0) || 0;
const str = (v) => (v == null ? "" : String(typeof v === "object" ? v["#text"] ?? "" : v));
const data = (v) => (v ? String(v).slice(0, 10) : null); // dhEmi já vem com o fuso do emitente

function pessoa(p) {
  if (!p) return null;
  const end = p.enderEmit ?? p.enderDest ?? {};
  return {
    cnpj: soDigitos(p.CNPJ),
    cpf: soDigitos(p.CPF),
    nome: str(p.xNome),
    ie: soDigitos(p.IE),
    uf: str(end.UF),
    cod_mun: soDigitos(end.cMun),
    logradouro: str(end.xLgr),
    numero: str(end.nro),
    complemento: str(end.xCpl),
    bairro: str(end.xBairro),
    cep: soDigitos(end.CEP),
    cod_pais: soDigitos(end.cPais) || "1058",
  };
}

function item(d) {
  const p = d.prod ?? {};
  const imp = d.imposto ?? {};
  // O grupo do ICMS vem como <ICMS><ICMS00>…</ICMS00></ICMS> (ou ICMSSN102 etc.).
  const icms = Object.values(imp.ICMS ?? {})[0] ?? {};
  const ipiTrib = imp.IPI?.IPITrib ?? null;
  const ipiNT = imp.IPI?.IPINT ?? null;
  return {
    num: Number(d["@_nItem"]),
    cProd: str(p.cProd),
    xProd: str(p.xProd),
    ncm: soDigitos(p.NCM),
    cest: soDigitos(p.CEST),
    ean: /^\d+$/.test(str(p.cEAN)) ? str(p.cEAN) : "",
    cfop: soDigitos(p.CFOP),
    uCom: str(p.uCom).toUpperCase().trim() || "UN",
    qCom: num(p.qCom),
    vProd: cent(p.vProd),
    vDesc: cent(p.vDesc),
    vFrete: cent(p.vFrete),
    vSeg: cent(p.vSeg),
    vOutro: cent(p.vOutro),
    orig: str(icms.orig) || "0",
    cst: str(icms.CST), // regime normal (2 dígitos)
    csosn: str(icms.CSOSN), // Simples Nacional (3 dígitos)
    vBC: cent(icms.vBC),
    pICMS: num(icms.pICMS),
    vICMS: cent(icms.vICMS),
    pRedBC: num(icms.pRedBC),
    vBCST: cent(icms.vBCST),
    pICMSST: num(icms.pICMSST),
    vICMSST: cent(icms.vICMSST),
    vCredICMSSN: cent(icms.vCredICMSSN),
    ipi: {
      cst: str(ipiTrib?.CST ?? ipiNT?.CST),
      cEnq: str(imp.IPI?.cEnq),
      vBC: cent(ipiTrib?.vBC),
      pIPI: num(ipiTrib?.pIPI),
      vIPI: cent(ipiTrib?.vIPI),
    },
    vFCPUFDest: cent(imp.ICMSUFDest?.vFCPUFDest),
    vICMSUFDest: cent(imp.ICMSUFDest?.vICMSUFDest),
    vICMSUFRemet: cent(imp.ICMSUFDest?.vICMSUFRemet),
  };
}

/** Lê o XML e devolve a nota no formato da escrituração. Lança Error se não for NF-e. */
export function lerNfe(xml) {
  const texto = String(xml ?? "");
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) throw new Error("XML com DOCTYPE/ENTITY recusado.");
  const j = parser.parse(texto);
  const inf = (j.nfeProc?.NFe ?? j.NFe)?.infNFe;
  if (!inf?.ide) throw new Error("O arquivo não é o XML de uma NF-e.");
  const ide = inf.ide;
  const t = inf.total?.ICMSTot ?? {};
  return {
    chave: String(inf["@_Id"] ?? "").replace(/\D/g, "").slice(-44),
    mod: str(ide.mod) || "55",
    serie: str(ide.serie),
    numero: str(ide.nNF),
    tpNF: str(ide.tpNF),
    dt_emissao: data(ide.dhEmi ?? ide.dEmi),
    dt_saida_entrada: data(ide.dhSaiEnt ?? ide.dSaiEnt),
    crt: str(inf.emit?.CRT),
    emit: pessoa(inf.emit),
    dest: pessoa(inf.dest),
    mod_frete: str(inf.transp?.modFrete) || "9",
    a_prazo: (inf.cobr?.dup ?? []).length > 0,
    total: {
      vProd: cent(t.vProd),
      vDesc: cent(t.vDesc),
      vFrete: cent(t.vFrete),
      vSeg: cent(t.vSeg),
      vOutro: cent(t.vOutro),
      vNF: cent(t.vNF),
      vBC: cent(t.vBC),
      vICMS: cent(t.vICMS),
      vBCST: cent(t.vBCST),
      vST: cent(t.vST),
      vIPI: cent(t.vIPI),
      vPIS: cent(t.vPIS),
      vCOFINS: cent(t.vCOFINS),
      vFCPUFDest: cent(t.vFCPUFDest),
      vICMSUFDest: cent(t.vICMSUFDest),
      vICMSUFRemet: cent(t.vICMSUFRemet),
    },
    itens: (inf.det ?? []).map(item),
  };
}
