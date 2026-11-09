// DANFE em HTML pronto para imprimir: A4 (NF-e) ou bobina de 80 mm (NFC-e).
// Lê os dados do próprio XML (o que foi autorizado é o que aparece).
import { XMLParser } from "fast-xml-parser";
import QRCode from "qrcode";

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, isArray: (n) => ["det", "detPag", "dup"].includes(n) });

const e = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const dataHora = (s) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const data = (s) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");
const chaveFmt = (c) => String(c ?? "").replace(/(\d{4})(?=\d)/g, "$1 ");
const docFmt = (d) => {
  const s = String(d ?? "");
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return s;
};
const FORMAS = { "01": "Dinheiro", "02": "Cheque", "03": "Cartão de crédito", "04": "Cartão de débito", "05": "Crédito loja", "10": "Vale alimentação", "11": "Vale refeição", "12": "Vale presente", "13": "Vale combustível", "15": "Boleto", "16": "Depósito", "17": "PIX", "18": "Transferência", "19": "Fidelidade", "90": "Sem pagamento", "99": "Outros" };

// Code 128 (conjunto C): a chave tem 44 dígitos, vira 22 pares.
const C128 = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");

export function codigoBarras(digitos, altura = 42) {
  const vals = [105];
  for (let i = 0; i < digitos.length; i += 2) vals.push(Number(digitos.slice(i, i + 2)));
  const soma = vals.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0);
  vals.push(soma % 103, 106);
  let x = 10;
  let barras = "";
  for (const v of vals) {
    const p = C128[v];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) barras += `<rect x="${x}" y="0" width="${w}" height="${altura}"/>`;
      x += w;
    }
  }
  return `<svg class="barras" viewBox="0 0 ${x + 10} ${altura}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" fill="#000">${barras}</svg>`;
}

function marcaDagua(nota, homolog) {
  if (nota.status === "cancelada") return `<div class="marca">CANCELADA</div>`;
  if (homolog) return `<div class="marca">SEM VALOR FISCAL</div>`;
  if (nota.status !== "autorizada") return `<div class="marca">NÃO AUTORIZADA</div>`;
  return "";
}

const CSS_BASE = `
*{box-sizing:border-box}body{margin:0;background:#e9edf2;font-family:Arial,Helvetica,sans-serif;color:#000}
.acoes{position:sticky;top:0;background:#0f172a;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;font:14px Arial}
.acoes button{background:#fff;color:#0f172a;border:0;border-radius:6px;padding:8px 16px;font-weight:700;cursor:pointer}
.folha{position:relative;background:#fff;margin:16px auto;overflow:hidden}
.marca{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:64px;font-weight:700;color:rgba(200,0,0,.18);transform:rotate(-28deg);pointer-events:none;white-space:nowrap}
@media print{body{background:#fff}.acoes{display:none}.folha{margin:0;box-shadow:none}}`;

function nfeA4({ inf, prot, nota, eventos, homolog }) {
  const { ide, emit, dest, total, transp, cobr, pag, infAdic } = inf;
  const t = total?.ICMSTot ?? {};
  const ib = total?.IBSCBSTot;
  const ender = (x) => [x?.xLgr, x?.nro, x?.xCpl, x?.xBairro].filter(Boolean).join(", ");
  const dets = inf.det ?? [];
  const cce = eventos.filter((ev) => ev.tipo === "cce");
  const linhas = dets.map((d) => {
    const p = d.prod;
    const icms = Object.values(d.imposto?.ICMS ?? {})[0] ?? {};
    const ipi = d.imposto?.IPI?.IPITrib ?? {};
    return `<tr><td>${e(p.cProd)}</td><td class="esq">${e(p.xProd)}</td><td>${e(p.NCM)}</td><td>${e(icms.CST ?? icms.CSOSN)}</td><td>${e(p.CFOP)}</td>
      <td>${e(p.uCom)}</td><td class="num">${qtd(p.qCom)}</td><td class="num">${brl(p.vUnCom)}</td><td class="num">${brl(p.vProd)}</td>
      <td class="num">${brl(icms.vBC)}</td><td class="num">${brl(icms.vICMS)}</td><td class="num">${brl(ipi.vIPI)}</td><td class="num">${brl(icms.pICMS)}</td></tr>`;
  }).join("");
  const dups = (cobr?.dup ?? []).map((d) => `<div class="dup"><b>${e(d.nDup)}</b> ${data(d.dVenc)}<br>R$ ${brl(d.vDup)}</div>`).join("");
  const adicionais = [
    infAdic?.infCpl,
    ib ? `IBS: R$ ${brl(ib.gIBS?.vIBS)} | CBS: R$ ${brl(ib.gCBS?.vCBS)} (base R$ ${brl(ib.vBCIBSCBS)})` : null,
    ...cce.map((c) => `CC-e ${c.sequencia} (prot. ${c.protocolo ?? "-"}): ${c.texto}`),
  ].filter(Boolean).map(e).join("<br>");
  const campo = (rotulo, valor, cls = "") => `<div class="c ${cls}"><span>${rotulo}</span><b>${valor || "&nbsp;"}</b></div>`;

  return `<style>
  .folha{width:210mm;min-height:297mm;padding:8mm}
  .linha{display:flex;border:1px solid #000;border-top:0}.linha:first-child{border-top:1px solid #000}
  .c{flex:1;padding:2px 4px;border-left:1px solid #000;min-height:26px;font-size:9px}.c:first-child{border-left:0}
  .c span{display:block;font-size:7px;text-transform:uppercase;color:#333}.c b{font-size:10px;font-weight:600}
  h3{font-size:8px;margin:6px 0 1px;text-transform:uppercase}
  .cab{display:flex;border:1px solid #000}.cab>div{padding:6px;border-left:1px solid #000}.cab>div:first-child{border-left:0}
  .emit{flex:1.4;font-size:10px}.emit strong{font-size:13px;display:block;margin-bottom:4px}
  .danfe{width:34mm;text-align:center;font-size:9px}.danfe strong{font-size:16px;display:block}
  .chave{flex:1.6;font-size:9px}.barras{width:100%;height:40px}
  .tit{font-size:8px;text-transform:uppercase}.mono{font-family:monospace;font-size:11px;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;font-size:8px}th,td{border:1px solid #000;padding:2px 3px;text-align:center}
  th{font-size:7px;background:#f1f1f1}td.esq{text-align:left}td.num{text-align:right}
  .dups{display:flex;flex-wrap:wrap;gap:4px;border:1px solid #000;padding:3px}.dup{font-size:8px;border-right:1px solid #ccc;padding:0 6px}
  .adic{border:1px solid #000;min-height:30mm;padding:4px;font-size:8px}
  </style>
  <div class="folha">${marcaDagua(nota, homolog)}
    <div class="cab">
      <div class="emit"><strong>${e(emit.xNome)}</strong>${e(ender(emit.enderEmit))}<br>${e(emit.enderEmit?.xMun)} - ${e(emit.enderEmit?.UF)} CEP ${e(emit.enderEmit?.CEP)}<br>Fone ${e(emit.enderEmit?.fone ?? "")}</div>
      <div class="danfe"><strong>DANFE</strong>Documento Auxiliar da Nota Fiscal Eletrônica<br><br>0 - Entrada<br>1 - Saída <b style="border:1px solid #000;padding:0 5px">${e(ide.tpNF)}</b><br><br><b>Nº ${e(String(ide.nNF).padStart(9, "0").replace(/(\d{3})(?=\d)/g, "$1."))}</b><br>Série ${e(ide.serie)}<br>Folha 1/1</div>
      <div class="chave">${codigoBarras(nota.chave)}<div class="tit">Chave de acesso</div><div class="mono">${chaveFmt(nota.chave)}</div><br>Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da SEFAZ autorizadora</div>
    </div>
    <div class="linha">${campo("Natureza da operação", e(ide.natOp))}${campo("Protocolo de autorização de uso", prot ? `${e(prot.nProt)} ${dataHora(prot.dhRecbto)}` : "NÃO AUTORIZADA")}</div>
    <div class="linha">${campo("Inscrição estadual", e(emit.IE))}${campo("Inscrição estadual do subst. tributário", "")}${campo("CNPJ", docFmt(emit.CNPJ))}</div>
    <h3>Destinatário / remetente</h3>
    <div class="linha">${campo("Nome / razão social", e(dest?.xNome), "")}${campo("CNPJ / CPF", docFmt(dest?.CNPJ ?? dest?.CPF))}${campo("Data da emissão", dataHora(ide.dhEmi))}</div>
    <div class="linha">${campo("Endereço", e(ender(dest?.enderDest)))}${campo("Município", e(dest?.enderDest?.xMun))}${campo("UF", e(dest?.enderDest?.UF))}${campo("CEP", e(dest?.enderDest?.CEP))}${campo("Inscrição estadual", e(dest?.IE ?? ""))}</div>
    ${dups ? `<h3>Fatura / duplicatas</h3><div class="dups">${dups}</div>` : ""}
    <h3>Cálculo do imposto</h3>
    <div class="linha">${campo("Base de cálculo do ICMS", brl(t.vBC))}${campo("Valor do ICMS", brl(t.vICMS))}${campo("Base cálc. ICMS ST", brl(t.vBCST))}${campo("Valor do ICMS ST", brl(t.vST))}${campo("Valor total dos produtos", brl(t.vProd))}</div>
    <div class="linha">${campo("Valor do frete", brl(t.vFrete))}${campo("Valor do seguro", brl(t.vSeg))}${campo("Desconto", brl(t.vDesc))}${campo("Outras despesas", brl(t.vOutro))}${campo("Valor do IPI", brl(t.vIPI))}${campo("Valor total da nota", brl(t.vNF))}</div>
    ${ib ? `<div class="linha">${campo("Base IBS/CBS", brl(ib.vBCIBSCBS))}${campo("Valor do IBS", brl(ib.gIBS?.vIBS))}${campo("Valor da CBS", brl(ib.gCBS?.vCBS))}${campo("ICMS UF destino (DIFAL)", brl(t.vICMSUFDest))}${campo("PIS / COFINS", `${brl(t.vPIS)} / ${brl(t.vCOFINS)}`)}</div>` : ""}
    <h3>Transportador / volumes transportados</h3>
    <div class="linha">${campo("Modalidade do frete", transp?.modFrete === "9" ? "9 - Sem ocorrência de transporte" : e(transp?.modFrete))}</div>
    <h3>Dados dos produtos / serviços</h3>
    <table><thead><tr><th>Código</th><th>Descrição</th><th>NCM</th><th>CST</th><th>CFOP</th><th>Un</th><th>Qtd</th><th>V. unit.</th><th>V. total</th><th>BC ICMS</th><th>V. ICMS</th><th>V. IPI</th><th>Alíq. ICMS</th></tr></thead><tbody>${linhas}</tbody></table>
    <h3>Dados adicionais</h3>
    <div class="adic">${adicionais}${pag?.detPag ? `<br>Pagamento: ${pag.detPag.map((p) => `${FORMAS[p.tPag] ?? p.tPag} R$ ${brl(p.vPag)}`).join(" | ")}` : ""}</div>
  </div>`;
}

async function nfce80({ inf, supl, prot, nota, homolog }) {
  const { ide, emit, dest, total, pag } = inf;
  const t = total?.ICMSTot ?? {};
  const qr = supl?.qrCode ? await QRCode.toString(supl.qrCode, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : "";
  const itens = (inf.det ?? []).map((d) => {
    const p = d.prod;
    return `<tr><td colspan="4" class="esq">${e(p.cProd)} ${e(p.xProd)}</td></tr><tr><td></td><td>${qtd(p.qCom)} ${e(p.uCom)}</td><td>x ${brl(p.vUnCom)}</td><td class="num">${brl(p.vProd)}</td></tr>`;
  }).join("");
  const pags = (pag?.detPag ?? []).map((p) => `<tr><td>${FORMAS[p.tPag] ?? p.tPag}</td><td class="num">${brl(p.vPag)}</td></tr>`).join("");
  const consumidor = dest ? `CONSUMIDOR ${dest.CPF ? "CPF" : "CNPJ"} ${docFmt(dest.CPF ?? dest.CNPJ)}${dest.xNome ? `<br>${e(dest.xNome)}` : ""}` : "CONSUMIDOR NÃO IDENTIFICADO";
  return `<style>
  .folha{width:80mm;padding:3mm;font-size:10px}.folha p{margin:4px 0;text-align:center}
  .folha table{width:100%;border-collapse:collapse;font-size:9.5px}.folha td{padding:1px 0}.esq{text-align:left}.num{text-align:right}
  .sep{border-top:1px dashed #000;margin:5px 0}.qr svg{width:34mm;height:34mm}.mono{font-family:monospace;font-size:9px;word-break:break-all}
  .marca{font-size:26px}
  </style>
  <div class="folha">${marcaDagua(nota, homolog)}
    <p><b>${e(emit.xNome)}</b><br>CNPJ ${docFmt(emit.CNPJ)} IE ${e(emit.IE)}<br>${e([emit.enderEmit?.xLgr, emit.enderEmit?.nro, emit.enderEmit?.xBairro].filter(Boolean).join(", "))}<br>${e(emit.enderEmit?.xMun)} - ${e(emit.enderEmit?.UF)}</p>
    <div class="sep"></div><p><b>DANFE NFC-e</b><br>Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</p>
    ${homolog ? `<p><b>EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL</b></p>` : ""}
    <div class="sep"></div><table>${itens}</table><div class="sep"></div>
    <table><tr><td>Qtd. total de itens</td><td class="num">${(inf.det ?? []).length}</td></tr>
    <tr><td>Valor total R$</td><td class="num">${brl(t.vProd)}</td></tr>
    ${Number(t.vDesc) ? `<tr><td>Descontos R$</td><td class="num">${brl(t.vDesc)}</td></tr>` : ""}
    <tr><td><b>Valor a pagar R$</b></td><td class="num"><b>${brl(t.vNF)}</b></td></tr>
    <tr><td><b>Forma de pagamento</b></td><td class="num"><b>Valor pago R$</b></td></tr>${pags}
    ${pag?.vTroco ? `<tr><td>Troco R$</td><td class="num">${brl(pag.vTroco)}</td></tr>` : ""}</table>
    <div class="sep"></div><p>Consulte pela chave de acesso em<br>${e(supl?.urlChave ?? "")}<br><span class="mono">${chaveFmt(nota.chave)}</span></p>
    <div class="sep"></div><p>${consumidor}</p>
    <div class="sep"></div><p><b>NFC-e nº ${e(ide.nNF)} Série ${e(ide.serie)} ${dataHora(ide.dhEmi)}</b><br>${prot ? `Protocolo de autorização: ${e(prot.nProt)}<br>Data de autorização: ${dataHora(prot.dhRecbto)}` : "NOTA NÃO AUTORIZADA"}</p>
    <p class="qr">${qr}</p>
    <p>Tributos totais incidentes (Lei 12.741/2012): R$ ${brl(Number(t.vICMS || 0) + Number(t.vPIS || 0) + Number(t.vCOFINS || 0))}</p>
  </div>`;
}

export async function gerarDanfe({ empresa, nota, eventos = [] }) {
  const xml = nota.xml_autorizado ?? nota.xml_assinado;
  if (!xml) throw Object.assign(new Error("A nota não tem XML."), { status: 404 });
  const j = parser.parse(xml);
  const nfe = j.nfeProc?.NFe ?? j.NFe;
  const inf = nfe.infNFe;
  const prot = j.nfeProc?.protNFe?.infProt ?? null;
  const homolog = String(inf.ide.tpAmb) === "2";
  const corpo = nota.modelo === "65" ? await nfce80({ inf, supl: nfe.infNFeSupl, prot, nota, homolog }) : nfeA4({ inf, prot, nota, eventos, homolog });
  const titulo = `${nota.modelo === "65" ? "NFC-e" : "NF-e"} ${nota.numero} - ${empresa.nome_fantasia || empresa.razao_social}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(titulo)}</title>
  <style>${CSS_BASE}</style></head><body><div class="acoes"><button onclick="window.print()">Imprimir</button><span>${e(titulo)}</span></div>${corpo}</body></html>`;
}
