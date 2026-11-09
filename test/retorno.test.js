import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarEnvio, interpretarConsulta, interpretarEvento, montarNfeProc } from "../src/nfe/retorno.js";

const CHAVE = "23261111222333000181550010000000071123456780";
const prot = (cStat, xMotivo, nProt = "") =>
  `<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infProt><chNFe>${CHAVE}</chNFe>${nProt ? `<nProt>${nProt}</nProt>` : ""}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
const lote = (corpo, cStat = "104") =>
  `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><cStat>${cStat}</cStat><xMotivo>Lote processado</xMotivo>${corpo}</retEnviNFe>`;

test("envio autorizado traz protocolo e o trecho protNFe original", () => {
  const r = interpretarEnvio(lote(prot("100", "Autorizado o uso da NF-e", "123456789012345")));
  assert.equal(r.situacao, "autorizada");
  assert.equal(r.protocolo, "123456789012345");
  assert.equal(r.chave, CHAVE);
  assert.match(r.protNFeXml, /^<protNFe[\s\S]*<\/protNFe>$/);
});

test("envio: rejeição no protocolo, rejeição do lote, denegação e lote em processamento", () => {
  assert.equal(interpretarEnvio(lote(prot("204", "Duplicidade de NF-e"))).situacao, "rejeitada");
  assert.equal(interpretarEnvio(lote(prot("302", "Uso Denegado"))).situacao, "denegada");
  const loteRuim = interpretarEnvio(lote("", "225"));
  assert.deepEqual([loteRuim.situacao, loteRuim.cStat], ["rejeitada", "225"]);
  assert.equal(interpretarEnvio(lote("", "103")).situacao, "em_processamento");
  assert.equal(interpretarEnvio("<html>erro</html>").situacao, "sem_resposta");
});

test("consulta: autorizada, cancelada, não encontrada", () => {
  const cons = (cStat, corpo = "") => `<retConsSitNFe><cStat>${cStat}</cStat><xMotivo>x</xMotivo>${corpo}</retConsSitNFe>`;
  assert.equal(interpretarConsulta(cons("100", prot("100", "Autorizado", "1"))).situacao, "autorizada");
  assert.equal(interpretarConsulta(cons("101")).situacao, "cancelada");
  assert.equal(interpretarConsulta(cons("217")).situacao, "nao_encontrada");
});

test("evento: 135 registrado, 573 duplicidade não", () => {
  const ev = (c) => `<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>${c}</cStat><xMotivo>m</xMotivo><nProt>9</nProt></infEvento></retEvento></retEnvEvento>`;
  assert.equal(interpretarEvento(ev("135")).registrado, true);
  assert.equal(interpretarEvento(ev("573")).registrado, false);
});

test("nfeProc junta NF-e e protocolo sem a declaração XML repetida", () => {
  const nfe = `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe/></NFe>`;
  const proc = montarNfeProc(nfe, prot("100", "ok", "1"));
  assert.equal((proc.match(/<\?xml/g) ?? []).length, 1);
  assert.match(proc, /<nfeProc [^>]*><NFe [^>]*><infNFe\/><\/NFe><protNFe/);
  assert.throws(() => montarNfeProc(nfe, null));
});
