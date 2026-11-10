// DPS (Declaração de Prestação de Serviço) do padrão nacional da NFS-e, a chave de acesso da NFS-e
// e o DANFSe em HTML.
//
// Estrutura conforme o leiaute nacional (versão 1.00 da DPS). O grupo de IBS/CBS da NT de 2025 ainda
// não é enviado no XML (os valores aparecem no DANFSe como informativos): confirmar o leiaute antes
// de ativar o envio real ao Sefin Nacional.
import QRCode from "qrcode";

export const NS_NFSE = "http://www.sped.fazenda.gov.br/nfse";
const e = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dig = (s) => String(s ?? "").replace(/\D/g, "");
const r2 = (cent) => (Math.round(Number(cent) || 0) / 100).toFixed(2);
const p2 = (n) => (Number(n) || 0).toFixed(2);
const tag = (nome, valor) => (valor === undefined || valor === null || valor === "" ? "" : `<${nome}>${e(valor)}</${nome}>`);

/** Id da DPS: "DPS" + município (7) + tipo de inscrição (1: CPF, 2: CNPJ) + inscrição (14) + série (5) + número (15). */
export function idDps({ cod_municipio, cnpj, serie, numero }) {
  const doc = dig(cnpj);
  return `DPS${dig(cod_municipio).padStart(7, "0")}${doc.length === 11 ? "1" : "2"}${doc.padStart(14, "0")}${dig(serie).padStart(5, "0")}${String(numero).padStart(15, "0")}`;
}

function mod11(num) {
  let soma = 0;
  let peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv >= 10 ? "0" : String(dv);
}

/**
 * Chave de acesso da NFS-e (50 dígitos): município (7) + ambiente gerador (1) + tipo de inscrição (1) +
 * inscrição (14) + número da NFS-e (13) + ano e mês (4) + código numérico (9) + DV (1).
 */
export function chaveNfse({ cod_municipio, cnpj, numero_nfse, data, codigo }) {
  const doc = dig(cnpj);
  const aamm = `${data.slice(2, 4)}${data.slice(5, 7)}`;
  const base = `${dig(cod_municipio).padStart(7, "0")}1${doc.length === 11 ? "1" : "2"}${doc.padStart(14, "0")}${String(numero_nfse).padStart(13, "0")}${aamm}${String(codigo).padStart(9, "0")}`;
  return base + mod11(base);
}

/**
 * Monta o XML da DPS.
 * d: { ambiente, dhEmi, serie, numero, competencia, empresa, regime, tomador, servico, calculo, descricao }
 */
export function montarDps(d) {
  const { empresa, tomador, servico, calculo: c } = d;
  const docT = dig(tomador.cpf_cnpj);
  const opSimpNac = d.regime === "mei" ? "2" : d.regime === "simples" ? "3" : "1";
  const tpRet = c.iss_retido ? "2" : "1";
  const temFed = c.pis_cent || c.cofins_cent || c.irrf_cent || c.csll_cent || c.inss_cent;
  const id = idDps({ cod_municipio: empresa.cod_municipio, cnpj: empresa.cnpj, serie: d.serie, numero: d.numero });
  return (
    `<DPS xmlns="${NS_NFSE}" versao="1.00"><infDPS Id="${id}">` +
    tag("tpAmb", d.ambiente) + tag("dhEmi", d.dhEmi) + tag("verAplic", "ARGUS-EMISSOR-1.0") +
    tag("serie", dig(d.serie)) + tag("nDPS", d.numero) + tag("dCompet", d.competencia) + tag("tpEmit", "1") +
    tag("cLocEmi", dig(empresa.cod_municipio)) +
    `<prest>${tag("CNPJ", dig(empresa.cnpj))}${tag("IM", empresa.im)}${tag("fone", dig(empresa.fone))}${tag("email", empresa.email)}` +
    `<regTrib>${tag("opSimpNac", opSimpNac)}${opSimpNac === "3" ? tag("regApTribSN", "1") : ""}${tag("regEspTrib", "0")}</regTrib></prest>` +
    `<toma>${docT.length === 11 ? tag("CPF", docT) : tag("CNPJ", docT)}${tag("xNome", tomador.nome)}` +
    (tomador.cod_municipio
      ? `<end><endNac>${tag("cMun", dig(tomador.cod_municipio))}${tag("CEP", dig(tomador.cep))}</endNac>${tag("xLgr", tomador.logradouro)}${tag("nro", tomador.numero || "S/N")}${tag("xCpl", tomador.complemento)}${tag("xBairro", tomador.bairro)}</end>`
      : "") +
    `${tag("fone", dig(tomador.fone))}${tag("email", tomador.email)}</toma>` +
    `<serv><locPrest>${tag("cLocPrestacao", dig(d.local_prestacao || empresa.cod_municipio))}</locPrest>` +
    `<cServ>${tag("cTribNac", dig(servico.cod_trib_nac))}${tag("xDescServ", d.descricao)}${tag("cNBS", dig(servico.nbs))}</cServ></serv>` +
    `<valores><vServPrest>${tag("vServ", r2(c.valor_servico_cent))}</vServPrest>` +
    (c.desconto_incond_cent ? `<vDescCondIncond>${tag("vDescIncond", r2(c.desconto_incond_cent))}</vDescCondIncond>` : "") +
    (c.deducoes_cent ? `<vDedRed>${tag("vDR", r2(c.deducoes_cent))}</vDedRed>` : "") +
    `<trib><tribMun>${tag("tribISSQN", "1")}${d.regime === "mei" ? "" : tag("pAliq", p2(c.aliq_iss))}${tag("tpRetISSQN", tpRet)}</tribMun>` +
    (temFed
      ? `<tribFed>${c.pis_cent || c.cofins_cent ? `<piscofins>${tag("CST", "01")}${tag("vBCPisCofins", r2(c.base_calculo_cent))}${tag("pAliqPis", "0.65")}${tag("pAliqCofins", "3.00")}${tag("vPis", r2(c.pis_cent))}${tag("vCofins", r2(c.cofins_cent))}${tag("tpRetPisCofins", "1")}</piscofins>` : ""}` +
        `${c.inss_cent ? tag("vRetCP", r2(c.inss_cent)) : ""}${c.irrf_cent ? tag("vRetIRRF", r2(c.irrf_cent)) : ""}${c.csll_cent ? tag("vRetCSLL", r2(c.csll_cent)) : ""}</tribFed>`
      : "") +
    `<totTrib>${tag("indTotTrib", "0")}</totTrib></trib></valores>` +
    `</infDPS></DPS>`
  );
}

/** NFS-e devolvida pelo simulador: envolve a DPS com os dados gerados pela "administração". */
export function nfseSimulada({ chave, numero_nfse, dhProc, ambiente, xmlDps }) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="${NS_NFSE}" versao="1.00"><infNFSe Id="NFS${chave}">` +
    tag("xLocEmi", "SIMULADO") + tag("verAplic", "ARGUS-SIMULADOR") + tag("ambGer", "1") + tag("tpEmis", "1") +
    tag("cStat", "100") + tag("dhProc", dhProc) + tag("nNFSe", numero_nfse) + tag("tpAmb", ambiente) +
    xmlDps.replace(/^<\?xml[^>]*>/, "") + `</infNFSe></NFSe>`
  );
}

const brl = (cent) => (Math.round(Number(cent) || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const docFmt = (s) => {
  const d = dig(s);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
};

/** DANFSe (documento auxiliar) em HTML para imprimir. */
export async function gerarDanfse({ empresa, nota }) {
  const c = nota.valores;
  const t = nota.dados.tomador;
  const s = nota.dados.servico;
  const consulta = `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${nota.chave}`;
  const qr = nota.chave ? await QRCode.toString(consulta, { type: "svg", margin: 0, width: 110 }) : "";
  const marca = nota.status === "cancelada" ? "CANCELADA" : nota.modo === "simulado" ? "SIMULADA - SEM VALOR FISCAL" : nota.ambiente === 2 ? "PRODUÇÃO RESTRITA - SEM VALOR FISCAL" : "";
  const linha = (rot, val) => `<div class="c"><span>${e(rot)}</span><b>${e(val)}</b></div>`;
  const tributos = [
    ["ISS" + (c.iss_retido ? " (retido)" : ""), c.iss_cent], ["IRRF", c.irrf_cent], ["PIS", c.pis_cent], ["COFINS", c.cofins_cent],
    ["CSLL", c.csll_cent], ["INSS", c.inss_cent], ["CBS (informativo)", c.cbs_cent], ["IBS (informativo)", (c.ibs_uf_cent || 0) + (c.ibs_mun_cent || 0)],
  ];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFSe ${e(nota.numero_nfse ?? "")}</title><style>
*{box-sizing:border-box}body{margin:0;background:#e9edf2;font:12px Arial,Helvetica,sans-serif;color:#000}
.acoes{position:sticky;top:0;background:#0f172a;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center}
.acoes button{background:#fff;color:#0f172a;border:0;border-radius:6px;padding:8px 16px;font-weight:700;cursor:pointer}
.folha{position:relative;width:210mm;min-height:150mm;margin:16px auto;background:#fff;padding:10mm;overflow:hidden}
h1{font-size:16px;margin:0 0 4px}h2{font-size:11px;margin:10px 0 4px;padding:3px 6px;background:#eef1f5;text-transform:uppercase}
.topo{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #000;padding-bottom:6px}
.grade{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 12px}.c span{display:block;font-size:9px;color:#444;text-transform:uppercase}
.c b{font-weight:600}.chave{font-family:monospace;letter-spacing:1px}table{width:100%;border-collapse:collapse}td{padding:3px 6px;border-bottom:1px solid #ddd}
td.n{text-align:right}.marca{position:absolute;top:45%;left:0;right:0;text-align:center;font-size:44px;font-weight:700;color:rgba(200,0,0,.16);transform:rotate(-24deg);pointer-events:none}
.desc{white-space:pre-wrap;border:1px solid #ddd;padding:6px;min-height:40px}
@media print{body{background:#fff}.acoes{display:none}.folha{margin:0}}
</style></head><body><div class="acoes"><button onclick="window.print()">Imprimir</button><span>DANFSe - NFS-e ${e(nota.numero_nfse ?? "")}</span></div>
<div class="folha">${marca ? `<div class="marca">${e(marca)}</div>` : ""}
<div class="topo"><div><h1>DANFSe - Documento Auxiliar da NFS-e</h1><div>NFS-e nº <b>${e(nota.numero_nfse ?? "-")}</b> · DPS ${e(nota.serie_dps)}-${e(nota.numero_dps)} · Competência ${e(String(nota.competencia).split("-").reverse().join("/"))}</div>
<div>Chave de acesso: <span class="chave">${e(nota.chave ?? "-")}</span></div><div>Emitida em ${e(new Date(nota.emitida_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))}</div></div><div>${qr}</div></div>
<h2>Prestador</h2><div class="grade">${linha("Razão social", empresa.razao_social)}${linha("CNPJ", docFmt(empresa.cnpj))}${linha("Inscrição municipal", empresa.im || "-")}${linha("Município", `${empresa.municipio}/${empresa.uf}`)}${linha("Endereço", `${empresa.logradouro}, ${empresa.numero}`)}${linha("Regime", { simples: "Simples Nacional", mei: "MEI", normal: "Regime normal" }[nota.dados.regime] ?? "-")}</div>
<h2>Tomador</h2><div class="grade">${linha("Nome", t.nome)}${linha("CPF/CNPJ", docFmt(t.cpf_cnpj))}${linha("Município", t.municipio ? `${t.municipio}/${t.uf}` : "-")}${linha("Endereço", t.logradouro ? `${t.logradouro}, ${t.numero || "S/N"}` : "-")}${linha("E-mail", t.email || "-")}</div>
<h2>Serviço</h2><div class="grade">${linha("Código de tributação nacional", s.cod_trib_nac)}${linha("Item da LC 116", s.item_lc116)}${linha("NBS", s.nbs || "-")}</div>
<div class="desc">${e(nota.dados.descricao)}</div>
<h2>Valores</h2><table><tr><td>Valor do serviço</td><td class="n">${brl(c.valor_servico_cent)}</td></tr><tr><td>Deduções</td><td class="n">${brl(c.deducoes_cent)}</td></tr>
<tr><td>Desconto incondicionado</td><td class="n">${brl(c.desconto_incond_cent)}</td></tr><tr><td>Base de cálculo</td><td class="n">${brl(c.base_calculo_cent)}</td></tr>
<tr><td>Alíquota do ISS</td><td class="n">${p2(c.aliq_iss).replace(".", ",")}%</td></tr>
${tributos.map(([n, v]) => `<tr><td>${e(n)}</td><td class="n">${brl(v)}</td></tr>`).join("")}
<tr><td><b>Total de retenções</b></td><td class="n"><b>${brl(c.retencoes_cent)}</b></td></tr><tr><td><b>Valor líquido</b></td><td class="n"><b>${brl(c.liquido_cent)}</b></td></tr></table>
${nota.motivo_cancelamento ? `<h2>Cancelamento</h2><div>${e(nota.motivo_cancelamento)}</div>` : ""}
<p style="font-size:10px;color:#555;margin-top:10px">${e(c.regras?.fase ?? "")}. Consulte a autenticidade em www.nfse.gov.br pela chave de acesso.</p>
</div></body></html>`;
}
