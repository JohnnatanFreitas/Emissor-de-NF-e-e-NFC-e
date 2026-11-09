// Produtos, clientes/fornecedores e cálculo do quadro Resumo.
import { exigir, empresaDaRota } from "../acesso.js";
import { calcular, itemPublico } from "../servicos/carregar.js";
import { invalido, naoEncontrado, pegar, montarSet, soDigitos, texto, validarCNPJ, validarCPF } from "../util.js";

const CAMPOS_PRODUTO = ["codigo", "descricao", "ncm", "cest", "ean", "unidade", "preco_cent", "perfil_id", "estoque_minimo", "ativo"];
const CAMPOS_PESSOA = [
  "tipo", "cpf_cnpj", "nome", "nome_fantasia", "ind_ie_dest", "ie", "email", "fone", "logradouro", "numero", "complemento",
  "bairro", "cod_municipio", "municipio", "uf", "cep", "ativo",
];

const SQL_PRODUTO = `SELECT p.*, f.nome AS perfil_nome FROM produtos p JOIN perfis_fiscais f ON f.id = p.perfil_id`;

export async function normalizarProduto(q, empresaId, d, parcial) {
  const c = pegar(d, CAMPOS_PRODUTO);
  if (c.codigo !== undefined) c.codigo = texto(c.codigo, 60);
  if (c.descricao !== undefined) c.descricao = texto(c.descricao, 120);
  if (!parcial || c.codigo !== undefined) if (!c.codigo) throw invalido("Informe o código do produto.");
  if (!parcial || c.descricao !== undefined) if (!c.descricao) throw invalido("Informe a descrição do produto.");
  if (c.ncm !== undefined || !parcial) {
    c.ncm = soDigitos(c.ncm);
    if (c.ncm.length !== 8) throw invalido("NCM deve ter 8 dígitos.");
  }
  if (c.cest !== undefined) {
    c.cest = soDigitos(c.cest);
    if (c.cest && c.cest.length !== 7) throw invalido("CEST deve ter 7 dígitos.");
  }
  if (c.ean !== undefined) {
    c.ean = soDigitos(c.ean);
    if (c.ean && ![8, 12, 13, 14].includes(c.ean.length)) throw invalido("GTIN/EAN deve ter 8, 12, 13 ou 14 dígitos.");
  }
  if (c.unidade !== undefined) c.unidade = texto(c.unidade, 6).toUpperCase() || "UN";
  if (c.preco_cent !== undefined) {
    c.preco_cent = Math.round(Number(c.preco_cent));
    if (!(c.preco_cent >= 0)) throw invalido("Preço inválido.");
  }
  if (c.estoque_minimo !== undefined) c.estoque_minimo = Number(c.estoque_minimo || 0);
  if (c.perfil_id !== undefined || !parcial) {
    const p = await q.one("SELECT id FROM perfis_fiscais WHERE id = $1 AND empresa_id = $2", [Number(c.perfil_id), empresaId]);
    if (!p) throw invalido("Escolha um perfil fiscal desta empresa.");
    c.perfil_id = p.id;
  }
  return c;
}

function normalizarPessoa(d, parcial) {
  const c = pegar(d, CAMPOS_PESSOA);
  if (c.cpf_cnpj !== undefined || !parcial) {
    c.cpf_cnpj = soDigitos(c.cpf_cnpj);
    if (c.cpf_cnpj.length === 14 ? !validarCNPJ(c.cpf_cnpj) : !validarCPF(c.cpf_cnpj)) throw invalido("CPF ou CNPJ inválido.");
  }
  if (c.nome !== undefined || !parcial) {
    c.nome = texto(c.nome, 60);
    if (!c.nome) throw invalido("Informe o nome ou a razão social.");
  }
  if (c.tipo !== undefined && !["cliente", "fornecedor", "ambos"].includes(c.tipo)) throw invalido("Tipo inválido.");
  if (!parcial && !c.tipo) c.tipo = "cliente";
  if (c.ind_ie_dest !== undefined && !["1", "2", "9"].includes(String(c.ind_ie_dest))) throw invalido("Indicador de contribuinte inválido.");
  for (const k of ["ie", "cod_municipio", "cep", "fone"]) if (c[k] !== undefined) c[k] = soDigitos(c[k]);
  if (c.uf !== undefined) c.uf = String(c.uf).toUpperCase();
  for (const k of ["nome_fantasia", "email", "logradouro", "numero", "complemento", "bairro", "municipio"]) if (c[k] !== undefined) c[k] = texto(c[k], 120);
  // Contribuinte precisa de IE; CPF nunca é contribuinte com IE comum aqui.
  if (c.ind_ie_dest === "1" && c.ie !== undefined && !c.ie) throw invalido("Contribuinte do ICMS precisa da inscrição estadual.");
  if (c.cod_municipio && c.cod_municipio.length !== 7) throw invalido("O código IBGE do município tem 7 dígitos.");
  return c;
}

export async function rotasCadastros(api, { db }) {
  // ---- Produtos ----
  api.get("/empresas/:eid/produtos", async (req) => {
    const e = await empresaDaRota(req, db);
    const busca = texto(req.query.busca, 80);
    const params = [e.id];
    let where = "p.empresa_id = $1";
    if (req.query.ativos === "1") where += " AND p.ativo";
    if (busca) {
      params.push(`%${busca}%`);
      where += ` AND (p.codigo ILIKE $2 OR p.descricao ILIKE $2 OR p.ean = $${params.push(busca)})`;
    }
    return db.many(`${SQL_PRODUTO} WHERE ${where} ORDER BY p.descricao LIMIT 500`, params);
  });

  api.post("/empresas/:eid/produtos", async (req) => {
    exigir(req, "editar_produtos");
    const e = await empresaDaRota(req, db);
    const c = await normalizarProduto(db, e.id, req.body ?? {}, false);
    const k = Object.keys(c);
    const p = await db.one(
      `INSERT INTO produtos (empresa_id, ${k.join(",")}) VALUES ($1, ${k.map((_, i) => `$${i + 2}`).join(",")}) RETURNING id`,
      [e.id, ...k.map((x) => c[x])]
    );
    return db.one(`${SQL_PRODUTO} WHERE p.id = $1`, [p.id]);
  });

  api.put("/empresas/:eid/produtos/:id", async (req) => {
    exigir(req, "editar_produtos");
    const e = await empresaDaRota(req, db);
    const c = await normalizarProduto(db, e.id, req.body ?? {}, true);
    if (!Object.keys(c).length) throw invalido("Nada para alterar.");
    const { sql, valores } = montarSet(c, 3);
    const p = await db.one(`UPDATE produtos SET ${sql} WHERE id = $1 AND empresa_id = $2 RETURNING id`, [Number(req.params.id), e.id, ...valores]);
    if (!p) throw naoEncontrado("Produto não encontrado.");
    return db.one(`${SQL_PRODUTO} WHERE p.id = $1`, [p.id]);
  });

  // ---- Pessoas ----
  api.get("/empresas/:eid/pessoas", async (req) => {
    const e = await empresaDaRota(req, db);
    const params = [e.id];
    let where = "empresa_id = $1";
    if (req.query.tipo === "cliente") where += " AND tipo IN ('cliente','ambos')";
    if (req.query.tipo === "fornecedor") where += " AND tipo IN ('fornecedor','ambos')";
    const busca = texto(req.query.busca, 80);
    if (busca) {
      params.push(`%${busca}%`, soDigitos(busca) || "-");
      where += " AND (nome ILIKE $2 OR nome_fantasia ILIKE $2 OR cpf_cnpj LIKE $3 || '%')";
    }
    return db.many(`SELECT * FROM pessoas WHERE ${where} ORDER BY nome LIMIT 500`, params);
  });

  api.post("/empresas/:eid/pessoas", async (req) => {
    exigir(req, "editar_pessoas");
    const e = await empresaDaRota(req, db);
    const c = normalizarPessoa(req.body ?? {}, false);
    const k = Object.keys(c);
    return db.one(
      `INSERT INTO pessoas (empresa_id, ${k.join(",")}) VALUES ($1, ${k.map((_, i) => `$${i + 2}`).join(",")}) RETURNING *`,
      [e.id, ...k.map((x) => c[x])]
    );
  });

  api.put("/empresas/:eid/pessoas/:id", async (req) => {
    exigir(req, "editar_pessoas");
    const e = await empresaDaRota(req, db);
    const c = normalizarPessoa(req.body ?? {}, true);
    if (!Object.keys(c).length) throw invalido("Nada para alterar.");
    const { sql, valores } = montarSet(c, 3);
    const p = await db.one(`UPDATE pessoas SET ${sql} WHERE id = $1 AND empresa_id = $2 RETURNING *`, [Number(req.params.id), e.id, ...valores]);
    if (!p) throw naoEncontrado("Cadastro não encontrado.");
    return p;
  });

  // ---- Cálculo (quadro Resumo) ----
  api.post("/empresas/:eid/calculo", async (req) => {
    const e = await empresaDaRota(req, db);
    const { calculo } = await calcular(db, e, req.body ?? {});
    return { ...calculo, itens: calculo.itens.map(itemPublico) };
  });
}
