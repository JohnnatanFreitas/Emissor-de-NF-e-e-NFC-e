// Envio da DPS e cancelamento da NFS-e.
//
//   NFSE_MODO=simulado (padrão): autoriza localmente, gera número e chave no formato nacional e marca a
//     nota como "simulada". Serve para testar o fluxo inteiro (inclusive na Vercel) sem certificado.
//   NFSE_MODO=nacional: assina a DPS com o certificado A1 da empresa e envia à API do Sefin Nacional
//     (POST /nfse com {"dpsXmlGZipB64"}). Ainda NÃO conferido contra o portal: antes de ligar, emitir uma
//     nota em produção restrita e conferir o retorno.
import crypto from "node:crypto";
import https from "node:https";
import zlib from "node:zlib";
import { SignedXml } from "xml-crypto";
import { abrirPfx } from "../certificado.js";
import { decifrar } from "../seguranca.js";
import { chaveNfse, nfseSimulada } from "./dps.js";
import { ErroHttp, invalido } from "../util.js";

const URLS = {
  1: "https://sefin.nfse.gov.br/SefinNacional",
  2: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
};

export function modoNfse() {
  return process.env.NFSE_MODO === "nacional" ? "nacional" : "simulado";
}

function simulador() {
  return {
    modo: "simulado",
    async emitir({ empresa, xmlDps, numeroNfse, data, ambiente }) {
      const codigo = crypto.randomInt(0, 1e9);
      const chave = chaveNfse({ cod_municipio: empresa.cod_municipio, cnpj: empresa.cnpj, numero_nfse: numeroNfse, data, codigo });
      const dhProc = new Date().toISOString();
      return { autorizada: true, chave, numero_nfse: String(numeroNfse), xml_nfse: nfseSimulada({ chave, numero_nfse: numeroNfse, dhProc, ambiente, xmlDps }), mensagem: "Autorizada pelo simulador (sem valor fiscal)." };
    },
    async cancelar() {
      return { registrado: true, mensagem: "Cancelamento registrado pelo simulador." };
    },
  };
}

function assinar(xml, pem) {
  const sig = new SignedXml({
    privateKey: pem.key,
    publicCert: pem.cert,
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    getKeyInfoContent: () => `<X509Data><X509Certificate>${pem.cert.replace(/-----[^-]+-----|\s/g, "")}</X509Certificate></X509Data>`,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infDPS']", action: "after" } });
  return sig.getSignedXml();
}

function requisitar(url, corpo, pem, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", key: pem.key, cert: pem.cert, headers: { "content-type": "application/json" }, timeout: timeoutMs }, (res) => {
      let dados = "";
      res.on("data", (c) => (dados += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(dados || "{}") });
        } catch {
          resolve({ status: res.statusCode, json: { erro: dados.slice(0, 500) } });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado aguardando o Sefin Nacional.")));
    req.on("error", reject);
    req.end(JSON.stringify(corpo));
  });
}

function nacional({ config, empresa }) {
  if (!empresa.cert_cifrado) throw invalido("A empresa não tem certificado A1 cadastrado.");
  const pfx = decifrar(empresa.cert_cifrado, config.masterKey);
  const senha = decifrar(empresa.cert_senha_cifrada, config.masterKey).toString("utf8");
  const pem = abrirPfx(pfx, senha);
  return {
    modo: "nacional",
    async emitir({ xmlDps, ambiente }) {
      const assinado = assinar(xmlDps, pem);
      const corpo = { dpsXmlGZipB64: zlib.gzipSync(Buffer.from(assinado, "utf8")).toString("base64") };
      let r;
      try {
        r = await requisitar(`${URLS[ambiente]}/nfse`, corpo, pem, (config.timeoutSegundos || 30) * 1000);
      } catch (e) {
        throw new ErroHttp(502, `O Sefin Nacional não respondeu: ${e.message}`);
      }
      if (r.status >= 200 && r.status < 300 && r.json.chaveAcesso) {
        const xml = r.json.nfseXmlGZipB64 ? zlib.gunzipSync(Buffer.from(r.json.nfseXmlGZipB64, "base64")).toString("utf8") : null;
        return { autorizada: true, chave: r.json.chaveAcesso, numero_nfse: xml?.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1] ?? null, xml_nfse: xml, xml_dps: assinado, mensagem: "Autorizada pelo Sefin Nacional." };
      }
      const erros = (r.json.erros ?? r.json.Erros ?? []).map((x) => `${x.Codigo ?? x.codigo ?? ""} ${x.Descricao ?? x.descricao ?? ""}`.trim());
      return { autorizada: false, xml_dps: assinado, mensagem: erros.join("; ") || r.json.erro || `HTTP ${r.status}` };
    },
    async cancelar() {
      throw invalido("Cancelamento pelo Sefin Nacional ainda não disponível no sistema: cancele no Emissor Nacional (www.nfse.gov.br).");
    },
  };
}

/** modo: força o transmissor (a nota cancelada usa o mesmo modo em que foi emitida). */
export function criarTransmissor({ config, empresa, modo = modoNfse() }) {
  return modo === "nacional" ? nacional({ config, empresa }) : simulador();
}
