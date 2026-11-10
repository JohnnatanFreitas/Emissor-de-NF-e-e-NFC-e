// Emissão simplificada (operação pré-configurada) e NFS-e no padrão nacional (modo simulado).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { servidorTeste, EMPRESA, CLIENTE_SP } from "./apoio.js";
import { calcularNfse } from "../src/nfse/regras.js";
import { chaveNfse, idDps } from "../src/nfse/dps.js";

let s;
let eid;
let revenda;
let producao;
let cliente;

const TOMADOR_PF = { tipo: "cliente", cpf_cnpj: "529.982.247-25", nome: "MARIA DA SILVA", ind_ie_dest: "9", logradouro: "RUA B", numero: "5", bairro: "CENTRO", cod_municipio: "2304400", municipio: "Fortaleza", uf: "CE", cep: "60000000", ativo: true };

before(async () => {
  s = await servidorTeste();
  await s.login();
  eid = (await s.chamar("POST", "/api/empresas", { ...EMPRESA, im: "123456" })).json.id;
  const perfis = (await s.chamar("GET", `/api/empresas/${eid}/perfis`)).json;
  const pid = (nome) => perfis.find((p) => p.nome === nome).id;
  revenda = (await s.chamar("POST", `/api/empresas/${eid}/produtos`, { codigo: "R1", descricao: "CABO HDMI", ncm: "8544.42.00", unidade: "UN", preco_cent: 5000, perfil_id: pid("Revenda de mercadoria"), ativo: true })).json;
  producao = (await s.chamar("POST", `/api/empresas/${eid}/produtos`, { codigo: "F1", descricao: "MESA FABRICADA", ncm: "9403.30.00", unidade: "UN", preco_cent: 30000, perfil_id: pid("Venda de produção própria"), ativo: true })).json;
  for (const p of [revenda, producao]) await s.chamar("POST", `/api/empresas/${eid}/estoque/ajuste`, { produto_id: p.id, tipo: "entrada_manual", quantidade: 100, custo_unitario_cent: 1000 });
  cliente = (await s.chamar("POST", `/api/empresas/${eid}/pessoas`, CLIENTE_SP)).json;
});
after(async () => s.fechar());

// ---------------- Emissão simplificada ----------------

test("lista as operações com natureza e cobrança", async () => {
  const r = await s.chamar("GET", "/api/operacoes");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((o) => o.valor), ["venda", "bonificacao", "transferencia", "outras"]);
  assert.equal(r.json.find((o) => o.valor === "bonificacao").cobranca, false);
});

test("prévia: a operação define o CFOP; CST e alíquota vêm do perfil", async () => {
  const itens = [{ produto_id: revenda.id, quantidade: 1 }];
  const venda = (await s.chamar("POST", `/api/empresas/${eid}/calculo`, { modelo: "55", cliente_id: cliente.id, itens })).json;
  const bonif = (await s.chamar("POST", `/api/empresas/${eid}/calculo`, { modelo: "55", cliente_id: cliente.id, itens, operacao: "bonificacao" })).json;
  assert.equal(venda.itens[0].cfop, "6108"); // venda interestadual a não contribuinte
  assert.equal(bonif.itens[0].cfop, "6910");
  assert.equal(bonif.itens[0].cst_icms, venda.itens[0].cst_icms);
  assert.equal(bonif.itens[0].aliq_icms, venda.itens[0].aliq_icms);
  const transf = (await s.chamar("POST", `/api/empresas/${eid}/calculo`, { modelo: "55", cliente_id: cliente.id, itens: [{ produto_id: producao.id, quantidade: 1 }], operacao: "transferencia" })).json;
  assert.equal(transf.itens[0].cfop, "6151", "produção própria transfere com 151");
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/calculo`, { modelo: "55", cliente_id: cliente.id, itens, operacao: "xpto" })).status, 422);
});

test("emite venda e bonificação; bonificação sem cobrança e sem contas a receber", async () => {
  let r = await s.chamar("POST", `/api/empresas/${eid}/emissao-rapida`, { operacao: "venda", modelo: "55", cliente_id: cliente.id, itens: [{ produto_id: revenda.id, quantidade: 2 }] });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.status, "autorizada");
  assert.equal(r.json.natureza, "VENDA");

  r = await s.chamar("POST", `/api/empresas/${eid}/emissao-rapida`, { operacao: "bonificacao", modelo: "55", cliente_id: cliente.id, itens: [{ produto_id: revenda.id, quantidade: 1 }] });
  assert.equal(r.status, 200, r.body);
  assert.match(r.json.natureza, /BONIFICACAO/);
  const xml = (await s.chamar("GET", `/api/empresas/${eid}/notas/${r.json.id}/xml`)).body;
  assert.match(xml, /<CFOP>6910<\/CFOP>/);
  assert.match(xml, /<tPag>90<\/tPag>/);
  assert.match(xml, /<natOp>REMESSA EM BONIFICACAO/);
  assert.equal((await s.chamar("GET", `/api/empresas/${eid}/receber`)).json.length, 0);
  const prod = (await s.chamar("GET", `/api/empresas/${eid}/produtos?busca=R1`)).json[0];
  assert.equal(prod.estoque, 97, "venda (2) e bonificação (1) baixam o estoque");

  r = await s.chamar("POST", `/api/empresas/${eid}/emissao-rapida`, { operacao: "bonificacao", modelo: "65", itens: [{ produto_id: revenda.id, quantidade: 1 }] });
  assert.equal(r.status, 422);
});

// ---------------- NFS-e ----------------

test("cálculo da NFS-e: ISS, retenções federais e IBS/CBS de 2026", () => {
  const c = calcularNfse({ ano: 2026, valor_servico_cent: 100000, regime: "normal", aliq_iss: 5, tomador_pj: true });
  assert.equal(c.iss_cent, 5000);
  assert.equal(c.irrf_cent, 1500);
  assert.equal(c.pis_cent, 650);
  assert.equal(c.cofins_cent, 3000);
  assert.equal(c.csll_cent, 1000);
  assert.equal(c.cbs_cent, 900);
  assert.equal(c.ibs_uf_cent, 100);
  assert.equal(c.ibs_mun_cent, 0);
  assert.equal(c.liquido_cent, 100000 - 1500 - 650 - 3000 - 1000);
  // ISS retido entra nas retenções
  assert.equal(calcularNfse({ ano: 2026, valor_servico_cent: 100000, regime: "normal", aliq_iss: 5, tomador_pj: true, iss_retido: true }).retencoes_cent, 11150);
  // Simples: sem retenções federais e sem destaque de IBS/CBS; PF: sem retenções
  const sn = calcularNfse({ ano: 2026, valor_servico_cent: 100000, regime: "simples", aliq_iss: 3, tomador_pj: true });
  assert.equal(sn.retencoes_cent, 0);
  assert.equal(sn.cbs_cent, 0);
  assert.equal(calcularNfse({ ano: 2026, valor_servico_cent: 100000, regime: "normal", aliq_iss: 5, tomador_pj: false }).retencoes_cent, 0);
  // IRRF abaixo de R$ 10,00 é dispensado; em 2027 PIS/COFINS deixam de existir
  assert.equal(calcularNfse({ ano: 2026, valor_servico_cent: 50000, regime: "normal", aliq_iss: 2, tomador_pj: true }).irrf_cent, 0);
  const y27 = calcularNfse({ ano: 2027, valor_servico_cent: 100000, regime: "normal", aliq_iss: 5, tomador_pj: true });
  assert.equal(y27.pis_cent + y27.cofins_cent, 0);
  assert.equal(y27.cbs_cent, 8800);
});

test("chave da NFS-e (50 dígitos) e Id da DPS", () => {
  const ch = chaveNfse({ cod_municipio: "2304400", cnpj: "11222333000181", numero_nfse: 7, data: "2026-11-09", codigo: 123 });
  assert.equal(ch.length, 50);
  assert.equal(ch.slice(0, 7), "2304400");
  assert.equal(ch.slice(9, 23), "11222333000181");
  assert.equal(ch.slice(36, 40), "2611");
  const id = idDps({ cod_municipio: "2304400", cnpj: "11222333000181", serie: 1, numero: 42 });
  assert.equal(id, "DPS230440021122233300018100001000000000000042");
});

let servico;
let tomadorPj;
test("serviços: valida código nacional e alíquota do ISS", async () => {
  assert.ok((await s.chamar("GET", "/api/nfse/catalogo")).json.length >= 5);
  const base = { cod_trib_nac: "01.01.01", item_lc116: "01.01", descricao: "Desenvolvimento de sistemas", aliq_iss: 5 };
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/nfse/servicos`, { ...base, cod_trib_nac: "0101" })).status, 422);
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/nfse/servicos`, { ...base, aliq_iss: 6 })).status, 422);
  const r = await s.chamar("POST", `/api/empresas/${eid}/nfse/servicos`, base);
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.cod_trib_nac, "010101");
  servico = r.json;
  tomadorPj = (await s.chamar("POST", `/api/empresas/${eid}/pessoas`, { ...CLIENTE_SP, cpf_cnpj: "11.444.777/0001-61" })).json;
});

let nfse;
test("emite NFS-e simulada: número, chave, DPS, DANFSe e XML", async () => {
  const pedido = { servico_id: servico.id, tomador_id: tomadorPj.id, valor_servico_cent: 100000, descricao: "Desenvolvimento do módulo de faturamento - novembro/2026" };
  const calc = await s.chamar("POST", `/api/empresas/${eid}/nfse/calculo`, pedido);
  assert.equal(calc.status, 200, calc.body);
  assert.equal(calc.json.irrf_cent, 1500);

  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/nfse`, { ...pedido, descricao: "x" })).status, 422);
  const r = await s.chamar("POST", `/api/empresas/${eid}/nfse`, pedido);
  assert.equal(r.status, 200, r.body);
  nfse = r.json;
  assert.equal(nfse.status, "autorizada");
  assert.equal(nfse.modo, "simulado");
  assert.equal(nfse.numero_nfse, "1");
  assert.equal(nfse.numero_dps, 1);
  assert.equal(nfse.chave.length, 50);

  const xml = (await s.chamar("GET", `/api/empresas/${eid}/nfse/${nfse.id}/xml`)).body;
  assert.match(xml, /<infDPS Id="DPS2304400211222333000181000010{14}1">/);
  assert.match(xml, /<cTribNac>010101<\/cTribNac>/);
  assert.match(xml, /<vServ>1000.00<\/vServ>/);
  assert.match(xml, /<opSimpNac>1<\/opSimpNac>/);
  assert.match(xml, /<vRetIRRF>15.00<\/vRetIRRF>/);
  assert.match(xml, /<IM>123456<\/IM>/);

  const danfse = await s.chamar("GET", `/api/empresas/${eid}/nfse/${nfse.id}/danfse`);
  assert.match(danfse.body, /SIMULADA - SEM VALOR FISCAL/);
  assert.match(danfse.body, /<svg/);
  assert.match(danfse.headers["content-security-policy"], /sandbox/);

  // Próxima nota: DPS e NFS-e seguem a numeração
  const r2 = await s.chamar("POST", `/api/empresas/${eid}/nfse`, { ...pedido, tomador_id: (await s.chamar("POST", `/api/empresas/${eid}/pessoas`, TOMADOR_PF)).json.id });
  assert.equal(r2.json.numero_dps, 2);
  assert.equal(r2.json.numero_nfse, "2");
  assert.equal(r2.json.valores.retencoes_cent, 0, "tomador pessoa física não retém");
  assert.equal((await s.chamar("GET", `/api/empresas/${eid}/nfse`)).json.length, 2);
});

test("cancela a NFS-e com motivo e não cancela duas vezes", async () => {
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/nfse/${nfse.id}/cancelar`, { motivo: "curto" })).status, 422);
  const r = await s.chamar("POST", `/api/empresas/${eid}/nfse/${nfse.id}/cancelar`, { motivo: "Serviço faturado em duplicidade" });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.status, "cancelada");
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/nfse/${nfse.id}/cancelar`, { motivo: "Serviço faturado em duplicidade" })).status, 409);
  assert.match((await s.chamar("GET", `/api/empresas/${eid}/nfse/${nfse.id}/danfse`)).body, /CANCELADA/);
});

test("empresa do Simples: regime 3 na DPS e sem retenções", async () => {
  const outro = await servidorTeste();
  try {
    await outro.login();
    const id = (await outro.chamar("POST", "/api/empresas", { ...EMPRESA, crt: "1" })).json.id;
    const sv = (await outro.chamar("POST", `/api/empresas/${id}/nfse/servicos`, { cod_trib_nac: "171901", descricao: "Contabilidade", aliq_iss: 3 })).json;
    const tm = (await outro.chamar("POST", `/api/empresas/${id}/pessoas`, { ...CLIENTE_SP, cpf_cnpj: "11.444.777/0001-61" })).json;
    const r = await outro.chamar("POST", `/api/empresas/${id}/nfse`, { servico_id: sv.id, tomador_id: tm.id, valor_servico_cent: 200000, descricao: "Honorários contábeis de novembro" });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.valores.retencoes_cent, 0);
    assert.equal(r.json.valores.iss_cent, 6000);
    const xml = (await outro.chamar("GET", `/api/empresas/${id}/nfse/${r.json.id}/xml`)).body;
    assert.match(xml, /<opSimpNac>3<\/opSimpNac><regApTribSN>1<\/regApTribSN>/);
  } finally {
    await outro.fechar();
  }
});
