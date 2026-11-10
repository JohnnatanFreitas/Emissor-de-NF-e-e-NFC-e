// SPED Fiscal (EFD ICMS/IPI): classificação das entradas, perfis A e B, apuração e estrutura do arquivo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { servidorTeste, EMPRESA, CLIENTE_SP } from "./apoio.js";
import { LEIAUTE, montarEfd } from "../src/sped/efd.js";
import { sugerir, cstEntrada, prefixoEntrada } from "../src/sped/classificacao.js";
import { lerNfe } from "../src/sped/nfe-xml.js";
import { hojeISO } from "../src/util.js";

let s;
let eid;
let produto;
const PERIODO = hojeISO().slice(0, 7);

const CONFIG = {
  perfil: "B", atividade: "1", cod_receita: "1015", dia_vencimento: 20, incluir_homologacao: true,
  contabilista: { nome: "JOÃO CONTADOR", cpf: "52998224725", crc: "CE-012345/O", cnpj: "", cep: "60000000", logradouro: "RUA C", numero: "1",
    complemento: "", bairro: "CENTRO", fone: "8533334444", email: "contador@x.com", cod_municipio: "2304400" },
};

// Nota de compra de PE: item 1 para revenda (ICMS 12% = 120,00), item 2 para uso e consumo (ICMS 24,00).
const XML_COMPRA = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe26261177666555000144550010000005551000000016" versao="4.00">
<ide><mod>55</mod><nNF>555</nNF><serie>1</serie><tpNF>1</tpNF><dhEmi>${hojeISO()}T08:00:00-03:00</dhEmi></ide>
<emit><CNPJ>77666555000144</CNPJ><xNome>ATACADO RECIFE LTDA</xNome><IE>0321</IE><CRT>3</CRT><enderEmit><xLgr>AV BOA VIAGEM</xLgr><nro>9</nro><xBairro>BOA VIAGEM</xBairro><cMun>2611606</cMun><xMun>Recife</xMun><UF>PE</UF><CEP>51000000</CEP></enderEmit></emit>
<dest><CNPJ>11222333000181</CNPJ></dest>
<det nItem="1"><prod><cProd>TEC-1</cProd><cEAN>SEM GTIN</cEAN><xProd>TECLADO USB</xProd><NCM>84716052</NCM><CFOP>6102</CFOP><uCom>UN</uCom><qCom>10</qCom><vUnCom>100.00</vUnCom><vProd>1000.00</vProd></prod>
 <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>1000.00</vBC><pICMS>12.00</pICMS><vICMS>120.00</vICMS></ICMS00></ICMS></imposto></det>
<det nItem="2"><prod><cProd>PAP-A4</cProd><cEAN>SEM GTIN</cEAN><xProd>PAPEL A4 RESMA</xProd><NCM>48025610</NCM><CFOP>6102</CFOP><uCom>CX</uCom><qCom>2</qCom><vUnCom>100.00</vUnCom><vProd>200.00</vProd></prod>
 <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>200.00</vBC><pICMS>12.00</pICMS><vICMS>24.00</vICMS></ICMS00></ICMS></imposto></det>
<total><ICMSTot><vBC>1200.00</vBC><vICMS>144.00</vICMS><vProd>1200.00</vProd><vNF>1200.00</vNF></ICMSTot></total>
<transp><modFrete>9</modFrete></transp></infNFe></NFe></nfeProc>`;

before(async () => {
  s = await servidorTeste();
  await s.login();
  eid = (await s.chamar("POST", "/api/empresas", EMPRESA)).json.id;
  const perfis = (await s.chamar("GET", `/api/empresas/${eid}/perfis`)).json;
  produto = (await s.chamar("POST", `/api/empresas/${eid}/produtos`, {
    codigo: "P001", descricao: "CABO HDMI 2M", ncm: "8544.42.00", unidade: "UN", preco_cent: 3990, perfil_id: perfis.find((p) => p.nome === "Revenda de mercadoria").id, ativo: true,
  })).json;
  await s.chamar("POST", `/api/empresas/${eid}/estoque/ajuste`, { produto_id: produto.id, tipo: "entrada_manual", quantidade: 50, custo_unitario_cent: 2000 });
  const cli = (await s.chamar("POST", `/api/empresas/${eid}/pessoas`, CLIENTE_SP)).json;
  // Saída interestadual a não contribuinte (gera DIFAL/C101) e uma nota cancelada.
  for (const qtd of [3, 1]) {
    const r = await s.chamar("POST", `/api/empresas/${eid}/pedidos`, {
      tipo: "pedido", cliente_id: cli.id, itens: [{ produto_id: produto.id, quantidade: qtd, valor_unitario_cent: 4000 }], forma_pagamento: "01", emitir: true,
    });
    assert.equal(r.json.nota.status, "autorizada", r.body);
    if (qtd === 1) {
      const c = await s.chamar("POST", `/api/empresas/${eid}/notas/${r.json.nota.id}/cancelar`, { justificativa: "Pedido digitado em duplicidade" });
      assert.equal(c.status, 200, c.body);
    }
  }
  // Inutiliza o próximo número (3).
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/inutilizacoes`, { modelo: "55", numero_inicial: 3, justificativa: "Numero pulado por falha no sistema" })).status, 200);
});
after(async () => s.fechar());

test("classificação sugerida: CFOP de entrada pelo destino, CST e crédito", () => {
  const nota = lerNfe(XML_COMPRA);
  const [teclado, papel] = nota.itens;
  assert.equal(prefixoEntrada("6102", "PE", "CE"), "2");
  assert.equal(prefixoEntrada("5405", "CE", "CE"), "1");
  assert.deepEqual(sugerir(teclado, { ufEmpresa: "CE" }), { destino: "revenda", cfop: "2102", cst_icms: "000", credito_icms: true, credito_ipi: false });
  const uso = sugerir(papel, { ufEmpresa: "CE", lembrada: { destino: "uso_consumo", cfop_final: "556", credito_icms: false } });
  assert.equal(uso.cfop, "2556");
  assert.equal(uso.credito_icms, false);
  // ST: revenda vira x403; fornecedor do Simples com ST vira CST 60
  assert.equal(sugerir({ ...teclado, cfop: "5405", vICMSST: 0, cst: "60" }, {}).cfop, "1403");
  assert.equal(cstEntrada({ orig: "0", cst: "", csosn: "500" }), "060");
  assert.equal(cstEntrada({ orig: "1", cst: "", csosn: "102" }), "190");
});

test("entrada por XML grava a classificação enviada e lembra por fornecedor", async () => {
  let r = await s.chamar("POST", `/api/empresas/${eid}/estoque/entrada-xml/ler`, { xml: XML_COMPRA });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.itens[0].classificacao.cfop, "2102");
  r = await s.chamar("POST", `/api/empresas/${eid}/estoque/entrada-xml/lancar`, {
    xml: XML_COMPRA, data_entrada: hojeISO(),
    itens: [
      { indice: 1, acao: "vincular", produto_id: produto.id, fator: 1, classificacao: { destino: "revenda", cfop: "2102", cst_icms: "000", credito_icms: true } },
      // papel não entra no estoque, mas é escriturado como uso e consumo (sem crédito)
      { indice: 2, acao: "ignorar", classificacao: { destino: "uso_consumo", cfop: "2556", cst_icms: "000", credito_icms: true } },
    ],
  });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.classificada, true);

  const lista = (await s.chamar("GET", `/api/empresas/${eid}/entradas`)).json;
  assert.equal(lista.length, 1);
  const det = (await s.chamar("GET", `/api/empresas/${eid}/entradas/${lista[0].id}`)).json;
  assert.equal(det.itens[1].classificacao.destino, "uso_consumo");
  assert.equal(det.itens[1].classificacao.credito_icms, true, "a tela pediu crédito e há ICMS destacado");

  // Reclassifica: uso e consumo não credita.
  const itens = det.itens.map((i) => ({ num_item: i.num_item, ...i.classificacao, ...(i.num_item === 2 ? { credito_icms: false } : {}) }));
  r = await s.chamar("PUT", `/api/empresas/${eid}/entradas/${det.id}/classificacao`, { data_entrada: hojeISO(), itens });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.itens[1].classificacao.credito_icms, false);
  // Data de entrada antes da emissão é recusada.
  assert.equal((await s.chamar("PUT", `/api/empresas/${eid}/entradas/${det.id}/classificacao`, { data_entrada: "2020-01-01", itens })).status, 422);
  // O produto ganhou o tipo de item do destino (00 = revenda).
  assert.equal((await s.db.one("SELECT tipo_item FROM produtos WHERE id = $1", [produto.id])).tipo_item, "00");
});

test("prévia aponta o que falta antes de gerar", async () => {
  const r = await s.chamar("POST", `/api/empresas/${eid}/sped/previa`, { periodo: PERIODO });
  assert.equal(r.status, 200, r.body);
  assert.ok(r.json.erros.some((e) => /contabilista/.test(e)));
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/sped/gerar`, { periodo: PERIODO })).status, 422);
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/sped/previa`, { periodo: "2026-13" })).status, 422);
});

function ler(txt) {
  return txt.trimEnd().split("\r\n").map((l) => l.slice(1, -1).split("|"));
}
const valor = (s) => Math.round(Number(s.replace(",", ".")) * 100);

test("perfil B: estrutura, C170 só nas entradas, apuração e bloco 9", async () => {
  assert.equal((await s.chamar("PUT", `/api/empresas/${eid}/sped/config`, CONFIG)).status, 200);
  const g = await s.chamar("POST", `/api/empresas/${eid}/sped/gerar`, { periodo: PERIODO, saldo_credor_anterior_cent: 0 });
  assert.equal(g.status, 200, g.body);
  assert.equal(g.json.perfil, "B");
  const d = await s.chamar("GET", `/api/empresas/${eid}/sped/arquivos/${g.json.id}/download`);
  assert.match(d.headers["content-type"], /iso-8859-1/);
  assert.match(d.headers["content-disposition"], /SpedEFD-11222333000181-/);
  const buf = d.raw;
  const txt = buf.toString("latin1");
  const linhas = ler(txt);

  // Cada linha com a quantidade de campos do leiaute; bloco 9 fecha.
  for (const l of linhas) assert.equal(l.length, LEIAUTE[l[0]], `campos do ${l[0]}`);
  assert.equal(linhas.at(-1)[0], "9999");
  assert.equal(Number(linhas.at(-1)[1]), linhas.length);
  const b0 = linhas.filter((l) => /^0/.test(l[0]));
  assert.equal(Number(linhas.find((l) => l[0] === "0990")[1]), b0.length);
  for (const r of linhas.filter((l) => l[0] === "9900")) {
    assert.equal(Number(r[2]), linhas.filter((l) => l[0] === r[1]).length, `9900 do ${r[1]}`);
  }
  assert.equal(linhas[0][13], "B"); // IND_PERFIL
  const ordem9900 = linhas.filter((l) => l[0] === "9900").map((l) => l[1]);
  assert.equal(ordem9900[0], "0000");
  assert.ok(ordem9900.indexOf("B001") < ordem9900.indexOf("1001"), "blocos na ordem do arquivo");
  assert.equal(ordem9900.at(-1), "9900");

  // Saídas: NF-e autorizada, a cancelada (só identificação) e a inutilizada (COD_SIT 05).
  const c100 = linhas.filter((l) => l[0] === "C100");
  const saidas = c100.filter((l) => l[1] === "1");
  assert.deepEqual(saidas.map((l) => l[5]).sort(), ["00", "02", "05"]);
  const cancelada = saidas.find((l) => l[5] === "02");
  assert.equal(cancelada[8].length, 44);
  assert.ok(cancelada.slice(9).every((x) => x === ""));
  // DIFAL da EC 87 (venda a não contribuinte de SP)
  assert.ok(linhas.some((l) => l[0] === "C101"));
  assert.ok(linhas.some((l) => l[0] === "E300" && l[1] === "SP"));

  // Entrada: C170 dos dois itens; uso e consumo sem crédito no CFOP 2556.
  const idx = linhas.findIndex((l) => l[0] === "C100" && l[1] === "0");
  const filhos = [];
  for (let i = idx + 1; i < linhas.length && !["C100", "C990"].includes(linhas[i][0]); i++) filhos.push(linhas[i]);
  const c170 = filhos.filter((l) => l[0] === "C170");
  assert.equal(c170.length, 2);
  assert.equal(c170[0][2], "P001", "item vinculado usa o código do produto");
  assert.equal(c170[1][2], "F77666555000144-PAP-A4");
  assert.deepEqual(c170.map((l) => l[8]), ["0", "1"], "IND_MOV: estoque 0, fora do estoque 1");
  const c190 = filhos.filter((l) => l[0] === "C190");
  const uso = c190.find((l) => l[2] === "2556");
  assert.equal(valor(uso[5]), 0);
  assert.equal(valor(uso[6]), 0);
  assert.equal(valor(c190.find((l) => l[2] === "2102")[6]), 12000);
  // Saída autorizada não tem C170 no perfil B.
  const iSaida = linhas.findIndex((l) => l[0] === "C100" && l[1] === "1" && l[5] === "00");
  assert.notEqual(linhas[iSaida + 1][0], "C170");

  // 0150 com fornecedor e cliente; 0200 com o tipo do item; 0190 das unidades usadas.
  const p0150 = linhas.filter((l) => l[0] === "0150").map((l) => l[1]);
  assert.ok(p0150.includes("77666555000144") && p0150.includes("11444777000161"));
  assert.equal(linhas.find((l) => l[0] === "0200" && l[1] === "F77666555000144-PAP-A4")[6], "07");
  assert.ok(linhas.some((l) => l[0] === "0190" && l[1] === "CX"));

  // E110: débitos = ICMS das saídas, créditos = só a revenda (120,00).
  const e110 = linhas.find((l) => l[0] === "E110");
  const deb = c100.filter((l) => l[1] === "1" && l[5] === "00").reduce((t, l) => t + valor(l[21]), 0);
  assert.equal(valor(e110[1]), deb);
  assert.equal(valor(e110[5]), 12000);
  const saldo = deb - 12000;
  assert.equal(valor(e110[12]), Math.max(0, saldo));
  assert.equal(valor(e110[13]), Math.max(0, -saldo));

  // Arquivo em ISO-8859-1: "JOÃO" com um byte por letra.
  assert.ok(buf.includes(Buffer.from("JOÃO CONTADOR", "latin1")));
});

test("perfil A detalha também as saídas", async () => {
  const g = await s.chamar("POST", `/api/empresas/${eid}/sped/gerar`, { periodo: PERIODO, perfil: "A", saldo_credor_anterior_cent: 0 });
  assert.equal(g.status, 200, g.body);
  const linhas = ler(Buffer.from((await s.chamar("GET", `/api/empresas/${eid}/sped/arquivos/${g.json.id}/download`)).body, "latin1").toString("latin1"));
  assert.equal(linhas[0][13], "A");
  const iSaida = linhas.findIndex((l) => l[0] === "C100" && l[1] === "1" && l[5] === "00");
  assert.equal(linhas[iSaida + 1][0] === "C101" ? linhas[iSaida + 2][0] : linhas[iSaida + 1][0], "C170");
  const lista = (await s.chamar("GET", `/api/empresas/${eid}/sped/arquivos`)).json;
  assert.equal(lista.length, 2);
});

test("saldo credor: transporta para o mês seguinte", () => {
  const nota = lerNfe(XML_COMPRA);
  const itens = new Map(nota.itens.map((it) => [it.num, {
    classificacao: { destino: "revenda", cfop: "2102", cst_icms: "000", credito_icms: true, credito_ipi: false, tipo_item: "00" }, produto: null, fator: 1,
  }]));
  const efd = montarEfd({
    empresa: { ...EMPRESA, cnpj: "11222333000181", cod_municipio: "2304400" }, config: { ...CONFIG, perfil: "B" },
    periodo: { ini: "2026-10-01", fim: "2026-10-31" }, finalidade: "0", saldoCredorAnteriorCent: 5000,
    saidas: [], entradas: [{ nfe: nota, data_entrada: "2026-10-05", itens }], produtos: new Map(),
  });
  assert.equal(efd.apuracao.creditos_cent, 14400);
  assert.equal(efd.apuracao.icms_recolher_cent, 0);
  assert.equal(efd.apuracao.saldo_credor_transportar_cent, 19400);
  assert.ok(!efd.txt.includes("|E116|"), "sem ICMS a recolher não há E116");
});

test("empresa do Simples Nacional não gera EFD", async () => {
  const outro = await servidorTeste();
  try {
    await outro.login();
    const id = (await outro.chamar("POST", "/api/empresas", { ...EMPRESA, crt: "1" })).json.id;
    await outro.chamar("PUT", `/api/empresas/${id}/sped/config`, CONFIG);
    const r = await outro.chamar("POST", `/api/empresas/${id}/sped/previa`, { periodo: PERIODO });
    assert.ok(r.json.erros.some((e) => /Simples Nacional/.test(e)));
  } finally {
    await outro.fechar();
  }
});

test("notas de homologação ficam fora quando a opção está desligada", async () => {
  await s.chamar("PUT", `/api/empresas/${eid}/sped/config`, { ...CONFIG, incluir_homologacao: false });
  const r = await s.chamar("POST", `/api/empresas/${eid}/sped/previa`, { periodo: PERIODO });
  assert.equal(r.status, 200, r.body);
  assert.ok(r.json.alertas.some((a) => /homologação/.test(a)));
  assert.equal(r.json.resumo.saidas, 0);
  assert.equal(r.json.resumo.entradas, 1);
});
