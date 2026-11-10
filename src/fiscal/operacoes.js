// Tipos de operação da emissão simplificada. A operação define a natureza da nota, o final do
// CFOP e se há cobrança; CST e alíquotas continuam vindo do perfil fiscal do produto.
// O primeiro dígito do CFOP (5 mesma UF, 6 outra UF) é decidido pelo destino da mercadoria.
import { invalido } from "../util.js";

export const OPERACOES = {
  venda: {
    rotulo: "Venda",
    descricao: "Venda de mercadoria. CFOP e tributos do perfil fiscal do produto; gera contas a receber quando a prazo.",
    natureza: "VENDA",
    final: null, // CFOP do perfil (5102/6102, 6108 a não contribuinte...)
    cobranca: true,
    modelos: ["55", "65"],
  },
  bonificacao: {
    rotulo: "Bonificação ou brinde",
    descricao: "Saída em bonificação, doação ou brinde. Sem cobrança; ICMS conforme o perfil do produto.",
    natureza: "REMESSA EM BONIFICACAO, DOACAO OU BRINDE",
    final: "910",
    cobranca: false,
    modelos: ["55"],
  },
  transferencia: {
    rotulo: "Transferência entre filiais",
    descricao: "Transferência para outro estabelecimento da mesma empresa. Sem cobrança.",
    natureza: "TRANSFERENCIA DE MERCADORIA",
    final: "152", // 151 quando o produto é de produção própria
    cobranca: false,
    modelos: ["55"],
  },
  outras: {
    rotulo: "Outra saída",
    descricao: "Outra saída de mercadoria não especificada. Sem cobrança.",
    natureza: "OUTRA SAIDA DE MERCADORIA",
    final: "949",
    cobranca: false,
    modelos: ["55"],
  },
};

export function operacaoDe(chave) {
  const op = OPERACOES[chave ?? "venda"];
  if (!op) throw invalido("Tipo de operação inválido.");
  return op;
}

/** CFOP da operação: o do perfil na venda; nas demais, 5/6 + final da operação. */
export function cfopDaOperacao(operacao, perfil, cfopVenda, interestadual) {
  const op = operacaoDe(operacao);
  if (!op.final) return cfopVenda;
  const final = operacao === "transferencia" && String(perfil.cfop_interno).endsWith("101") ? "151" : op.final;
  return (interestadual ? "6" : "5") + final;
}

export const listaOperacoes = () =>
  Object.entries(OPERACOES).map(([valor, o]) => ({ valor, rotulo: o.rotulo, descricao: o.descricao, natureza: o.natureza, cobranca: o.cobranca, modelos: o.modelos }));
