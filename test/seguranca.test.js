// Políticas de segurança: cabeçalhos, DANFE isolado, limite de login, XML hostil, configuração da
// Vercel e o ponto de entrada serverless (api/index.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { servidorTeste, EMPRESA, CLIENTE_SP, ADMIN } from "./apoio.js";
import { CSP_SITE, CSP_API, CSP_DANFE, CABECALHOS_COMUNS, HSTS } from "../src/cabecalhos.js";
import { carregarConfig } from "../src/config.js";

let s;
let eid;
before(async () => {
  s = await servidorTeste();
  await s.login();
  eid = (await s.chamar("POST", "/api/empresas", EMPRESA)).json.id;
});
after(async () => s.fechar());

test("API: cabeçalhos de segurança, sem cache e sem script", async () => {
  const r = await s.chamar("GET", "/api/eu");
  for (const [k, v] of Object.entries(CABECALHOS_COMUNS)) assert.equal(r.headers[k], v, k);
  assert.equal(r.headers["content-security-policy"], CSP_API);
  assert.equal(r.headers["cache-control"], "no-store");
  // Erros também levam os cabeçalhos.
  const e = await s.chamar("GET", "/api/nao-existe");
  assert.equal(e.status, 404);
  assert.equal(e.headers["x-frame-options"], "DENY");
});

test("DANFE roda isolado (sandbox): texto da nota não alcança a sessão", async () => {
  const perfis = (await s.chamar("GET", `/api/empresas/${eid}/perfis`)).json;
  const prod = (await s.chamar("POST", `/api/empresas/${eid}/produtos`, {
    codigo: "XSS", descricao: '<script>alert(1)</script> CABO', ncm: "8544.42.00", unidade: "UN", preco_cent: 1000, perfil_id: perfis[0].id, ativo: true,
  })).json;
  const cli = (await s.chamar("POST", `/api/empresas/${eid}/pessoas`, CLIENTE_SP)).json;
  const p = await s.chamar("POST", `/api/empresas/${eid}/pedidos`, {
    tipo: "pedido", cliente_id: cli.id, itens: [{ produto_id: prod.id, quantidade: 1, valor_unitario_cent: 1000 }], forma_pagamento: "01", emitir: true,
  });
  assert.equal(p.json.nota.status, "autorizada", p.body);
  const d = await s.chamar("GET", `/api/empresas/${eid}/notas/${p.json.nota.id}/danfe`);
  assert.equal(d.headers["content-security-policy"], CSP_DANFE);
  assert.match(CSP_DANFE, /sandbox allow-scripts allow-modals/);
  assert.doesNotMatch(d.body, /<script>alert/);
  assert.match(d.body, /&lt;script&gt;alert/);
});

test("login: limite por e-mail no banco e mesma resposta para e-mail inexistente", async () => {
  const outro = await servidorTeste();
  try {
    for (let i = 0; i < 10; i++) {
      const r = await outro.chamar("POST", "/api/sessao", { email: ADMIN.email, senha: `errada-${i}` });
      assert.equal(r.status, 401);
    }
    const bloqueado = await outro.chamar("POST", "/api/sessao", { email: ADMIN.email, senha: ADMIN.senha });
    assert.equal(bloqueado.status, 429, "a senha certa também espera depois de 10 erros");
    const inexistente = await outro.chamar("POST", "/api/sessao", { email: "ninguem@teste.com", senha: "x" });
    assert.equal(inexistente.status, 401);
    assert.equal(inexistente.json.erro, "E-mail ou senha incorretos.");
    // Passada a janela, volta a entrar (e o acerto limpa as tentativas).
    await outro.db.query("UPDATE tentativas_login SET criado_em = now() - interval '16 minutes'");
    assert.equal((await outro.chamar("POST", "/api/sessao", { email: ADMIN.email, senha: ADMIN.senha })).status, 200);
    assert.equal((await outro.db.one("SELECT count(*)::int AS n FROM tentativas_login WHERE email = $1", [ADMIN.email])).n, 0);
  } finally {
    await outro.fechar();
  }
});

test("XML de compra com DOCTYPE/ENTITY é recusado antes de ser lido", async () => {
  const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]><nfeProc>&b;</nfeProc>`;
  const r = await s.chamar("POST", `/api/empresas/${eid}/estoque/entrada-xml/ler`, { xml });
  assert.equal(r.status, 422);
  assert.match(r.json.erro, /DOCTYPE/);
});

test("vercel.json: mesmos cabeçalhos do servidor e a API sem cache da CDN", () => {
  const v = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const site = v.headers.find((h) => h.source === "/((?!api/).*)");
  const mapa = Object.fromEntries(site.headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(mapa["content-security-policy"], `${CSP_SITE}; upgrade-insecure-requests`);
  for (const [k, val] of Object.entries(CABECALHOS_COMUNS)) assert.equal(mapa[k], val, k);
  assert.equal(mapa["strict-transport-security"], HSTS);
  assert.ok(v.rewrites.some((r) => r.destination === "/api"));
  assert.ok(v.functions["api/index.js"].includeFiles.includes("node-sped-nfe/schemas"));
});

test("config na Vercel: exige Postgres externo, chaves e cookie seguro", () => {
  const chaves = { masterKey: Buffer.alloc(32, 1), jwtSecret: Buffer.alloc(32, 2) };
  assert.throws(() => carregarConfig({ serverless: true, databaseUrl: null, ...chaves }), /Postgres externo/);
  const c = carregarConfig({ serverless: true, databaseUrl: "postgres://u:p@h/db", ...chaves });
  assert.equal(c.cookieSeguro, true);
  assert.throws(() => carregarConfig({ serverless: false, masterKey: Buffer.alloc(32, 3), jwtSecret: Buffer.alloc(32, 3) }), /diferentes/);
});

test("cookie da sessão: HttpOnly, SameSite=Strict e Secure quando HTTPS", async () => {
  const seguro = await servidorTeste({ config: { cookieSeguro: true } });
  try {
    const r = await seguro.login();
    const c = String(r.headers["set-cookie"]);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    assert.match(c, /Secure/);
    assert.equal(r.headers["strict-transport-security"], HSTS);
  } finally {
    await seguro.fechar();
  }
});

test("api/index.js (Vercel): atende /api pelo servidor Fastify", async () => {
  process.env.PGLITE_DIR = ":memoria:";
  process.env.SEFAZ_MODO = "simulado";
  const { default: handler } = await import("../api/index.js");
  const srv = http.createServer(handler);
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const saude = await fetch(`${base}/api/saude`);
    assert.equal(saude.status, 200);
    assert.deepEqual(await saude.json(), { ok: true, versao: "1.0.0" });
    assert.equal(saude.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${base}/api/eu`)).status, 401);
  } finally {
    srv.close();
  }
});
