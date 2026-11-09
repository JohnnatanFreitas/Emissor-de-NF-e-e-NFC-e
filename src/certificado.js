// Abre o certificado A1 (.pfx) com o OpenSSL para conferir a senha, o titular, o CNPJ e a validade.
// A senha vai por variável de ambiente (-passin env:), nunca na linha de comando.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invalido, soDigitos } from "./util.js";

function rodar(bin, args, env) {
  return new Promise((resolve) => {
    execFile(bin, args, { env: { ...process.env, ...env }, timeout: 15000, maxBuffer: 1024 * 1024 }, (erro, stdout, stderr) =>
      resolve({ ok: !erro, stdout: String(stdout), stderr: String(stderr), erro })
    );
  });
}

/**
 * @returns {Promise<{ titular: string, cnpj: string|null, validade: Date }>}
 */
export async function lerCertificado(pfx, senha, { openssl } = {}) {
  if (!pfx?.length) throw invalido("Escolha o arquivo do certificado A1 (.pfx).");
  const bin = openssl || "openssl";
  const tmp = path.join(os.tmpdir(), `argus-${crypto.randomUUID()}.pfx`);
  fs.writeFileSync(tmp, pfx, { mode: 0o600 });
  try {
    const base = ["pkcs12", "-in", tmp, "-clcerts", "-nokeys", "-passin", "env:ARGUS_PFX_SENHA"];
    const env = { ARGUS_PFX_SENHA: String(senha ?? "") };
    let r = await rodar(bin, base, env);
    // OpenSSL 3 recusa .pfx antigos (RC2) sem o provedor legado.
    if (!r.ok && /unsupported|RC2|legacy/i.test(r.stderr)) r = await rodar(bin, [...base, "-legacy"], env);
    if (r.erro?.code === "ENOENT") throw invalido("OpenSSL não encontrado. Instale ou informe o caminho em OPENSSL no .env.");
    if (!r.ok) {
      if (/mac verify|invalid password|bad decrypt/i.test(r.stderr)) throw invalido("Não foi possível abrir o certificado: senha incorreta.");
      throw invalido("Não foi possível abrir o certificado. Confira se o arquivo é um .pfx válido.");
    }
    const pem = r.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
    if (!pem) throw invalido("O arquivo não tem o certificado do titular.");
    const x = new crypto.X509Certificate(pem);
    const cn = x.subject.match(/CN=([^\n]+)/)?.[1] ?? x.subject;
    // e-CNPJ ICP-Brasil: CN = "RAZAO SOCIAL:CNPJ"
    const cnpj = cn.match(/:(\d{14})\b/)?.[1] ?? soDigitos(x.subject).match(/\d{14}/)?.[0] ?? null;
    return { titular: cn.replace(/:\d{11,14}$/, "").trim(), cnpj, validade: new Date(x.validTo) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Confere o certificado contra a empresa: mesmo CNPJ (raiz) e dentro da validade. */
export function conferirCertificado(info, cnpjEmpresa) {
  if (info.validade.getTime() < Date.now()) throw invalido(`O certificado venceu em ${info.validade.toLocaleDateString("pt-BR")}.`);
  if (info.cnpj && info.cnpj.slice(0, 8) !== soDigitos(cnpjEmpresa).slice(0, 8)) {
    throw invalido(`O certificado é de outro CNPJ (${info.cnpj}).`);
  }
}
