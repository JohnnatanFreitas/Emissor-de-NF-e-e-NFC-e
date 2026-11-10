// Regras de cálculo da NFS-e: ISS, retenções federais e IBS/CBS por ano da competência.
// Portado do sistema-nfse (EMISSOR DE NOTAS DE SERVIÇO/taxEngine.js), em centavos inteiros, com uma
// correção: em 2026 o IBS de teste é 0,1% estadual e 0% municipal (LC 214/2025, art. 343), e não
// 0,05% + 0,05% como estava lá.
//
// Fundamentos: LC 116/2003 (ISS), RIR/2018 (IRRF 1,5%), Lei 10.833/2003 (CSRF: PIS 0,65%, COFINS 3%,
// CSLL 1%), EC 132/2023 e LC 214/2025 (transição IBS/CBS).

/** Catálogo inicial de serviços: código de tributação nacional (item + subitem + desdobramento) e item da
 *  LC 116. O código NBS fica em branco: preencha com o da sua atividade (tabela oficial da NBS). */
export const CATALOGO_SERVICOS = [
  { cod_trib_nac: "010101", item_lc116: "01.01", descricao: "Análise e desenvolvimento de sistemas", nbs: "", aliq_iss: 3 },
  { cod_trib_nac: "010701", item_lc116: "01.07", descricao: "Suporte técnico em informática, manutenção e instalação de programas", nbs: "", aliq_iss: 2.5 },
  { cod_trib_nac: "170101", item_lc116: "17.01", descricao: "Assessoria ou consultoria de qualquer natureza", nbs: "", aliq_iss: 5 },
  { cod_trib_nac: "170601", item_lc116: "17.06", descricao: "Propaganda e publicidade, inclusive promoção de vendas", nbs: "", aliq_iss: 3.5 },
  { cod_trib_nac: "171901", item_lc116: "17.19", descricao: "Contabilidade, inclusive serviços técnicos e auxiliares", nbs: "", aliq_iss: 3 },
  { cod_trib_nac: "070101", item_lc116: "07.01", descricao: "Engenharia, agronomia, agrimensura, arquitetura e congêneres", nbs: "", aliq_iss: 5 },
  { cod_trib_nac: "080201", item_lc116: "08.02", descricao: "Instrução, treinamento, orientação pedagógica e cursos", nbs: "", aliq_iss: 3 },
];

/** Parâmetros da reforma por ano da competência. */
export function regrasDoAno(ano) {
  const a = Number(ano) || 2026;
  if (a <= 2026) return { ano: 2026, pisCofinsAtivos: true, fatorIss: 1, cbs: 0.9, ibsUf: 0.1, ibsMun: 0, fase: "Teste da reforma: CBS 0,9% e IBS 0,1% informativos (compensam PIS/COFINS)" };
  if (a <= 2028) return { ano: a, pisCofinsAtivos: false, fatorIss: 1, cbs: 8.8, ibsUf: 0.05, ibsMun: 0.05, fase: "CBS plena; PIS e COFINS extintos; ISS integral" };
  const rampa = { 2029: [0.9, 1.77], 2030: [0.8, 3.54], 2031: [0.7, 5.31], 2032: [0.6, 7.08] }[a];
  if (rampa) return { ano: a, pisCofinsAtivos: false, fatorIss: rampa[0], cbs: 8.8, ibsUf: rampa[1] / 2, ibsMun: rampa[1] / 2, fase: `Transição: ISS a ${rampa[0] * 100}% e IBS crescente` };
  return { ano: a, pisCofinsAtivos: false, fatorIss: 0, cbs: 8.8, ibsUf: 8.85, ibsMun: 8.85, fase: "Regime definitivo: ISS extinto, IBS e CBS plenos" };
}

const pct = (base, aliq) => Math.round((base * Number(aliq || 0)) / 100);

/**
 * Calcula a NFS-e. Valores em centavos.
 * p: { ano, valor_servico_cent, deducoes_cent, desconto_incond_cent, regime: 'simples'|'mei'|'normal', aliq_iss,
 *      iss_retido, tomador_pj, reter_irrf?, reter_csrf?, reter_inss?, aliq_inss }
 */
export function calcularNfse(p) {
  const r = regrasDoAno(p.ano);
  const bruto = Math.max(0, Math.round(Number(p.valor_servico_cent) || 0));
  const deducoes = Math.min(bruto, Math.max(0, Math.round(Number(p.deducoes_cent) || 0)));
  const descIncond = Math.min(bruto - deducoes, Math.max(0, Math.round(Number(p.desconto_incond_cent) || 0)));
  const base = bruto - deducoes - descIncond;
  const simplesOuMei = p.regime === "simples" || p.regime === "mei";

  const aliqIss = p.regime === "mei" ? 0 : Number((Number(p.aliq_iss || 0) * r.fatorIss).toFixed(4));
  const iss = pct(base, aliqIss);
  const issRetido = !!p.iss_retido && iss > 0;

  // Retenções federais: só prestador fora do Simples/MEI e tomador pessoa jurídica (IN RFB 765/2007).
  const podeReter = !simplesOuMei && !!p.tomador_pj;
  const reterIrrf = p.reter_irrf ?? podeReter;
  const reterCsrf = p.reter_csrf ?? podeReter;
  let irrf = reterIrrf && podeReter ? pct(base, 1.5) : 0;
  if (irrf < 1000) irrf = 0; // IRRF abaixo de R$ 10,00 é dispensado (art. 67 da Lei 9.430/1996)
  const csrfOk = reterCsrf && podeReter;
  const pis = csrfOk && r.pisCofinsAtivos ? pct(base, 0.65) : 0;
  const cofins = csrfOk && r.pisCofinsAtivos ? pct(base, 3) : 0;
  const csll = csrfOk ? pct(base, 1) : 0;
  const inss = p.reter_inss ? pct(base, p.aliq_inss || 11) : 0;

  // IBS/CBS: destacados por quem não é do Simples/MEI (no Simples o recolhimento é pelo DAS).
  const cbs = simplesOuMei ? 0 : pct(base, r.cbs);
  const ibsUf = simplesOuMei ? 0 : pct(base, r.ibsUf);
  const ibsMun = simplesOuMei ? 0 : pct(base, r.ibsMun);

  const retencoes = (issRetido ? iss : 0) + irrf + pis + cofins + csll + inss;
  return {
    regras: r,
    valor_servico_cent: bruto,
    deducoes_cent: deducoes,
    desconto_incond_cent: descIncond,
    base_calculo_cent: base,
    aliq_iss: aliqIss,
    iss_cent: iss,
    iss_retido: issRetido,
    irrf_cent: irrf,
    pis_cent: pis,
    cofins_cent: cofins,
    csll_cent: csll,
    inss_cent: inss,
    cbs_cent: cbs,
    ibs_uf_cent: ibsUf,
    ibs_mun_cent: ibsMun,
    aliq_cbs: simplesOuMei ? 0 : r.cbs,
    aliq_ibs_uf: simplesOuMei ? 0 : r.ibsUf,
    aliq_ibs_mun: simplesOuMei ? 0 : r.ibsMun,
    retencoes_cent: retencoes,
    liquido_cent: bruto - descIncond - retencoes,
  };
}
