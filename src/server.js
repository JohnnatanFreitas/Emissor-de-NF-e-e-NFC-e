import { carregarConfig } from "./config.js";
import { abrirBanco } from "./db.js";
import { criarApp } from "./app.js";

const config = carregarConfig();
const db = await abrirBanco(config);
const app = await criarApp({ config, db, logger: { level: process.env.LOG_LEVEL || "info" } });

if (config.chavesTemporarias) {
  app.log.warn("MASTER_KEY/JWT_SECRET ausentes: usando chaves temporárias (certificados cadastrados não valem após reiniciar).");
}

const encerrar = async () => {
  await app.close();
  await db.fechar();
  process.exit(0);
};
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);

try {
  await app.listen({ port: config.porta, host: config.host });
  app.log.info(`Banco: ${db.tipo} | SEFAZ: ${config.modoSefaz}`);
} catch (erro) {
  app.log.error(erro);
  process.exit(1);
}
