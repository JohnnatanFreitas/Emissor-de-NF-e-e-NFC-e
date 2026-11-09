// Lê as variáveis de ambiente uma vez e valida o que é obrigatório.
import crypto from "node:crypto";

const env = process.env;

function lerChave(nome, { obrigatoria }) {
  const v = (env[nome] ?? "").trim();
  if (!v) {
    if (obrigatoria) throw new Error(`Falta ${nome} no .env (gere com: openssl rand -hex 32).`);
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${nome} deve ter 64 caracteres hexadecimais (openssl rand -hex 32).`);
  return Buffer.from(v, "hex");
}

export function carregarConfig(sobrescrever = {}) {
  const producaoNode = env.NODE_ENV === "production";
  const modoSefaz = sobrescrever.modoSefaz ?? (env.SEFAZ_MODO || "sefaz");
  if (!["sefaz", "simulado"].includes(modoSefaz)) throw new Error('SEFAZ_MODO deve ser "sefaz" ou "simulado".');

  // Em desenvolvimento, sem chaves no .env, gera chaves temporárias (os certificados não sobrevivem ao reinício).
  const masterKey = sobrescrever.masterKey ?? lerChave("MASTER_KEY", { obrigatoria: producaoNode }) ?? crypto.randomBytes(32);
  const jwtSecret = sobrescrever.jwtSecret ?? lerChave("JWT_SECRET", { obrigatoria: producaoNode }) ?? crypto.randomBytes(32);

  return {
    porta: Number(env.PORT || 3000),
    host: env.HOST || "127.0.0.1",
    databaseUrl: sobrescrever.databaseUrl ?? (env.DATABASE_URL || null),
    pgliteDir: sobrescrever.pgliteDir ?? (env.PGLITE_DIR || "./dados/pglite"),
    dadosDir: env.DADOS_DIR || "./dados",
    masterKey,
    jwtSecret,
    chavesTemporarias: !env.MASTER_KEY,
    cookieSeguro: env.COOKIE_SEGURO === "1",
    modoSefaz,
    timeoutSegundos: Number(env.SEFAZ_TIMEOUT || 30),
    openssl: env.OPENSSL || null,
    xmllint: env.XMLLINT || "xmllint",
    consultaCnpjUrl: env.CNPJ_API_URL || "https://brasilapi.com.br/api/cnpj/v1/",
    admin: {
      nome: env.ADMIN_NOME || "Administrador",
      email: (env.ADMIN_EMAIL || "").trim().toLowerCase(),
      senha: env.ADMIN_SENHA || "",
    },
    respTec: env.RESP_TEC_CNPJ
      ? {
          CNPJ: env.RESP_TEC_CNPJ.replace(/\D/g, ""),
          xContato: env.RESP_TEC_CONTATO || "",
          email: env.RESP_TEC_EMAIL || "",
          fone: (env.RESP_TEC_FONE || "").replace(/\D/g, ""),
        }
      : null,
    webDir: env.WEB_DIR || "./web/dist",
    ...sobrescrever,
  };
}
