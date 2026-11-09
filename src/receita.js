// Consulta o CNPJ na BrasilAPI (dados públicos da Receita) e devolve no formato dos cadastros.
import { naoEncontrado, soDigitos, invalido, ErroHttp } from "./util.js";

export async function consultarCnpj(cnpj, { url, fetchImpl = fetch } = {}) {
  const c = soDigitos(cnpj);
  if (c.length !== 14) throw invalido("CNPJ deve ter 14 dígitos.");
  let r;
  try {
    r = await fetchImpl(`${url}${c}`, { headers: { accept: "application/json", "user-agent": "argus-emissor" }, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ErroHttp(502, "Não foi possível consultar a Receita agora. Preencha os dados manualmente.");
  }
  if (r.status === 404) throw naoEncontrado("CNPJ não encontrado na Receita.");
  if (!r.ok) throw new ErroHttp(502, "A consulta de CNPJ falhou. Preencha os dados manualmente.");
  const d = await r.json();
  const simples = d.opcao_pelo_simples === true || d.opcao_pelo_mei === true;
  return {
    cnpj: c,
    razao_social: d.razao_social ?? "",
    nome_fantasia: d.nome_fantasia || d.razao_social || "",
    logradouro: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(" ").trim(),
    numero: d.numero || "S/N",
    complemento: d.complemento ?? "",
    bairro: d.bairro ?? "",
    cod_municipio: String(d.codigo_municipio_ibge ?? ""),
    municipio: d.municipio ?? "",
    uf: d.uf ?? "",
    cep: soDigitos(d.cep),
    fone: soDigitos(d.ddd_telefone_1),
    email: d.email ?? "",
    cnae: String(d.cnae_fiscal ?? ""),
    crt_sugerido: simples ? "1" : "3",
    situacao: d.descricao_situacao_cadastral ?? "",
  };
}
