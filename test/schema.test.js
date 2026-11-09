// Assina NF-e e NFC-e com um certificado de teste (autoassinado) usando a própria lib e valida
// contra o schema oficial PL_010b (com IBS/CBS) via libxml2 em WASM. Também confere a leitura do .pfx.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Tools } from "node-sped-nfe";
import { validarXsd } from "../src/nfe/xsd.js";
import { calcularDocumento } from "../src/fiscal/calculo.js";
import { perfisPadrao } from "../src/fiscal/perfis-padrao.js";
import { montarXml } from "../src/nfe/montar.js";
import { lerCertificado, conferirCertificado } from "../src/certificado.js";


let tmp;
let pfx;
let temOpenssl = true;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-xsd-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"),
      "-days", "30", "-subj", "/C=BR/O=ICP-Brasil/CN=EMPRESA TESTE LTDA:11222333000181"], { stdio: "ignore" });
    execFileSync("openssl", ["pkcs12", "-export", "-inkey", path.join(tmp, "k.pem"), "-in", path.join(tmp, "c.pem"), "-out", path.join(tmp, "t.pfx"),
      "-passout", "pass:1234"], { stdio: "ignore" });
    pfx = fs.readFileSync(path.join(tmp, "t.pfx"));
  } catch {
    temOpenssl = false;
  }
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const EMP = {
  cnpj: "11222333000181", razao_social: "EMPRESA TESTE LTDA", nome_fantasia: "TESTE", ie: "061234567", crt: "3", logradouro: "RUA A", numero: "10",
  complemento: "", bairro: "CENTRO", cod_municipio: "2304400", municipio: "Fortaleza", uf: "CE", cep: "60000000", fone: "8533334444",
};
const CLI = {
  id: 1, cpf_cnpj: "11444777000161", nome: "CLIENTE", ind_ie_dest: "1", ie: "111222333444", email: "c@x.com", logradouro: "AV PAULISTA",
  numero: "1000", complemento: "", bairro: "BELA VISTA", cod_municipio: "3550308", municipio: "Sao Paulo", uf: "SP", cep: "01310100", fone: "",
};
const PROD = { id: 1, codigo: "P1", descricao: "CABO HDMI", ncm: "85444200", cest: "", ean: "", unidade: "UN", preco_cent: 3990 };
const RESP = { CNPJ: "11222333000181", xContato: "Contato", email: "a@b.com", fone: "85999999999" };

async function validar(xml) {
  const r = await validarXsd(xml);
  return { valid: r.ok, errors: r.ok ? [] : [{ message: r.erro }] };
}

async function assinar(xml, mod, extra = {}) {
  const tools = new Tools({ mod, tpAmb: 2, UF: "CE", versao: "4.00", CNPJ: EMP.cnpj, xmllint: "xmllint", ...extra }, { pfx, senha: "1234" });
  return tools.xmlSign(xml);
}

const cenarios = [
  { nome: "regime normal, CST 00, interestadual contribuinte, boleto 2x, IBS/CBS", crt: "3", perfil: 0, cliente: CLI, pag: [{ tPag: "15" }], dup: 2 },
  { nome: "regime normal, ST CST 10 com IPI, não contribuinte (DIFAL)", crt: "3", perfil: 0, mod: { cst_icms: "10", mva_st: 40, aliq_icms_st: 18, cst_ipi: "50", aliq_ipi: 5 }, cliente: { ...CLI, ind_ie_dest: "9", ie: "" }, pag: [{ tPag: "17" }] },
  { nome: "regime normal, CST 20 com redução, interno", crt: "3", perfil: 0, mod: { cst_icms: "20", reducao_bc_icms: 33.33 }, cliente: { ...CLI, uf: "CE", cod_municipio: "2304400", municipio: "Fortaleza", cep: "60000000" }, pag: [{ tPag: "01" }] },
  { nome: "regime normal, CST 60 (ST retido)", crt: "3", perfil: 2, cliente: CLI, pag: [{ tPag: "03" }] },
  { nome: "Simples, CSOSN 102 sem IBS/CBS", crt: "1", perfil: 0, cliente: CLI, pag: [{ tPag: "01" }] },
  { nome: "Simples, CSOSN 101 com crédito e IBS/CBS ligado", crt: "1", perfil: 0, mod: { cst_icms: "101", aliq_icms_interna: 2.5, informar_ibscbs: true }, cliente: CLI, pag: [{ tPag: "01" }] },
  { nome: "Simples, CSOSN 202 com ST", crt: "1", perfil: 0, mod: { cst_icms: "202", aliq_icms_interna: 18, mva_st: 35, aliq_icms_st: 18 }, cliente: CLI, pag: [{ tPag: "01" }] },
  { nome: "Simples, CSOSN 500", crt: "1", perfil: 2, cliente: CLI, pag: [{ tPag: "01" }] },
];

for (const c of cenarios) {
  test(`NF-e assinada valida no XSD: ${c.nome}`, async (t) => {
    if (!temOpenssl) return t.skip("OpenSSL indisponível");
    const empresa = { ...EMP, crt: c.crt };
    const perfil = { ...perfisPadrao(c.crt)[c.perfil], ...(c.mod ?? {}) };
    const calc = calcularDocumento({ empresa, cliente: c.cliente, modelo: "55", itens: [{ produto: PROD, perfil, quantidade: 2, valor_unitario_cent: 3990, desconto_cent: 50 }, { produto: { ...PROD, id: 2, codigo: "P2", cest: "1234567" }, perfil, quantidade: 1.5, valor_unitario_cent: 1000 }] });
    const total = calc.totais.total_cent;
    const dup = c.dup ? Array.from({ length: c.dup }, (_, i) => ({ numero: String(i + 1).padStart(3, "0"), vencimento: `2026-12-1${i}`, valor_cent: i === 0 ? total - Math.floor(total / c.dup) * (c.dup - 1) : Math.floor(total / c.dup) })) : [];
    const { xml } = montarXml({ empresa, cliente: c.cliente, calculo: calc, pagamentos: c.pag.map((p) => ({ ...p, valor_cent: total })), duplicatas: dup, nota: { modelo: "55", serie: 1, numero: 10, ambiente: 2, infCpl: "Pedido 1." }, respTec: RESP });
    const assinado = await assinar(xml, "55");
    assert.match(assinado, /<Signature/);
    const r = await validar(assinado);
    assert.ok(r.valid, JSON.stringify(r.errors?.map((e) => e.rawMessage ?? e.message), null, 1));
  });
}

test("NFC-e assinada com QR Code valida no XSD", async (t) => {
  if (!temOpenssl) return t.skip("OpenSSL indisponível");
  const empresa = { ...EMP, crt: "1" };
  const calc = calcularDocumento({ empresa, cliente: null, modelo: "65", itens: [{ produto: PROD, perfil: perfisPadrao("1")[0], quantidade: 1 }] });
  const { xml } = montarXml({ empresa, cliente: { cpf_cnpj: "52998224725" }, calculo: calc, pagamentos: [{ tPag: "01", valor_cent: 5000 }], nota: { modelo: "65", serie: 1, numero: 3, ambiente: 2 }, respTec: RESP });
  const assinado = await assinar(xml, "65", { CSC: "ABCDEF", CSCid: "000001" });
  assert.match(assinado, /<qrCode>[^<]*\?p=\d{44}\|2\|2\|1\|/);
  const r = await validar(assinado);
  assert.ok(r.valid, JSON.stringify(r.errors?.map((e) => e.rawMessage ?? e.message), null, 1));
});

test("leitura do .pfx: titular, CNPJ, senha errada e CNPJ de outra empresa", async (t) => {
  if (!temOpenssl) return t.skip("OpenSSL indisponível");
  const info = await lerCertificado(pfx, "1234");
  assert.equal(info.cnpj, "11222333000181");
  assert.equal(info.titular, "EMPRESA TESTE LTDA");
  assert.ok(info.validade > new Date());
  conferirCertificado(info, "11.222.333/0001-81");
  assert.throws(() => conferirCertificado(info, "99888777000155"), /outro CNPJ/);
  await assert.rejects(lerCertificado(pfx, "errada"), /senha incorreta/);
});
