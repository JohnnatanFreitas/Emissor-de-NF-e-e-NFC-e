// Classificação fiscal da mercadoria que entra: o destino dela (revenda, industrialização, uso e
// consumo, ativo) decide o CFOP de entrada, o direito a crédito e o tipo do item no 0200.
//
// Regra do CFOP (conferida em 90 XML reais no Argus SPED Builder): a nota traz o CFOP de quem
// emitiu. Quem recebe troca só o primeiro dígito (5→1, 6→2, 7→3); os três últimos são a
// classificação de quem escritura e vêm do destino escolhido aqui.
import { invalido } from "../util.js";

export const DESTINOS = {
  revenda: { rotulo: "Revenda", tipo_item: "00", final: "102", final_st: "403", credita: true },
  industrializacao: { rotulo: "Industrialização (insumo)", tipo_item: "01", final: "101", final_st: "401", credita: true },
  uso_consumo: { rotulo: "Uso e consumo", tipo_item: "07", final: "556", final_st: "407", credita: false },
  ativo: { rotulo: "Ativo imobilizado", tipo_item: "08", final: "551", final_st: "406", credita: false },
  outros: { rotulo: "Outras entradas", tipo_item: "99", final: "949", final_st: "949", credita: false },
};

const DESTINO_DO_TIPO = { "00": "revenda", "01": "industrializacao", "02": "industrializacao", "03": "industrializacao", "04": "revenda", "06": "industrializacao", "07": "uso_consumo", "08": "ativo" };

/** O item veio com ICMS-ST (retido pelo fornecedor ou cobrado anteriormente)? */
export function temSt(it) {
  if (it.vICMSST > 0) return true;
  if (["10", "30", "60", "70"].includes(it.cst)) return true;
  if (["201", "202", "203", "500"].includes(it.csosn)) return true;
  return /^[567]40[1-9]$/.test(it.cfop);
}

/** Primeiro dígito do CFOP de entrada: 1 mesma UF, 2 outra UF, 3 exterior. */
export function prefixoEntrada(cfopEmitente, ufEmitente, ufEmpresa) {
  const d = String(cfopEmitente ?? "")[0];
  if (d === "5" || d === "1") return "1";
  if (d === "6" || d === "2") return "2";
  if (d === "7" || d === "3") return "3";
  return ufEmitente && ufEmpresa && ufEmitente !== ufEmpresa ? "2" : "1";
}

/** CST do ICMS na escrituração da entrada (origem + 2 dígitos). CSOSN do fornecedor do Simples vira 60 (ST) ou 90. */
export function cstEntrada(it) {
  const orig = String(it.orig || "0").slice(0, 1);
  if (it.cst) return orig + it.cst.padStart(2, "0").slice(-2);
  if (["201", "202", "203", "500"].includes(it.csosn)) return orig + "60";
  return orig + "90";
}

export function validarCfopEntrada(cfop) {
  if (!/^[123]\d{3}$/.test(String(cfop ?? ""))) throw invalido(`CFOP de entrada inválido: ${cfop || "(vazio)"}. Deve ter 4 dígitos e começar com 1, 2 ou 3.`);
}

/**
 * Sugere a classificação de um item da nota de compra.
 * ctx: { ufEmitente, ufEmpresa, industrial, lembrada?, tipoItemProduto? }
 */
export function sugerir(it, ctx = {}) {
  const pre = prefixoEntrada(it.cfop, ctx.ufEmitente, ctx.ufEmpresa);
  const st = temSt(it);
  let destino = "revenda";
  if (ctx.lembrada?.destino && DESTINOS[ctx.lembrada.destino]) destino = ctx.lembrada.destino;
  else if (ctx.tipoItemProduto && DESTINO_DO_TIPO[ctx.tipoItemProduto]) destino = DESTINO_DO_TIPO[ctx.tipoItemProduto];
  const d = DESTINOS[destino];
  const final = ctx.lembrada?.cfop_final && /^\d{3}$/.test(ctx.lembrada.cfop_final) ? ctx.lembrada.cfop_final : st ? d.final_st : d.final;
  const podeCreditar = it.vICMS > 0 && !it.csosn;
  return {
    destino,
    cfop: pre + final,
    cst_icms: cstEntrada(it),
    credito_icms: podeCreditar && (ctx.lembrada ? !!ctx.lembrada.credito_icms : d.credita),
    credito_ipi: !!ctx.industrial && destino === "industrializacao" && it.ipi.vIPI > 0,
  };
}

/** Confere e normaliza a classificação enviada pela tela. */
export function normalizarClassificacao(c, it) {
  const destino = String(c?.destino ?? "");
  if (!DESTINOS[destino]) throw invalido(`Item ${it.num}: escolha o destino da mercadoria (revenda, industrialização, uso e consumo, ativo ou outras).`);
  const cfop = String(c.cfop ?? "").replace(/\D/g, "");
  validarCfopEntrada(cfop);
  const cst = String(c.cst_icms ?? "").replace(/\D/g, "");
  if (!/^\d{3}$/.test(cst)) throw invalido(`Item ${it.num}: CST do ICMS deve ter 3 dígitos (origem + CST).`);
  return {
    destino,
    cfop,
    cst_icms: cst,
    // Sem ICMS destacado não há o que creditar, mesmo que a tela peça.
    credito_icms: !!c.credito_icms && it.vICMS > 0,
    credito_ipi: !!c.credito_ipi && it.ipi.vIPI > 0,
  };
}
