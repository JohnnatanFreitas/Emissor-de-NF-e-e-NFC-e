// Senhas (scrypt), token de sessão (HMAC-SHA256, formato JWT) e cofre (AES-256-GCM com a MASTER_KEY).
import crypto from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), sal, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${sal.toString("base64")}$${h.toString("base64")}`;
}

export function conferirSenha(senha, guardado) {
  const [alg, salB64, hB64] = String(guardado).split("$");
  if (alg !== "scrypt" || !salB64 || !hB64) return false;
  const esperado = Buffer.from(hB64, "base64");
  const h = crypto.scryptSync(String(senha), Buffer.from(salB64, "base64"), esperado.length, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return crypto.timingSafeEqual(h, esperado);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function assinarToken(dados, segredo, validadeSegundos = 12 * 3600) {
  const cab = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64url(JSON.stringify({ ...dados, iat: agora, exp: agora + validadeSegundos }));
  const ass = crypto.createHmac("sha256", segredo).update(`${cab}.${corpo}`).digest("base64url");
  return `${cab}.${corpo}.${ass}`;
}

export function lerToken(token, segredo) {
  const partes = String(token ?? "").split(".");
  if (partes.length !== 3) return null;
  const [cab, corpo, ass] = partes;
  const esperado = crypto.createHmac("sha256", segredo).update(`${cab}.${corpo}`).digest();
  const recebido = Buffer.from(ass, "base64url");
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (!dados.exp || dados.exp < Math.floor(Date.now() / 1000)) return null;
    return dados;
  } catch {
    return null;
  }
}

/** Cifra texto ou Buffer. Saída: base64 de iv(12) + tag(16) + dados. */
export function cifrar(valor, chave) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([c.update(Buffer.isBuffer(valor) ? valor : Buffer.from(String(valor), "utf8")), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), dados]).toString("base64");
}

/** Decifra para Buffer. Lança erro se a MASTER_KEY não for a mesma que cifrou. */
export function decifrar(cifrado, chave) {
  const buf = Buffer.from(cifrado, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", chave, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  try {
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  } catch {
    throw new Error("Não foi possível abrir o dado cifrado: a MASTER_KEY mudou desde o cadastro. Cadastre o certificado de novo.");
  }
}
