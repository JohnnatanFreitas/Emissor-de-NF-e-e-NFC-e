// Monta o servidor Fastify: sessão por cookie, anti-CSRF, erros em { erro }, rotas e o front (web/dist).
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fs from "node:fs";
import path from "node:path";
import { lerToken, hashSenha } from "./seguranca.js";
import { ErroHttp } from "./util.js";
import { registrarCabecalhos } from "./cabecalhos.js";
import { rotasSessao } from "./rotas/sessao.js";
import { rotasEmpresas } from "./rotas/empresas.js";
import { rotasCadastros } from "./rotas/cadastros.js";
import { rotasVendas } from "./rotas/vendas.js";
import { rotasEstoque } from "./rotas/estoque.js";
import { rotasFinanceiro } from "./rotas/financeiro.js";

export const COOKIE = "argus_sessao";
const ESCRITA = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Rotas que funcionam sem login, ou enquanto a senha provisória não foi trocada.
const PUBLICAS = new Set(["POST /api/sessao", "GET /api/saude"]);
const DURANTE_TROCA = new Set(["GET /api/eu", "POST /api/eu/senha", "DELETE /api/sessao"]);

/** Cria o primeiro administrador a partir do .env, se ainda não existe nenhum usuário. */
export async function garantirAdmin(db, config, log) {
  const { n } = await db.one("SELECT count(*)::int AS n FROM usuarios");
  if (n > 0) return;
  if (!config.admin.email || !config.admin.senha) {
    log?.warn("Nenhum usuário cadastrado: preencha ADMIN_EMAIL e ADMIN_SENHA no .env para o primeiro acesso.");
    return;
  }
  await db.query(
    "INSERT INTO usuarios (nome, email, senha_hash, papel, trocar_senha) VALUES ($1, $2, $3, 'admin', false) ON CONFLICT (email) DO NOTHING",
    [config.admin.nome, config.admin.email, hashSenha(config.admin.senha)]
  );
  log?.info(`Administrador ${config.admin.email} criado.`);
}

export async function criarApp({ config, db, logger = false, fetchImpl }) {
  const app = Fastify({
    logger,
    // A Vercel aceita no máximo 4,5 MB por pedido; certificado e XML de compra cabem com folga.
    bodyLimit: (config.serverless ? 4 : 15) * 1024 * 1024,
    // Atrás de proxy (Vercel, nginx): o IP do cliente vem do X-Forwarded-For (limite de login).
    trustProxy: true,
  });
  await app.register(cookie);
  registrarCabecalhos(app, { https: config.cookieSeguro });

  app.decorateRequest("usuario", null);

  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    const rota = `${req.method} ${req.routeOptions?.url ?? req.url.split("?")[0]}`;
    if (ESCRITA.has(req.method) && req.headers["x-argus"] !== "1") throw new ErroHttp(403, "Requisição recusada (cabeçalho X-Argus ausente).");
    if (PUBLICAS.has(rota)) return;
    const dados = lerToken(req.cookies[COOKIE], config.jwtSecret);
    if (!dados) throw new ErroHttp(401, "Sessão expirada. Entre de novo.");
    const u = await db.one("SELECT * FROM usuarios WHERE id = $1", [dados.uid]);
    // A sessão cai quando o usuário é desativado ou troca a senha (versão no token).
    if (!u || !u.ativo || dados.v !== u.senha_hash.slice(-12)) throw new ErroHttp(401, "Sessão expirada. Entre de novo.");
    req.usuario = u;
    if (u.trocar_senha && !DURANTE_TROCA.has(rota)) throw new ErroHttp(403, "Troque a senha provisória para continuar.");
  });

  app.setErrorHandler((erro, req, reply) => {
    let status = erro.status ?? erro.statusCode ?? 500;
    if (erro.validation) status = 422;
    if (erro.code === "FST_ERR_CTP_BODY_TOO_LARGE") status = 413;
    // Violação de chave única do Postgres
    if (erro.code === "23505") {
      status = 409;
      erro.message = "Já existe um cadastro com esses dados (código, CNPJ ou número repetido).";
    }
    if (status >= 500) req.log.error(erro);
    reply.status(status).send({ erro: status >= 500 && !erro.status ? "Erro interno. Veja o log do servidor." : erro.message });
  });

  const deps = { db, config, fetchImpl };
  await app.register(async (api) => {
    await rotasSessao(api, deps);
    await rotasEmpresas(api, deps);
    await rotasCadastros(api, deps);
    await rotasVendas(api, deps);
    await rotasEstoque(api, deps);
    await rotasFinanceiro(api, deps);
  }, { prefix: "/api" });

  app.all("/api/*", async () => {
    throw new ErroHttp(404, "Rota não encontrada.");
  });

  // Front-end compilado (web/dist). Qualquer rota fora de /api devolve o index.html (SPA).
  const web = path.resolve(config.webDir);
  if (!config.serverless && fs.existsSync(path.join(web, "index.html"))) {
    // wildcard: true lê o disco a cada pedido (um build novo do front vale sem reiniciar).
    // Import só aqui: na Vercel a CDN serve o front e este módulo (que exige require de ESM) nem carrega.
    const { default: fastifyStatic } = await import("@fastify/static");
    await app.register(fastifyStatic, { root: web, wildcard: true });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ erro: "Rota não encontrada." });
      return reply.sendFile("index.html");
    });
  }

  await garantirAdmin(db, config, app.log);
  return app;
}
