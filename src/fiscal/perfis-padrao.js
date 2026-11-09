// Os 3 perfis fiscais criados junto com a empresa. São um ponto de partida: o contador revisa.

const IBSCBS_2026 = { cst_ibscbs: "000", cclass_trib: "000001", aliq_ibs_uf: 0.1, aliq_ibs_mun: 0, aliq_cbs: 0.9, ibscbs_base_liquida: true };

export function perfisPadrao(crt) {
  if (crt === "1") {
    // Simples Nacional: CSOSN; PIS/COFINS pagos no DAS (CST 49).
    // IBS/CBS: em 2026 o Simples não destaca na NF-e, por isso vem desligado (ligue no perfil se quiser informar).
    const base = {
      origem: "0", aliq_icms_interna: 0, aliq_icms_interestadual: 0, reducao_bc_icms: 0, mva_st: 0, aliq_icms_st: 0,
      cst_pis: "49", aliq_pis: 0, cst_cofins: "49", aliq_cofins: 0, cst_ipi: null, aliq_ipi: 0,
      informar_ibscbs: false, ...IBSCBS_2026,
    };
    return [
      { ...base, nome: "Revenda de mercadoria", cfop_interno: "5102", cfop_interestadual: "6102", cfop_nfce: "5102", cst_icms: "102" },
      { ...base, nome: "Venda de produção própria", cfop_interno: "5101", cfop_interestadual: "6101", cfop_nfce: "5101", cst_icms: "102" },
      { ...base, nome: "Revenda com ST (substituído)", cfop_interno: "5405", cfop_interestadual: "6404", cfop_nfce: "5405", cst_icms: "500" },
    ];
  }
  // Regime normal (CRT 3; o 2 também usa CST). PIS/COFINS cumulativo (lucro presumido) como padrão.
  // aliq_icms_interestadual 0 = automática (4% importado, 7% ou 12% pela UF de destino).
  const base = {
    origem: "0", aliq_icms_interna: 18, aliq_icms_interestadual: 0, reducao_bc_icms: 0, mva_st: 0, aliq_icms_st: 0,
    cst_pis: "01", aliq_pis: 0.65, cst_cofins: "01", aliq_cofins: 3, cst_ipi: null, aliq_ipi: 0,
    informar_ibscbs: true, ...IBSCBS_2026,
  };
  return [
    { ...base, nome: "Revenda de mercadoria", cfop_interno: "5102", cfop_interestadual: "6102", cfop_nfce: "5102", cst_icms: "00" },
    { ...base, nome: "Venda de produção própria", cfop_interno: "5101", cfop_interestadual: "6101", cfop_nfce: "5101", cst_icms: "00" },
    { ...base, nome: "Revenda com ST (substituído)", cfop_interno: "5405", cfop_interestadual: "6404", cfop_nfce: "5405", cst_icms: "60", aliq_icms_interna: 0 },
  ];
}

// Alíquota interna (modal) de ICMS por UF, usada no DIFAL para consumidor final não contribuinte.
// Referência 2025/2026: confira a legislação da UF de destino antes de produção.
export const ALIQ_INTERNA_UF = {
  AC: 19, AL: 19, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19, MA: 23, MG: 18, MS: 17, MT: 17,
  PA: 19, PB: 20, PE: 20.5, PI: 22.5, PR: 19.5, RJ: 22, RN: 20, RO: 19.5, RR: 20, RS: 17, SC: 17, SE: 20, SP: 18, TO: 20,
};

const SUL_SUDESTE_SEM_ES = new Set(["SP", "RJ", "MG", "PR", "SC", "RS"]);

/** Alíquota interestadual: 4% para importados (origem 1, 2, 3, 8); 7% do S/SE (menos ES) para N/NE/CO/ES; senão 12%. */
export function aliquotaInterestadual(ufOrigem, ufDestino, origemMercadoria) {
  if (["1", "2", "3", "8"].includes(String(origemMercadoria))) return 4;
  if (SUL_SUDESTE_SEM_ES.has(ufOrigem) && !SUL_SUDESTE_SEM_ES.has(ufDestino)) return 7;
  return 12;
}
