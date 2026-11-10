// Montagem do arquivo da EFD ICMS/IPI (leiaute 020 em 2026) a partir das notas do sistema.
//
// Regras herdadas do Argus SPED Builder, conferidas em arquivos reais transmitidos:
//   · 0990 inclui o próprio 0000; cada x990 conta as linhas do bloco, ele incluído
//   · 9900: uma linha por tipo de registro, mais 9900, 9990 e 9999
//   · 9990 = 9001 + linhas 9900 + 9990 + 9999;  9999 = total de linhas do arquivo
//   · 0200 com 13 campos (CEST no campo 13); E116 com 10; E310 com 21 depois do REG
//   · documento cancelado/denegado/inutilizado: só a identificação, demais campos em branco
//   · NFC-e: COD_PART vazio no C100 e o consumidor não entra no 0150
//   · Perfil A: C170 em todos os documentos. Perfil B: C170 só nas entradas
//     (o Guia Prático dispensa o detalhamento das saídas de emissão própria)
//   · E110: VL_ICMS_RECOLHER = VL_SLD_APURADO − VL_TOT_DED; saldo negativo vira saldo credor
//
// Função pura: recebe os dados já carregados (ver coletar.js) e devolve o texto e os totais.

// Quantidade de campos de cada registro, contando o REG. Conferida a cada linha gerada.
export const LEIAUTE = {
  "0000": 15, "0001": 2, "0002": 2, "0005": 10, "0100": 14, "0150": 13, "0190": 3, "0200": 13, "0220": 4, "0990": 2,
  B001: 2, B990: 2,
  C001: 2, C100: 29, C101: 4, C170: 38, C190: 12, C990: 2,
  D001: 2, D990: 2,
  E001: 2, E100: 3, E110: 15, E116: 10, E200: 4, E210: 15, E250: 10, E300: 4, E310: 22, E316: 10,
  E500: 4, E510: 6, E520: 8, E990: 2,
  G001: 2, G990: 2, H001: 2, H990: 2, K001: 2, K990: 2,
  1001: 2, 1010: 14, 1990: 2,
  9001: 2, 9900: 3, 9990: 2, 9999: 2,
};

/** Versão do leiaute pelo ano do período (Ato COTEPE/ICMS 44/2018 e atualizações anuais). */
export function versaoLeiaute(ano) {
  if (ano >= 2026) return "020";
  if (ano === 2025) return "019";
  if (ano === 2024) return "018";
  return "017";
}

const UNIDADES = {
  UN: "UNIDADE", UND: "UNIDADE", UNID: "UNIDADE", PC: "PECA", PCT: "PACOTE", CX: "CAIXA", KG: "QUILOGRAMA", G: "GRAMA",
  L: "LITRO", LT: "LITRO", ML: "MILILITRO", M: "METRO", M2: "METRO QUADRADO", M3: "METRO CUBICO", MT: "METRO",
  PAR: "PAR", DZ: "DUZIA", FD: "FARDO", SC: "SACO", RL: "ROLO", GL: "GALAO", TON: "TONELADA", KIT: "KIT", JG: "JOGO", CJ: "CONJUNTO",
};

// ---------- formatação ----------
const linha = (campos) => `|${campos.join("|")}|`;
/** Texto: sem pipe, sem quebra de linha; espaços internos preservados (códigos de ERP dependem disso). */
const t = (v, max = 255) => String(v ?? "").replace(/[|\r\n\t]/g, " ").trim().slice(0, max);
const dig = (v) => String(v ?? "").replace(/\D/g, "");
/** Centavos → "1234,56". */
const vl = (cent) => {
  const n = Math.round(Number(cent) || 0);
  const s = (Math.abs(n) / 100).toFixed(2).replace(".", ",");
  return n < 0 ? `-${s}` : s;
};
const num = (n, casas) => (Number(n) || 0).toFixed(casas).replace(".", ",");
const dt = (iso) => (iso ? `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}` : "");

const somar = (lista, f) => lista.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/** Valor da operação do item (C190 VL_OPR): mercadoria − desconto + despesas + ST + IPI. */
const valorOperacao = (it) => it.vProd - it.vDesc + it.vFrete + it.vSeg + it.vOutro + it.vICMSST + it.ipi.vIPI;

function agrupar(itens) {
  const mapa = new Map();
  for (const l of itens) {
    const k = `${l.cst}|${l.cfop}|${l.aliq.toFixed(2)}`;
    const a = mapa.get(k) ?? { cst: l.cst, cfop: l.cfop, aliq: l.aliq, opr: 0, bc: 0, icms: 0, bcSt: 0, st: 0, redBc: 0, ipi: 0 };
    a.opr += l.opr; a.bc += l.bc; a.icms += l.icms; a.bcSt += l.bcSt; a.st += l.st; a.redBc += l.redBc; a.ipi += l.ipi;
    mapa.set(k, a);
  }
  return [...mapa.values()].sort((x, y) => (x.cst + x.cfop + x.aliq).localeCompare(y.cst + y.cfop + y.aliq));
}

/**
 * @param d {{
 *   empresa, config, periodo: {ini, fim}, finalidade, saldoCredorAnteriorCent,
 *   saidas: Array<{ situacao, mod, serie, numero, chave, nfe, uf_dest }>,
 *   entradas: Array<{ nfe, data_entrada, itens: Map<num, {classificacao, produto}> }>,
 *   produtos: Map<codigo, produto>
 * }}
 */
export function montarEfd(d) {
  const { empresa: e, config: c, periodo } = d;
  const perfil = c.perfil === "A" ? "A" : "B";
  const industrial = c.atividade === "0";
  const participantes = new Map();
  const itens0200 = new Map();
  const unidades = new Set();
  const docs = [];

  const participante = (p) => {
    const doc = p?.cnpj || p?.cpf;
    if (!doc) return "";
    if (!participantes.has(doc)) participantes.set(doc, p);
    return doc;
  };
  const item0200 = (codigo, dados) => {
    if (!itens0200.has(codigo)) itens0200.set(codigo, { ...dados, conversoes: new Map() });
    unidades.add(dados.unidade);
    return itens0200.get(codigo);
  };

  // ---------- Saídas (notas emitidas pela empresa) ----------
  for (const s of d.saidas) {
    if (s.situacao !== "00") {
      docs.push({ data: s.nfe?.dt_emissao ?? periodo.ini, op: "1", c100: [
        "1", "0", "", s.mod, s.situacao, t(s.serie, 3), t(s.numero, 9), s.situacao === "05" ? "" : dig(s.chave),
        ...Array(20).fill(""),
      ], filhos: [] });
      continue;
    }
    const n = s.nfe;
    const nfce = n.mod === "65";
    const linhasItem = n.itens.map((it) => {
      const cst = String(it.orig || "0").slice(0, 1) + String(it.cst).padStart(2, "0").slice(-2);
      const produto = d.produtos.get(it.cProd);
      item0200(it.cProd, {
        descricao: produto?.descricao || it.xProd, ean: produto?.ean ?? it.ean, unidade: produto?.unidade || it.uCom,
        tipo_item: produto?.tipo_item || "00", ncm: produto?.ncm || it.ncm, cest: produto?.cest ?? it.cest,
      });
      unidades.add(it.uCom);
      const redBc = ["20", "70"].includes(it.cst) ? Math.max(0, it.vProd - it.vDesc - it.vBC) : 0;
      return { it, cst, cfop: it.cfop, aliq: it.pICMS, opr: valorOperacao(it), bc: it.vBC, icms: it.vICMS, bcSt: it.vBCST, st: it.vICMSST, redBc, ipi: it.ipi.vIPI };
    });
    const c190 = agrupar(linhasItem);
    const filhos = [];
    if (!nfce && (n.total.vICMSUFDest > 0 || n.total.vFCPUFDest > 0)) {
      filhos.push(["C101", vl(n.total.vFCPUFDest), vl(n.total.vICMSUFDest), vl(n.total.vICMSUFRemet)]);
    }
    if (perfil === "A") {
      for (const l of linhasItem) filhos.push(c170(l, { industrial, entrada: false }));
    }
    for (const a of c190) filhos.push(c190Linha(a));
    docs.push({
      data: n.dt_emissao, op: "1", uf: s.uf_dest || e.uf, c190, difal: { uf: s.uf_dest, icms: n.total.vICMSUFDest, fcp: n.total.vFCPUFDest },
      linhasItem,
      c100: [
        "1", "0", nfce ? "" : participante(n.dest), n.mod, "00", t(n.serie, 3), t(n.numero, 9), dig(n.chave),
        dt(n.dt_emissao), dt(nfce ? n.dt_emissao : n.dt_saida_entrada || n.dt_emissao),
        vl(n.total.vNF), n.a_prazo ? "1" : "0", vl(n.total.vDesc), vl(0), vl(n.total.vProd), n.mod_frete, vl(n.total.vFrete), vl(n.total.vSeg),
        vl(n.total.vOutro), vl(somar(c190, (a) => a.bc)), vl(somar(c190, (a) => a.icms)),
        opc(somar(c190, (a) => a.bcSt)), opc(somar(c190, (a) => a.st)), opc(somar(c190, (a) => a.ipi)),
        opc(n.total.vPIS), opc(n.total.vCOFINS), "", "",
      ],
      filhos,
    });
  }

  // ---------- Entradas (notas de compra classificadas) ----------
  for (const ent of d.entradas) {
    const n = ent.nfe;
    const fornecedor = n.emit?.cnpj || n.emit?.cpf || "";
    const linhasItem = n.itens.map((it) => {
      const info = ent.itens.get(it.num);
      const cls = info.classificacao;
      const prod = info.produto;
      // Item sem produto no estoque (uso e consumo, ativo...): código próprio derivado do fornecedor.
      const codigo = prod ? prod.codigo : t(`F${fornecedor}-${it.cProd}`, 60);
      const reg = item0200(codigo, prod
        ? { descricao: prod.descricao, ean: prod.ean, unidade: prod.unidade, tipo_item: prod.tipo_item, ncm: prod.ncm, cest: prod.cest }
        : { descricao: it.xProd, ean: it.ean, unidade: it.uCom, tipo_item: cls.tipo_item, ncm: it.ncm, cest: it.cest });
      // Comprado numa unidade e controlado em outra: fator de conversão no 0220.
      if (it.uCom !== reg.unidade && !reg.conversoes.has(it.uCom)) reg.conversoes.set(it.uCom, info.fator || 1);
      unidades.add(it.uCom);
      const cred = cls.credito_icms;
      const redBc = cred && ["20", "70"].includes(cls.cst_icms.slice(1)) ? Math.max(0, it.vProd - it.vDesc - it.vBC) : 0;
      return {
        // IND_MOV: 0 quando a mercadoria entra no estoque, 1 quando não (uso e consumo fora do estoque) — como no arquivo real.
        it, codigo, cls, mov: prod ? "0" : "1", cst: cls.cst_icms, cfop: cls.cfop, aliq: cred ? it.pICMS : 0, opr: valorOperacao(it),
        bc: cred ? it.vBC : 0, icms: cred ? it.vICMS : 0, bcSt: it.vBCST, st: it.vICMSST, redBc, ipi: it.ipi.vIPI,
      };
    });
    const c190 = agrupar(linhasItem);
    const filhos = linhasItem.map((l) => c170(l, { industrial, entrada: true })); // entradas: C170 nos dois perfis
    for (const a of c190) filhos.push(c190Linha(a));
    docs.push({
      data: n.dt_emissao, op: "0", c190, linhasItem, simples: n.itens.some((it) => it.vCredICMSSN > 0) ? n : null,
      c100: [
        "0", "1", participante(n.emit), n.mod, "00", t(n.serie, 3), t(n.numero, 9), dig(n.chave),
        dt(n.dt_emissao), dt(ent.data_entrada),
        vl(n.total.vNF), n.a_prazo ? "1" : "0", vl(n.total.vDesc), vl(0), vl(n.total.vProd), n.mod_frete, vl(n.total.vFrete), vl(n.total.vSeg),
        vl(n.total.vOutro), vl(somar(c190, (a) => a.bc)), vl(somar(c190, (a) => a.icms)),
        opc(somar(c190, (a) => a.bcSt)), opc(somar(c190, (a) => a.st)), opc(somar(c190, (a) => a.ipi)),
        opc(n.total.vPIS), opc(n.total.vCOFINS), "", "",
      ],
      filhos,
    });
  }

  docs.sort((a, b) => (a.data + a.op).localeCompare(b.data + b.op));

  // ---------- Apuração do ICMS (E110) ----------
  const regulares = docs.filter((x) => x.c190);
  const debitos = somar(regulares.filter((x) => x.op === "1"), (x) => somar(x.c190, (a) => a.icms));
  const creditos = somar(regulares.filter((x) => x.op === "0"), (x) => somar(x.c190, (a) => a.icms));
  const sldAnt = Math.max(0, Math.round(d.saldoCredorAnteriorCent || 0));
  const saldo = debitos - (creditos + sldAnt);
  const apuracao = {
    debitos_cent: debitos, creditos_cent: creditos, saldo_credor_anterior_cent: sldAnt,
    saldo_apurado_cent: Math.max(0, saldo), deducoes_cent: 0,
    icms_recolher_cent: Math.max(0, saldo), saldo_credor_transportar_cent: Math.max(0, -saldo),
  };

  // ---------- Bloco 0 ----------
  const ano = Number(periodo.ini.slice(0, 4));
  const b0 = [];
  b0.push(["0000", versaoLeiaute(ano), d.finalidade === "1" ? "1" : "0", dt(periodo.ini), dt(periodo.fim), t(e.razao_social, 100),
    dig(e.cnpj), "", t(e.uf, 2), dig(e.ie), dig(e.cod_municipio), t(e.im, 15), "", perfil, industrial ? "0" : "1"]);
  b0.push(["0001", "0"]);
  if (industrial) b0.push(["0002", t(c.ind_classif, 2)]);
  b0.push(["0005", t(e.nome_fantasia || e.razao_social, 60), dig(e.cep), t(e.logradouro, 60), t(e.numero, 10), t(e.complemento, 60),
    t(e.bairro, 60), dig(e.fone).slice(0, 11), "", t(e.email, 255)]);
  const ct = c.contabilista ?? {};
  b0.push(["0100", t(ct.nome, 100), dig(ct.cpf), t(ct.crc, 15), dig(ct.cnpj), dig(ct.cep), t(ct.logradouro, 60), t(ct.numero, 10),
    t(ct.complemento, 60), t(ct.bairro, 60), dig(ct.fone).slice(0, 11), "", t(ct.email, 255), dig(ct.cod_municipio)]);
  for (const cod of [...participantes.keys()].sort()) {
    const p = participantes.get(cod);
    const exterior = p.cod_pais && p.cod_pais !== "1058";
    b0.push(["0150", t(cod, 60), t(p.nome, 100), p.cod_pais || "1058", p.cnpj || "", p.cnpj ? "" : p.cpf || "", p.ie || "",
      exterior ? "" : p.cod_mun, "", t(p.logradouro, 60), t(p.numero, 10), t(p.complemento, 60), t(p.bairro, 60)]);
  }
  for (const u of [...unidades].filter(Boolean).sort()) b0.push(["0190", t(u, 6), UNIDADES[u] ?? u]);
  for (const cod of [...itens0200.keys()].sort()) {
    const i = itens0200.get(cod);
    b0.push(["0200", t(cod, 60), t(i.descricao, 255), t(i.ean, 60), "", t(i.unidade, 6), i.tipo_item || "00", dig(i.ncm),
      "", dig(i.ncm).slice(0, 2), "", "", dig(i.cest)]);
    for (const [unid, fator] of i.conversoes) b0.push(["0220", t(unid, 6), num(fator, 6), ""]);
  }

  // ---------- Bloco C ----------
  const bc = [["C001", docs.length ? "0" : "1"]];
  for (const x of docs) {
    bc.push(["C100", ...x.c100]);
    for (const f of x.filhos) bc.push(f);
  }

  // ---------- Bloco E ----------
  const fim = new Date(`${periodo.fim}T12:00:00Z`);
  const mesRef = `${periodo.ini.slice(5, 7)}${periodo.ini.slice(0, 4)}`;
  const venc = (dia) => {
    const v = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() + 1, Math.min(Number(dia) || 20, 28)));
    return dt(v.toISOString().slice(0, 10));
  };
  const be = [["E001", "0"], ["E100", dt(periodo.ini), dt(periodo.fim)]];
  be.push(["E110", vl(debitos), vl(0), vl(0), vl(0), vl(creditos), vl(0), vl(0), vl(0), vl(sldAnt),
    vl(apuracao.saldo_apurado_cent), vl(0), vl(apuracao.icms_recolher_cent), vl(apuracao.saldo_credor_transportar_cent), vl(0)]);
  if (apuracao.icms_recolher_cent > 0) {
    be.push(["E116", "000", vl(apuracao.icms_recolher_cent), venc(c.dia_vencimento), t(c.cod_receita, 15), "", "", "", "", mesRef]);
  }

  // ICMS-ST retido nas saídas (E200/E210/E250), por UF de destino.
  const stPorUf = new Map();
  for (const x of regulares.filter((r) => r.op === "1")) {
    const st = somar(x.c190, (a) => a.st);
    if (st > 0) stPorUf.set(x.uf, (stPorUf.get(x.uf) ?? 0) + st);
  }
  const apuracaoSt = [];
  for (const uf of [...stPorUf.keys()].sort()) {
    const ret = stPorUf.get(uf);
    apuracaoSt.push({ uf, retido_cent: ret });
    be.push(["E200", uf, dt(periodo.ini), dt(periodo.fim)]);
    be.push(["E210", "1", vl(0), vl(0), vl(0), vl(0), vl(0), vl(ret), vl(0), vl(0), vl(ret), vl(0), vl(ret), vl(0), vl(0)]);
    be.push(["E250", "000", vl(ret), venc(c.dia_vencimento), t(c.cod_receita_st, 15), "", "", "", "", mesRef]);
  }

  // DIFAL/FCP da EC 87/2015 (C101 das saídas a não contribuinte de outra UF), por UF de destino.
  const difal = new Map();
  for (const x of regulares.filter((r) => r.op === "1" && r.difal && (r.difal.icms > 0 || r.difal.fcp > 0))) {
    const a = difal.get(x.difal.uf) ?? { icms: 0, fcp: 0 };
    a.icms += x.difal.icms; a.fcp += x.difal.fcp;
    difal.set(x.difal.uf, a);
  }
  const apuracaoDifal = [];
  for (const uf of [...difal.keys()].sort()) {
    const u = difal.get(uf);
    apuracaoDifal.push({ uf, difal_cent: u.icms, fcp_cent: u.fcp });
    be.push(["E300", uf, dt(periodo.ini), dt(periodo.fim)]);
    be.push(["E310", "1",
      vl(0), vl(u.icms), vl(0), vl(0), vl(0), vl(u.icms), vl(0), vl(u.icms), vl(0), vl(0),
      vl(0), vl(u.fcp), vl(0), vl(0), vl(0), vl(u.fcp), vl(0), vl(u.fcp), vl(0), vl(0)]);
    if (u.icms + u.fcp > 0) be.push(["E316", "000", vl(u.icms + u.fcp), venc(c.dia_vencimento), t(c.cod_receita_difal, 15), "", "", "", "", mesRef]);
  }

  // IPI (estabelecimento industrial ou equiparado): E500/E510/E520.
  let apuracaoIpi = null;
  if (industrial) {
    const mapa = new Map();
    let deb = 0;
    let cred = 0;
    for (const x of regulares) {
      for (const l of x.linhasItem) {
        const entrada = x.op === "0";
        if (entrada && !l.cls.credito_ipi) continue;
        if (!entrada && !l.it.ipi.cst) continue;
        const cstIpi = entrada ? "00" : l.it.ipi.cst;
        const k = `${l.cfop}|${cstIpi}`;
        const a = mapa.get(k) ?? { cfop: l.cfop, cst: cstIpi, cont: 0, bc: 0, ipi: 0 };
        a.cont += (l.it.ipi.vBC || l.it.vProd) + l.it.ipi.vIPI;
        a.bc += l.it.ipi.vBC;
        a.ipi += l.it.ipi.vIPI;
        mapa.set(k, a);
        if (entrada) cred += l.it.ipi.vIPI; else deb += l.it.ipi.vIPI;
      }
    }
    be.push(["E500", "0", dt(periodo.ini), dt(periodo.fim)]);
    for (const a of [...mapa.values()].sort((x, y) => (x.cfop + x.cst).localeCompare(y.cfop + y.cst))) {
      be.push(["E510", a.cfop, a.cst, vl(a.cont), vl(a.bc), vl(a.ipi)]);
    }
    const sd = deb - cred;
    apuracaoIpi = { debitos_cent: deb, creditos_cent: cred, saldo_devedor_cent: Math.max(0, sd), saldo_credor_cent: Math.max(0, -sd) };
    be.push(["E520", vl(0), vl(deb), vl(cred), vl(0), vl(0), vl(Math.max(0, -sd)), vl(Math.max(0, sd))]);
  }

  // ---------- Blocos sem movimento e Bloco 1 ----------
  const blocos = [
    { linhas: b0, fecha: "0990" },
    { linhas: [["B001", "1"]], fecha: "B990" },
    { linhas: bc, fecha: "C990" },
    { linhas: [["D001", "1"]], fecha: "D990" },
    { linhas: be, fecha: "E990" },
    { linhas: [["G001", "1"]], fecha: "G990" },
    { linhas: [["H001", "1"]], fecha: "H990" },
    { linhas: [["K001", "1"]], fecha: "K990" },
    { linhas: [["1001", "0"], ["1010", ...Array(13).fill("N")]], fecha: "1990" },
  ];
  const todas = [];
  for (const b of blocos) {
    b.linhas.push([b.fecha, String(b.linhas.length + 1)]);
    todas.push(...b.linhas);
  }

  // ---------- Bloco 9 ----------
  const contagem = {};
  for (const l of todas) contagem[l[0]] = (contagem[l[0]] ?? 0) + 1;
  contagem["9001"] = 1;
  const tipos = Object.keys(contagem).length + 3; // + 9900, 9990, 9999
  contagem["9900"] = tipos;
  contagem["9990"] = 1;
  contagem["9999"] = 1;
  // Ordem do arquivo real: blocos na sequência do arquivo (0, B, C, D, E, G, H, K, 1, 9), registros em ordem
  // dentro de cada bloco, e o próprio 9900 por último.
  const ORDEM = "0BCDEGHK19";
  const chave = (reg) => ORDEM.indexOf(reg[0]) * 10000 + (reg === "9900" ? 9999 : 0);
  const b9 = [["9001", "0"]];
  for (const reg of Object.keys(contagem).sort((x, y) => chave(x) - chave(y) || x.localeCompare(y))) b9.push(["9900", reg, String(contagem[reg])]);
  b9.push(["9990", String(1 + tipos + 1 + 1)]);
  const total = todas.length + b9.length + 1;
  b9.push(["9999", String(total)]);
  const arquivo = [...todas, ...b9];

  // Conferência do leiaute: cada linha com a quantidade exata de campos do registro.
  for (const l of arquivo) {
    const esperado = LEIAUTE[l[0]];
    if (!esperado || l.length !== esperado) throw new Error(`Registro ${l[0]} montado com ${l.length} campos (esperado ${esperado ?? "?"}).`);
  }

  const avisos = [];
  for (const x of docs.filter((r) => r.simples)) {
    avisos.push({ tipo: "alerta", texto: `NF ${x.simples.numero} de fornecedor do Simples Nacional destaca crédito de ICMS no XML; ele não foi lançado (exige ajuste E111 com o código da sua UF).` });
  }
  for (const x of regulares.filter((r) => r.op === "0")) {
    for (const l of x.linhasItem) {
      if (/^2(551|556|406|407)$/.test(l.cfop)) {
        avisos.push({ tipo: "alerta", texto: `Entrada interestadual para uso/consumo ou ativo (CFOP ${l.cfop}) pode ter DIFAL a recolher; ele não é calculado aqui.` });
        break;
      }
    }
  }
  if (stPorUf.size && [...stPorUf.keys()].some((uf) => uf !== e.uf)) {
    avisos.push({ tipo: "alerta", texto: "Há ICMS-ST retido para outra UF: o E200 dessa UF exige inscrição de substituto tributário nela. Confira." });
  }
  if (apuracaoSt.length && !c.cod_receita_st) avisos.push({ tipo: "alerta", texto: "ICMS-ST a recolher sem código de receita da ST (configuração do SPED)." });
  if (apuracaoDifal.length && !c.cod_receita_difal) avisos.push({ tipo: "alerta", texto: "DIFAL/FCP da EC 87 a recolher sem código de receita (configuração do SPED)." });

  return {
    txt: arquivo.map(linha).join("\r\n") + "\r\n",
    linhas: arquivo.length,
    contagem,
    apuracao: { ...apuracao, st: apuracaoSt, difal: apuracaoDifal, ipi: apuracaoIpi },
    resumo: {
      perfil,
      saidas: docs.filter((x) => x.op === "1").length,
      entradas: docs.filter((x) => x.op === "0").length,
      participantes: participantes.size,
      itens: itens0200.size,
      c170: contagem.C170 ?? 0,
    },
    avisos,
  };

  // ---------- auxiliares que dependem do contexto ----------
  function opc(cent) {
    return cent ? vl(cent) : ""; // ST, IPI, PIS e COFINS zerados ficam em branco no C100 (padrão dos ERPs conferidos)
  }
  function c170(l, { industrial: ind, entrada }) {
    const it = l.it;
    const temIpi = ind && (entrada ? l.cls.credito_ipi || it.ipi.vIPI > 0 : !!it.ipi.cst);
    const cstIpi = !ind ? "" : entrada ? (l.cls.credito_ipi ? "00" : "49") : it.ipi.cst;
    const ipiCred = !entrada || l.cls.credito_ipi;
    return ["C170", String(it.num), t(entrada ? l.codigo : it.cProd, 60), t(it.xProd, 255), num(it.qCom, 5), t(it.uCom, 6),
      vl(it.vProd), vl(it.vDesc), entrada ? l.mov : "0", l.cst, l.cfop, "",
      vl(l.bc), num(l.aliq, 2), vl(l.icms), vl(it.vBCST), num(it.pICMSST, 2), vl(it.vICMSST),
      temIpi ? "0" : "", cstIpi, ind ? t(it.ipi.cEnq, 3) : "",
      ind ? vl(ipiCred ? it.ipi.vBC : 0) : "", ind ? num(ipiCred ? it.ipi.pIPI : 0, 2) : "", ind ? vl(ipiCred ? it.ipi.vIPI : 0) : "",
      "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
  }
  function c190Linha(a) {
    return ["C190", a.cst, a.cfop, num(a.aliq, 2), vl(a.opr), vl(a.bc), vl(a.icms), vl(a.bcSt), vl(a.st), vl(a.redBc), vl(a.ipi), ""];
  }
}

/** Texto do arquivo em ISO-8859-1 (padrão do PVA). Caracteres fora do Latin-1 perdem o acento ou viram "?". */
export function paraLatin1(txt) {
  let s = "";
  for (const ch of txt) {
    if (ch.codePointAt(0) <= 0xff) s += ch;
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      s += base && base.codePointAt(0) <= 0xff ? base : "?";
    }
  }
  return Buffer.from(s, "latin1");
}
