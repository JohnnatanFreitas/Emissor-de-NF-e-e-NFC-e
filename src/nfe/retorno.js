// Lê as respostas da SEFAZ (que a lib devolve como texto XML) e traduz em situações.
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });

// Procura o primeiro nó com esse nome em qualquer profundidade.
function achar(no, nome) {
  if (no == null || typeof no !== "object") return undefined;
  if (Object.hasOwn(no, nome)) return no[nome];
  for (const valor of Object.values(no)) {
    const r = achar(valor, nome);
    if (r !== undefined) return r;
  }
  return undefined;
}

const texto = (v) => (v == null ? null : String(typeof v === "object" ? v["#text"] ?? "" : v));

function lerProtocolo(json, xml) {
  const infProt = achar(achar(json, "protNFe"), "infProt");
  if (!infProt) return null;
  return {
    cStat: texto(infProt.cStat),
    xMotivo: texto(infProt.xMotivo),
    protocolo: texto(infProt.nProt),
    chave: texto(infProt.chNFe),
    // Trecho original do protocolo, para montar o nfeProc sem reserializar.
    protNFeXml: xml.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? null,
  };
}

const AUTORIZADA = ["100", "150"];
const DENEGADA = ["110", "301", "302", "303"];
const CANCELADA = ["101", "151", "155"];

/** Resposta do envio do lote (retEnviNFe). */
export function interpretarEnvio(xml) {
  const json = parser.parse(xml);
  const prot = lerProtocolo(json, xml);
  if (prot) {
    const situacao = AUTORIZADA.includes(prot.cStat) ? "autorizada" : DENEGADA.includes(prot.cStat) ? "denegada" : "rejeitada";
    return { situacao, ...prot };
  }
  const cStat = texto(achar(json, "cStat"));
  const xMotivo = texto(achar(json, "xMotivo"));
  // 103 = lote recebido e ainda em processamento: só a consulta pela chave resolve.
  if (cStat === "103" || cStat === "105") return { situacao: "em_processamento", cStat, xMotivo };
  if (cStat == null) return { situacao: "sem_resposta", cStat: null, xMotivo: "Resposta da SEFAZ sem cStat", resposta: xml.slice(0, 500) };
  return { situacao: "rejeitada", cStat, xMotivo };
}

/** Resposta da consulta pela chave (retConsSitNFe). */
export function interpretarConsulta(xml) {
  const json = parser.parse(xml);
  const cStat = texto(achar(json, "cStat"));
  const xMotivo = texto(achar(json, "xMotivo"));
  const prot = lerProtocolo(json, xml);
  if (AUTORIZADA.includes(cStat) && prot) return { situacao: "autorizada", ...prot };
  if (CANCELADA.includes(cStat)) return { situacao: "cancelada", cStat, xMotivo, protocolo: prot?.protocolo ?? null };
  if (DENEGADA.includes(cStat)) return { situacao: "denegada", cStat, xMotivo };
  if (cStat === "217") return { situacao: "nao_encontrada", cStat, xMotivo }; // NF-e não consta na base
  return { situacao: "indefinida", cStat, xMotivo };
}

/** Resposta do envio de evento (retEnvEvento). */
export function interpretarEvento(xml) {
  const json = parser.parse(xml);
  const inf = achar(achar(json, "retEvento"), "infEvento");
  const cStat = texto(inf?.cStat ?? achar(json, "cStat"));
  const xMotivo = texto(inf?.xMotivo ?? achar(json, "xMotivo"));
  // 135 registrado; 136 registrado sem vínculo; 155 cancelamento fora do prazo homologado.
  return { registrado: ["135", "136", "155"].includes(cStat), cStat, xMotivo, protocolo: texto(inf?.nProt) };
}

/** Resposta da inutilização (retInutNFe). 102 homologada; 563 a mesma faixa já estava inutilizada. */
export function interpretarInutilizacao(xml) {
  const json = parser.parse(xml);
  const inf = achar(achar(json, "retInutNFe"), "infInut") ?? achar(json, "infInut");
  const cStat = texto(inf?.cStat ?? achar(json, "cStat"));
  const xMotivo = texto(inf?.xMotivo ?? achar(json, "xMotivo"));
  if (cStat == null) return { situacao: "sem_resposta", cStat: null, xMotivo: "Resposta da SEFAZ sem cStat", protocolo: null };
  const situacao = ["102", "563"].includes(cStat) ? "homologada" : "rejeitada";
  return { situacao, cStat, xMotivo, protocolo: texto(inf?.nProt) };
}

/** Junta a NF-e assinada e o protocolo no arquivo de distribuição (nfeProc). */
export function montarNfeProc(xmlAssinado, protNFeXml) {
  const nfe = xmlAssinado.replace(/^<\?xml[^>]*>\s*/, "").match(/<NFe[\s\S]*<\/NFe>/)?.[0];
  if (!nfe || !protNFeXml) throw new Error("Faltou a NF-e assinada ou o protocolo para montar o nfeProc.");
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfe}${protNFeXml}</nfeProc>`;
}
