// Ajusta a node-sped-nfe para rodar sem programas externos (Vercel, Docker enxuto):
//  1) aceita o certificado já aberto ({ key, cert, ca } em PEM, lido em JS com node-forge)
//     em vez de chamar o OpenSSL pela linha de comando;
//  2) com `xmllint: false` pula a validação local por xmllint (a NF-e/NFC-e é validada pelo
//     src/nfe/xsd.js, em WASM; eventos e inutilização são validados pela própria SEFAZ).
// Roda no postinstall. Se a versão da biblioteca mudar e um trecho não for achado, o script falha
// (melhor parar a instalação do que publicar sem o ajuste).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let arquivo;
try {
  arquivo = path.join(path.dirname(require.resolve("node-sped-nfe")), "utils", "tools.js");
} catch {
  console.log("[ajustar-sped-nfe] node-sped-nfe não instalada; nada a fazer.");
  process.exit(0);
}

const MARCA = "/* argus: ajustado */";
let src = fs.readFileSync(arquivo, "utf8");
if (src.includes(MARCA)) {
  console.log("[ajustar-sped-nfe] já ajustado.");
  process.exit(0);
}

const trocas = [
  {
    nome: "certificado já aberto (construtor)",
    de: `        _Tools_config.set(this, void 0);\n        if (typeof config != "object")`,
    para: `        _Tools_config.set(this, void 0);\n        if (certificado && certificado.pem && certificado.pem.key) __classPrivateFieldSet(this, _Tools_pem, certificado.pem, "f");\n        if (typeof config != "object")`,
  },
  {
    nome: "certificado já aberto (certTools)",
    de: `        if (__classPrivateFieldGet(this, _Tools_pem, "f").key != "")\n            resvol(__classPrivateFieldGet(this, _Tools_pem, "f"));`,
    para: `        if (__classPrivateFieldGet(this, _Tools_pem, "f").key != "")\n            return resvol(__classPrivateFieldGet(this, _Tools_pem, "f"));`,
  },
  {
    nome: "xmllint opcional",
    de: `    return new Promise((resolve, reject) => {\n        const xmlFile = tmp.fileSync(`,
    para: `    return new Promise((resolve, reject) => {\n        if (__classPrivateFieldGet(this, _Tools_config, "f").xmllint === false)\n            return resolve(true);\n        const xmlFile = tmp.fileSync(`,
  },
];

for (const t of trocas) {
  const n = src.split(t.de).length - 1;
  if (n !== 1) {
    console.error(`[ajustar-sped-nfe] trecho "${t.nome}" encontrado ${n} vez(es) em ${arquivo}. Confira a versão da node-sped-nfe (esperada 1.2.52).`);
    process.exit(1);
  }
  src = src.replace(t.de, t.para);
}
fs.writeFileSync(arquivo, `${MARCA}\n${src}`);
console.log("[ajustar-sped-nfe] ajuste aplicado.");
