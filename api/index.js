// Ponto de entrada na Vercel: uma função Node que recebe todo /api/* (ver vercel.json).
// O servidor Fastify é montado uma vez por instância e reaproveitado entre os pedidos;
// o front (web/dist) é servido direto pela Vercel, sem passar por aqui.
import { carregarConfig } from "../src/config.js";
import { abrirBanco } from "../src/db.js";
import { criarApp } from "../src/app.js";

let pronto = null;

function iniciar() {
  pronto ??= (async () => {
    const config = carregarConfig();
    const db = await abrirBanco(config);
    const app = await criarApp({
      config,
      db,
      logger: {
        level: process.env.LOG_LEVEL || "info",
        // Nada de sessão, senha ou certificado nos logs da Vercel.
        redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
      },
    });
    await app.ready();
    return app;
  })().catch((erro) => {
    pronto = null; // próxima chamada tenta de novo (banco fora do ar, variável faltando...)
    throw erro;
  });
  return pronto;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await iniciar();
  } catch (erro) {
    console.error("Falha ao iniciar o Argus Emissor:", erro?.message ?? erro);
    res.statusCode = 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ erro: "Sistema indisponível no momento. Tente de novo em instantes." }));
    return;
  }
  app.server.emit("request", req, res);
}
