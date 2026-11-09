// Fluxo completo do guia, com SEFAZ simulada: login, empresa, perfis, produto, estoque, cliente,
// pedido com boleto -> NF-e, CC-e, cancelamento, NFC-e, entrada por XML e contas a receber.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { servidorTeste, EMPRESA, CLIENTE_SP } from "./apoio.js";

let s;
let eid;
let perfis;
let produto;
let cliente;

before(async () => {
  s = await servidorTeste();
});
after(async () => s.fechar());

test("sem sessão: 401; escrita sem X-Argus: 403", async () => {
  assert.equal((await s.chamar("GET", "/api/eu")).status, 401);
  assert.equal((await s.chamar("POST", "/api/sessao", { email: "x", senha: "y" }, { semCsrf: true })).status, 403);
  const saude = await s.chamar("GET", "/api/saude");
  assert.deepEqual(Object.keys(saude.json).sort(), ["ok", "versao"]);
  assert.equal((await s.chamar("GET", "/api/saude/detalhes")).status, 401);
});

test("login do admin do .env e senha errada", async () => {
  assert.equal((await s.login("admin@teste.com", "errada")).status, 401);
  const r = await s.login();
  assert.equal(r.status, 200);
  assert.equal(r.json.papel, "admin");
  assert.ok(r.json.acoes.includes("liberar_producao"));
});

test("cadastra empresa em homologação com 3 perfis padrão", async () => {
  const r = await s.chamar("POST", "/api/empresas", EMPRESA);
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.ambiente, 2);
  assert.equal(r.json.cnpj, "11222333000181");
  eid = r.json.id;
  perfis = (await s.chamar("GET", `/api/empresas/${eid}/perfis`)).json;
  assert.equal(perfis.length, 3);
  assert.equal(perfis[0].aliq_cbs, 0.9);
  // CNPJ inválido
  assert.equal((await s.chamar("POST", "/api/empresas", { ...EMPRESA, cnpj: "11222333000100" })).status, 422);
});

test("produto, entrada manual no estoque e cliente", async () => {
  const revenda = perfis.find((p) => p.nome === "Revenda de mercadoria");
  let r = await s.chamar("POST", `/api/empresas/${eid}/produtos`, {
    codigo: "P001", descricao: "CABO HDMI 2M", ncm: "8544.42.00", unidade: "UN", preco_cent: 3990, perfil_id: revenda.id, estoque_minimo: 2, ativo: true,
  });
  assert.equal(r.status, 200, r.body);
  produto = r.json;
  assert.equal(produto.perfil_nome, "Revenda de mercadoria");
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/produtos`, { ...r.json, ncm: "123" })).status, 422);

  r = await s.chamar("POST", `/api/empresas/${eid}/estoque/ajuste`, { produto_id: produto.id, tipo: "entrada_manual", quantidade: 10, custo_unitario_cent: 2000 });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.saldo_apos, 10);

  r = await s.chamar("POST", `/api/empresas/${eid}/pessoas`, CLIENTE_SP);
  assert.equal(r.status, 200, r.body);
  cliente = r.json;
});

test("cálculo do resumo: interestadual a não contribuinte com DIFAL, IBS e CBS", async () => {
  const r = await s.chamar("POST", `/api/empresas/${eid}/calculo`, { modelo: "55", cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 2 }] });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.interestadual, true);
  assert.equal(r.json.itens[0].cfop, "6108");
  assert.equal(r.json.totais.produtos_cent, 7980);
  assert.equal(r.json.totais.icms_cent, 958); // 12% de 79,80
  assert.ok(r.json.totais.icms_uf_dest_cent > 0);
  assert.ok(r.json.totais.ibs_cent > 0 && r.json.totais.cbs_cent > 0);
  assert.equal(r.json.totais.total_cent, 7980);
});

let nota;
test("pedido com boleto em 2 parcelas: salvar e emitir NF-e", async () => {
  const r = await s.chamar("POST", `/api/empresas/${eid}/pedidos`, {
    tipo: "pedido", cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 3, valor_unitario_cent: 4000 }],
    forma_pagamento: "15", parcelas: 2, primeiro_vencimento: "2026-12-10", intervalo_dias: 30, emitir: true,
  });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.erro_emissao, undefined, r.json.erro_emissao);
  assert.equal(r.json.nota.status, "autorizada");
  assert.equal(r.json.pedido.status, "faturado");
  nota = r.json.nota;
  assert.equal(nota.numero, 1);
  assert.equal(nota.chave.length, 44);

  const prod = (await s.chamar("GET", `/api/empresas/${eid}/produtos?busca=P001`)).json[0];
  assert.equal(prod.estoque, 7);

  const rec = (await s.chamar("GET", `/api/empresas/${eid}/receber`)).json;
  assert.equal(rec.length, 2);
  assert.equal(rec.reduce((t, p) => t + p.valor_cent, 0), 12000);
  assert.equal(rec[1].vencimento, "2027-01-09");

  const xml = await s.chamar("GET", `/api/empresas/${eid}/notas/${nota.id}/xml`);
  assert.match(xml.body, /<nfeProc/);
  assert.match(xml.body, /<cobr><fat>/);
  assert.match(xml.body, /<IBSCBS>/);
  assert.match(xml.body, /NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO/);
  assert.match(xml.body, /<infRespTec>/);

  const danfe = await s.chamar("GET", `/api/empresas/${eid}/notas/${nota.id}/danfe`);
  assert.equal(danfe.status, 200);
  assert.match(danfe.body, /DANFE/);
  assert.match(danfe.body, /SEM VALOR FISCAL/);

  // Próximo número avançou
  assert.equal((await s.chamar("GET", `/api/empresas/${eid}`)).json.proximo_nfe, 2);
});

test("carta de correção e cancelamento devolvem estoque, cancelam parcelas e reabrem o pedido", async () => {
  let r = await s.chamar("POST", `/api/empresas/${eid}/notas/${nota.id}/cce`, { correcao: "curta" });
  assert.equal(r.status, 422);
  r = await s.chamar("POST", `/api/empresas/${eid}/notas/${nota.id}/cce`, { correcao: "Correcao do endereco de entrega do cliente" });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.eventos[0].tipo, "cce");

  r = await s.chamar("POST", `/api/empresas/${eid}/notas/${nota.id}/cancelar`, { justificativa: "Cliente desistiu da compra antes do envio" });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.status, "cancelada");
  const prod = (await s.chamar("GET", `/api/empresas/${eid}/produtos?busca=P001`)).json[0];
  assert.equal(prod.estoque, 10);
  const rec = (await s.chamar("GET", `/api/empresas/${eid}/receber?status=cancelada`)).json;
  assert.equal(rec.length, 2);
  const ped = (await s.chamar("GET", `/api/empresas/${eid}/pedidos/${nota.pedido_id}`)).json;
  assert.equal(ped.status, "aberto");
  // Não cancela duas vezes
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/notas/${nota.id}/cancelar`, { justificativa: "Cliente desistiu da compra antes do envio" })).status, 409);
});

test("NFC-e exige CSC e depois emite com QR Code e troco", async () => {
  const venda = { cpf: "529.982.247-25", itens: [{ produto_id: produto.id, quantidade: 1 }], pagamentos: [{ tPag: "01", valor_cent: 5000 }] };
  let r = await s.chamar("POST", `/api/empresas/${eid}/nfce`, venda);
  assert.equal(r.status, 422);
  assert.match(r.json.erro, /CSC/);
  await s.chamar("PUT", `/api/empresas/${eid}`, { csc_id: "000001", csc: "ABCDEF123456" });
  r = await s.chamar("POST", `/api/empresas/${eid}/nfce`, venda);
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.modelo, "65");
  assert.equal(r.json.status, "autorizada");
  const xml = (await s.chamar("GET", `/api/empresas/${eid}/notas/${r.json.id}/xml`)).body;
  assert.match(xml, /<qrCode>[^<]+\?p=\d{44}\|2\|2\|1\|[0-9A-F]{40}<\/qrCode>/);
  assert.match(xml, /<vTroco>10.10<\/vTroco>/);
  assert.match(xml, /<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xProd>/);
  const danfe = (await s.chamar("GET", `/api/empresas/${eid}/notas/${r.json.id}/danfe`)).body;
  assert.match(danfe, /DANFE NFC-e/);
  assert.match(danfe, /<svg/);
});

test("entrada por XML: cria fornecedor e produto, calcula custo com IPI e ST, e lembra o vínculo", async () => {
  const xml = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe23261199888777000155550010000012341000000017" versao="4.00">
  <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-11-01T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>99888777000155</CNPJ><xNome>DISTRIBUIDORA X</xNome><IE>123</IE><enderEmit><xLgr>RUA Z</xLgr><nro>1</nro><xBairro>B</xBairro><cMun>2304400</cMun><xMun>Fortaleza</xMun><UF>CE</UF><CEP>60000000</CEP></enderEmit></emit>
  <dest><CNPJ>11222333000181</CNPJ></dest>
  <det nItem="1"><prod><cProd>ABC</cProd><cEAN>SEM GTIN</cEAN><xProd>MOUSE USB CX12</xProd><NCM>84716053</NCM><CFOP>5102</CFOP><uCom>CX</uCom><qCom>2</qCom><vUnCom>120.00</vUnCom><vProd>240.00</vProd></prod>
    <imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vICMSST>12.00</vICMSST></ICMS10></ICMS><IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vIPI>24.00</vIPI></IPITrib></IPI></imposto></det>
  <total><ICMSTot><vNF>276.00</vNF><vFrete>0.00</vFrete></ICMSTot></total></infNFe></NFe></nfeProc>`;
  let r = await s.chamar("POST", `/api/empresas/${eid}/estoque/entrada-xml/ler`, { xml });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.itens[0].custo_total_cent, 27600);
  assert.equal(r.json.itens[0].sugestao.acao, "criar");
  r = await s.chamar("POST", `/api/empresas/${eid}/estoque/entrada-xml/lancar`, {
    xml, itens: [{ indice: 1, acao: "criar", fator: 12, novo: { codigo: "M001", descricao: "MOUSE USB", unidade: "UN", preco_cent: 2500, perfil_id: perfis[0].id } }],
  });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.movimentos, 1);
  const p = (await s.chamar("GET", `/api/empresas/${eid}/produtos?busca=M001`)).json[0];
  assert.equal(p.estoque, 24);
  assert.equal(p.custo_medio_cent, 1150); // 276,00 / 24
  // Segunda leitura: já lançada e vínculo sugerido
  r = await s.chamar("POST", `/api/empresas/${eid}/estoque/entrada-xml/ler`, { xml });
  assert.equal(r.json.ja_lancada, true);
  assert.equal(r.json.itens[0].sugestao.acao, "vincular");
  assert.equal(r.json.itens[0].sugestao.fator, 12);
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/estoque/entrada-xml/lancar`, { xml, itens: [] })).status, 409);
});

test("reemitir o pedido reaberto gera nova NF-e e baixa no contas a receber", async () => {
  let r = await s.chamar("POST", `/api/empresas/${eid}/pedidos/${nota.pedido_id}/emitir`);
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.nota.status, "autorizada");
  assert.equal(r.json.nota.numero, 2);
  const abertas = (await s.chamar("GET", `/api/empresas/${eid}/receber?status=aberta`)).json;
  assert.equal(abertas.length, 2);
  r = await s.chamar("POST", `/api/empresas/${eid}/receber/${abertas[0].id}/baixar`, { recebida_em: "2026-12-10" });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.status, "recebida");
  const painel = (await s.chamar("GET", `/api/empresas/${eid}/painel`)).json;
  assert.equal(painel.notas_mes, 2); // NF-e 2 + NFC-e (a cancelada não conta)
  assert.equal(painel.faturamento_dias.length, 30);
});

test("usuários: vendedor criado com senha provisória não cancela nota nem vê usuários", async () => {
  const adminCookie = s.getCookie();
  let r = await s.chamar("POST", "/api/usuarios", { nome: "Vend", email: "vend@teste.com", papel: "vendedor", empresas: [eid], senha: "provisoria-1234" });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.trocar_senha, true);
  r = await s.login("vend@teste.com", "provisoria-1234");
  assert.equal(r.status, 200);
  assert.equal((await s.chamar("GET", `/api/empresas/${eid}/notas`)).status, 403); // precisa trocar a senha
  assert.equal((await s.chamar("POST", "/api/eu/senha", { senha_atual: "provisoria-1234", nova_senha: "nova-senha-vendedor" })).status, 200);
  assert.equal((await s.chamar("GET", `/api/empresas/${eid}/notas`)).status, 200);
  assert.equal((await s.chamar("GET", "/api/usuarios")).status, 403);
  const notas = (await s.chamar("GET", `/api/empresas/${eid}/notas?modelo=55&status=autorizada`)).json;
  assert.equal((await s.chamar("POST", `/api/empresas/${eid}/notas/${notas[0].id}/cancelar`, { justificativa: "tentativa do vendedor sem permissao" })).status, 403);
  s.setCookie(adminCookie);
});
