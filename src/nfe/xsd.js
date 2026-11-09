// Validação da NF-e/NFC-e assinada contra o schema oficial (PL_010b, que já traz IBS/CBS),
// com o libxml2 compilado em WASM: não depende de xmllint instalado no sistema.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { validateXML } from "xmllint-wasm";

const require = createRequire(import.meta.url);
let cache = null;

function schemas() {
  if (!cache) {
    const dir = path.join(path.dirname(require.resolve("node-sped-nfe")), "..", "schemas", "PL_010b_V1.30");
    const preload = fs.readdirSync(dir).filter((f) => f.endsWith(".xsd")).map((f) => ({ fileName: f, contents: fs.readFileSync(path.join(dir, f), "utf8") }));
    cache = { preload, principal: preload.find((p) => p.fileName === "nfe_v4.00.xsd") };
  }
  return cache;
}

/** @returns {Promise<{ ok: boolean, erro?: string }>} */
export async function validarXsd(xmlAssinado) {
  const { preload, principal } = schemas();
  const xml = String(xmlAssinado).replace(/^<\?xml[^>]*>\s*/, "");
  const r = await validateXML({ xml: [{ fileName: "nfe.xml", contents: xml }], schema: [principal], preload });
  if (r.valid) return { ok: true };
  const msgs = r.errors.map((e) => String(e.rawMessage ?? e.message).replace(/^nfe\.xml:\d+:\s*/, "").replace(/\{http:\/\/www\.portalfiscal\.inf\.br\/nfe\}/g, ""));
  return { ok: false, erro: msgs.slice(0, 3).join(" | ") };
}
