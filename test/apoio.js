// Monta um servidor de teste: PGlite em memória, SEFAZ simulada e admin pronto.
import crypto from "node:crypto";
import { carregarConfig } from "../src/config.js";
import { abrirBanco } from "../src/db.js";
import { criarApp } from "../src/app.js";

export const ADMIN = { email: "admin@teste.com", senha: "senha-forte-12345" };

export async function servidorTeste({ fetchImpl } = {}) {
  const config = carregarConfig({
    modoSefaz: "simulado",
    databaseUrl: null,
    pgliteDir: ":memoria:",
    masterKey: crypto.randomBytes(32),
    jwtSecret: crypto.randomBytes(32),
    admin: { nome: "Admin", email: ADMIN.email, senha: ADMIN.senha },
    respTec: { CNPJ: "11222333000181", xContato: "Teste", email: "a@b.com", fone: "85999999999" },
    webDir: "./nao-existe",
  });
  const db = await abrirBanco(config);
  const app = await criarApp({ config, db, fetchImpl });
  let cookie = "";

  async function chamar(method, url, body, { semCsrf = false, cookieAlt } = {}) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (!semCsrf && method !== "GET") headers["x-argus"] = "1";
    const c = cookieAlt ?? cookie;
    if (c) headers.cookie = c;
    const r = await app.inject({ method, url, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers["set-cookie"];
    if (set && cookieAlt === undefined) cookie = String(Array.isArray(set) ? set[0] : set).split(";")[0];
    let json = null;
    try {
      json = r.json();
    } catch {}
    return { status: r.statusCode, json, body: r.body, headers: r.headers };
  }

  async function login(email = ADMIN.email, senha = ADMIN.senha) {
    return chamar("POST", "/api/sessao", { email, senha });
  }

  return { app, db, config, chamar, login, fechar: async () => { await app.close(); await db.fechar(); }, getCookie: () => cookie, setCookie: (c) => (cookie = c) };
}

export const EMPRESA = {
  cnpj: "11.222.333/0001-81", razao_social: "EMPRESA TESTE LTDA", nome_fantasia: "TESTE", ie: "061234567", crt: "3",
  logradouro: "RUA A", numero: "10", bairro: "CENTRO", cod_municipio: "2304400", municipio: "Fortaleza", uf: "CE",
  cep: "60000-000", serie_nfe: 1, proximo_nfe: 1, serie_nfce: 1, proximo_nfce: 1,
};

export const CLIENTE_SP = {
  tipo: "cliente", cpf_cnpj: "11.444.777/0001-61", nome: "CLIENTE PAULISTA LTDA", ind_ie_dest: "9",
  logradouro: "AV PAULISTA", numero: "1000", bairro: "BELA VISTA", cod_municipio: "3550308", municipio: "Sao Paulo", uf: "SP", cep: "01310100", ativo: true,
};
