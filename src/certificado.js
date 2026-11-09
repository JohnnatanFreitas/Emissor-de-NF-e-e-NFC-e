// Abre o certificado A1 (.pfx) em JavaScript (node-forge), sem depender do OpenSSL instalado:
// confere a senha, o titular, o CNPJ e a validade, e devolve a chave e o certificado em PEM
// (é o que a assinatura e a conexão com a SEFAZ usam).
import crypto from "node:crypto";
import forge from "node-forge";
import { invalido, soDigitos } from "./util.js";

const OID_CHAVE = forge.pki.oids.pkcs8ShroudedKeyBag;
const OID_CHAVE_ABERTA = forge.pki.oids.keyBag;
const OID_CERT = forge.pki.oids.certBag;

function abrirP12(pfx, senha) {
  let asn1;
  try {
    asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(pfx).toString("binary")));
  } catch {
    throw invalido("Não foi possível abrir o certificado. Confira se o arquivo é um .pfx válido.");
  }
  try {
    return forge.pkcs12.pkcs12FromAsn1(asn1, false, String(senha ?? ""));
  } catch (e) {
    if (/mac|password|invalid/i.test(String(e?.message ?? e))) throw invalido("Não foi possível abrir o certificado: senha incorreta.");
    throw invalido("Não foi possível abrir o certificado. Confira se o arquivo é um .pfx válido.");
  }
}

/**
 * Abre o .pfx e devolve chave e certificados em PEM.
 * @returns {{ key: string, cert: string, ca: string[] }}
 */
export function abrirPfx(pfx, senha) {
  if (!pfx?.length) throw invalido("Escolha o arquivo do certificado A1 (.pfx).");
  const p12 = abrirP12(pfx, senha);
  const chaveBag = p12.getBags({ bagType: OID_CHAVE })[OID_CHAVE]?.[0] ?? p12.getBags({ bagType: OID_CHAVE_ABERTA })[OID_CHAVE_ABERTA]?.[0];
  if (!chaveBag?.key) throw invalido("O arquivo não tem a chave privada do certificado.");
  const certs = (p12.getBags({ bagType: OID_CERT })[OID_CERT] ?? []).map((b) => b.cert).filter(Boolean);
  if (!certs.length) throw invalido("O arquivo não tem o certificado do titular.");
  // O certificado do titular é o que tem a mesma chave pública da chave privada.
  const modulo = chaveBag.key.n.toString(16);
  const titular = certs.find((c) => c.publicKey?.n?.toString(16) === modulo) ?? certs[0];
  return {
    key: forge.pki.privateKeyToPem(chaveBag.key),
    cert: forge.pki.certificateToPem(titular),
    ca: certs.filter((c) => c !== titular).map((c) => forge.pki.certificateToPem(c)),
  };
}

/**
 * @returns {Promise<{ titular: string, cnpj: string|null, validade: Date }>}
 */
export async function lerCertificado(pfx, senha) {
  const { cert } = abrirPfx(pfx, senha);
  const x = new crypto.X509Certificate(cert);
  const cn = x.subject.match(/CN=([^\n]+)/)?.[1] ?? x.subject;
  // e-CNPJ ICP-Brasil: CN = "RAZAO SOCIAL:CNPJ"
  const cnpj = cn.match(/:(\d{14})\b/)?.[1] ?? soDigitos(x.subject).match(/\d{14}/)?.[0] ?? null;
  return { titular: cn.replace(/:\d{11,14}$/, "").trim(), cnpj, validade: new Date(x.validTo) };
}

/** Confere o certificado contra a empresa: mesmo CNPJ (raiz) e dentro da validade. */
export function conferirCertificado(info, cnpjEmpresa) {
  if (info.validade.getTime() < Date.now()) throw invalido(`O certificado venceu em ${info.validade.toLocaleDateString("pt-BR")}.`);
  if (info.cnpj && info.cnpj.slice(0, 8) !== soDigitos(cnpjEmpresa).slice(0, 8)) {
    throw invalido(`O certificado é de outro CNPJ (${info.cnpj}).`);
  }
}
