// Ponto único de contato com a SEFAZ, por empresa e modelo. O resto do sistema só conhece:
//   status(), assinar(xml), validar(xmlAssinado), enviar(xmlAssinado), consultar(chave),
//   cancelar({ chave, protocolo, justificativa, sequencia }), cce({ chave, correcao, sequencia })
// Todas devolvem o texto XML da resposta; quem interpreta é o retorno.js.
import { Tools } from "node-sped-nfe";
import { decifrar } from "../seguranca.js";
import { preencherQrCodeNfce } from "./montar.js";
import { validarXsd } from "./xsd.js";
import { invalido } from "../util.js";

export function criarSefaz({ config, empresa, modelo = "55" }) {
  if (config.modoSefaz === "simulado") return criarSefazSimulada({ empresa, modelo });
  if (!empresa.cert_cifrado) throw invalido("A empresa não tem certificado A1 cadastrado.");
  const pfx = decifrar(empresa.cert_cifrado, config.masterKey);
  const senha = decifrar(empresa.cert_senha_cifrada, config.masterKey).toString("utf8");
  const nfce = modelo === "65";
  const csc = nfce && empresa.csc_cifrado ? decifrar(empresa.csc_cifrado, config.masterKey).toString("utf8") : "";

  const tools = new Tools(
    {
      mod: modelo,
      tpAmb: Number(empresa.ambiente),
      UF: empresa.uf,
      versao: "4.00",
      timeout: config.timeoutSegundos,
      CNPJ: empresa.cnpj.replace(/\D/g, ""), // autor dos eventos
      xmllint: config.xmllint,
      ...(nfce ? { CSC: csc, CSCid: empresa.csc_id } : {}),
      ...(config.openssl ? { openssl: config.openssl } : {}),
    },
    { pfx, senha }
  );

  return {
    modo: "sefaz",
    status: () => tools.sefazStatus(),
    assinar: (xml) => tools.xmlSign(xml),
    validar: (xmlAssinado) => validarXsd(xmlAssinado),
    // indSinc 1: a autorização volta na mesma resposta.
    enviar: (xmlAssinado) => tools.sefazEnviaLote(xmlAssinado, { idLote: Date.now() % 1e15, indSinc: 1 }),
    consultar: (chave) => tools.consultarNFe(chave),
    cancelar: ({ chave, protocolo, justificativa, sequencia }) =>
      tools.sefazEvento({ chNFe: chave, tpEvento: "110111", nProt: protocolo, xJust: justificativa, nSeqEvento: sequencia }),
    // A lib usa o campo xJust como xCorrecao na carta de correção.
    cce: ({ chave, correcao, sequencia }) => tools.sefazEvento({ chNFe: chave, tpEvento: "110110", xJust: correcao, nSeqEvento: sequencia }),
    inutilizar: ({ serie, inicio, fim, justificativa, ano }) =>
      tools.sefazInutiliza({ nSerie: serie, nIni: inicio, nFin: fim, xJust: justificativa, ano }),
  };
}

// Autoriza tudo localmente, guardando o estado no próprio banco (via nota). Serve para desenvolver
// e testar sem certificado. O modo simulado fica registrado em cada nota (verAplic SIMULADO).
const autorizadasSimuladas = new Map();

export function criarSefazSimulada({ empresa, modelo = "55", rejeitarCom = null } = {}) {
  const prot = (chave, cStat, xMotivo, nProt = "") =>
    `<protNFe versao="4.00"><infProt><tpAmb>${empresa?.ambiente ?? 2}</tpAmb><verAplic>SIMULADO</verAplic><chNFe>${chave}</chNFe>` +
    `<dhRecbto>${new Date().toISOString()}</dhRecbto>${nProt ? `<nProt>${nProt}</nProt>` : ""}` +
    `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
  const evento = (chave, cStat, xMotivo) =>
    `<retEnvEvento versao="1.00"><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento>` +
    `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><chNFe>${chave}</chNFe><nProt>1${String(Date.now()).padStart(14, "0")}</nProt>` +
    `</infEvento></retEvento></retEnvEvento>`;

  return {
    modo: "simulado",
    async status() {
      return `<retConsStatServ versao="4.00"><tpAmb>2</tpAmb><cStat>107</cStat><xMotivo>Servico em Operacao (SIMULADO)</xMotivo></retConsStatServ>`;
    },
    async assinar(xml) {
      // Sem certificado não há assinatura; na NFC-e o QR Code é gerado com o CSC cadastrado.
      return modelo === "65" ? preencherQrCodeNfce(xml, empresa?.csc_id ?? "1", "SIMULADO") : xml;
    },
    async validar() {
      return { ok: true };
    },
    async enviar(xmlAssinado) {
      const chave = xmlAssinado.match(/Id="NFe(\d{44})"/)[1];
      if (rejeitarCom) {
        return `<retEnviNFe versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot(chave, rejeitarCom.cStat, rejeitarCom.xMotivo)}</retEnviNFe>`;
      }
      const nProt = (modelo === "65" ? "3" : "2") + String(Date.now()).padStart(14, "0");
      const p = prot(chave, "100", "Autorizado o uso da NF-e", nProt);
      autorizadasSimuladas.set(chave, p);
      return `<retEnviNFe versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${p}</retEnviNFe>`;
    },
    async consultar(chave) {
      const p = autorizadasSimuladas.get(chave);
      if (p === "cancelada") return `<retConsSitNFe versao="4.00"><cStat>101</cStat><xMotivo>Cancelamento de NF-e homologado</xMotivo></retConsSitNFe>`;
      return p
        ? `<retConsSitNFe versao="4.00"><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>${p}</retConsSitNFe>`
        : `<retConsSitNFe versao="4.00"><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base de dados da SEFAZ</xMotivo></retConsSitNFe>`;
    },
    async cancelar({ chave }) {
      autorizadasSimuladas.set(chave, "cancelada");
      return evento(chave, "135", "Evento registrado e vinculado a NF-e");
    },
    async cce({ chave }) {
      return evento(chave, "135", "Evento registrado e vinculado a NF-e");
    },
    async inutilizar() {
      if (rejeitarCom) {
        return `<retInutNFe versao="4.00"><infInut><tpAmb>2</tpAmb><verAplic>SIMULADO</verAplic><cStat>${rejeitarCom.cStat}</cStat><xMotivo>${rejeitarCom.xMotivo}</xMotivo></infInut></retInutNFe>`;
      }
      return (
        `<retInutNFe versao="4.00"><infInut><tpAmb>${empresa?.ambiente ?? 2}</tpAmb><verAplic>SIMULADO</verAplic><cStat>102</cStat>` +
        `<xMotivo>Inutilizacao de numero homologado</xMotivo><nProt>4${String(Date.now()).padStart(14, "0")}</nProt></infInut></retInutNFe>`
      );
    },
  };
}
