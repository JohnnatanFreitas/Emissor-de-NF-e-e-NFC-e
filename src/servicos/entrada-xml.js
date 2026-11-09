// Entrada de mercadoria pelo XML da nota de compra (nfeProc ou NFe do fornecedor).
import { XMLParser } from "fast-xml-parser";
import { invalido, soDigitos, centavos } from "../util.js";

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, isArray: (n) => n === "det" });

/** Lê o XML e devolve cabeçalho e itens com o custo de cada item (produto + IPI + ST + frete + outras - desconto). */
export function lerXmlCompra(xml) {
  const texto = String(xml ?? "");
  // NF-e nunca traz DOCTYPE/ENTITY; um arquivo com eles só serve para atacar o leitor de XML.
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) throw invalido("Arquivo XML recusado: não parece uma NF-e (tem DOCTYPE/ENTITY).");
  let j;
  try {
    j = parser.parse(texto);
  } catch {
    throw invalido("Arquivo XML ilegível.");
  }
  const nfe = j.nfeProc?.NFe ?? j.NFe;
  const inf = nfe?.infNFe;
  if (!inf?.ide || !inf?.emit) throw invalido("Este arquivo não é o XML de uma NF-e.");
  const chave = String(inf["@_Id"] ?? "").replace(/^NFe/, "");
  const t = inf.total?.ICMSTot ?? {};
  const itens = (inf.det ?? []).map((d, idx) => {
    const p = d.prod;
    const imp = d.imposto ?? {};
    const icms = Object.values(imp.ICMS ?? {})[0] ?? {};
    const ipi = centavos(imp.IPI?.IPITrib?.vIPI ?? 0);
    const st = centavos(icms.vICMSST ?? 0);
    const frete = centavos(p.vFrete ?? 0);
    const seguro = centavos(p.vSeg ?? 0);
    const outras = centavos(p.vOutro ?? 0);
    const desconto = centavos(p.vDesc ?? 0);
    const valor = centavos(p.vProd);
    return {
      indice: Number(d["@_nItem"] ?? idx + 1),
      codigo: String(p.cProd ?? ""),
      descricao: String(p.xProd ?? ""),
      ncm: soDigitos(p.NCM),
      ean: /^\d+$/.test(String(p.cEAN ?? "")) ? String(p.cEAN) : "",
      unidade: String(p.uCom ?? "UN").toUpperCase().slice(0, 6),
      quantidade: Number(p.qCom),
      valor_unitario_cent: Math.round(Number(p.vUnCom) * 100),
      valor_cent: valor,
      ipi_cent: ipi,
      icms_st_cent: st,
      frete_cent: frete,
      custo_total_cent: valor + ipi + st + frete + seguro + outras - desconto,
    };
  });
  return {
    chave,
    numero: String(inf.ide.nNF ?? ""),
    serie: String(inf.ide.serie ?? ""),
    emitida_em: inf.ide.dhEmi ?? inf.ide.dEmi ?? null,
    total_cent: centavos(t.vNF ?? 0),
    frete_cent: centavos(t.vFrete ?? 0),
    fornecedor: {
      cnpj: soDigitos(inf.emit.CNPJ ?? inf.emit.CPF),
      nome: String(inf.emit.xNome ?? ""),
      fantasia: String(inf.emit.xFant ?? ""),
      ie: soDigitos(inf.emit.IE),
      uf: String(inf.emit.enderEmit?.UF ?? ""),
      endereco: inf.emit.enderEmit ?? {},
    },
    destinatario_cnpj: soDigitos(inf.dest?.CNPJ ?? inf.dest?.CPF),
    itens,
  };
}
