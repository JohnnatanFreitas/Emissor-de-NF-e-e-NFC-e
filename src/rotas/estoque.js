// Estoque: saldos, movimentos, ajuste/inventário e entrada pelo XML de compra.
import { exigir, empresaDaRota } from "../acesso.js";
import { movimentar } from "../servicos/estoque.js";
import { lerXmlCompra } from "../servicos/entrada-xml.js";
import { normalizarProduto } from "./cadastros.js";
import { conflito, invalido, texto, hojeISO } from "../util.js";
import { lerNfe } from "../sped/nfe-xml.js";
import { sugestoes, salvarClassificacao } from "../servicos/classificar.js";

export async function rotasEstoque(api, { db }) {
  api.get("/empresas/:eid/estoque", async (req) => {
    const e = await empresaDaRota(req, db);
    const busca = texto(req.query.busca, 80);
    const params = [e.id];
    let where = "p.empresa_id = $1 AND p.ativo";
    if (busca) where += ` AND (p.codigo ILIKE $${params.push(`%${busca}%`)} OR p.descricao ILIKE $2)`;
    return db.many(`SELECT p.*, f.nome AS perfil_nome FROM produtos p JOIN perfis_fiscais f ON f.id = p.perfil_id WHERE ${where} ORDER BY p.descricao LIMIT 1000`, params);
  });

  api.get("/empresas/:eid/estoque/movimentos", async (req) => {
    const e = await empresaDaRota(req, db);
    const params = [e.id];
    let where = "m.empresa_id = $1";
    if (req.query.produto_id) where += ` AND m.produto_id = $${params.push(Number(req.query.produto_id))}`;
    return db.many(
      `SELECT m.*, p.codigo, p.descricao, u.nome AS usuario_nome FROM estoque_movimentos m
         JOIN produtos p ON p.id = m.produto_id LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE ${where} ORDER BY m.id DESC LIMIT 100`,
      params
    );
  });

  api.post("/empresas/:eid/estoque/ajuste", async (req) => {
    exigir(req, "estoque");
    const e = await empresaDaRota(req, db);
    const d = req.body ?? {};
    if (!["entrada_manual", "saida_manual", "inventario"].includes(d.tipo)) throw invalido("Tipo de ajuste inválido.");
    const qtd = Number(d.quantidade);
    if (!Number.isFinite(qtd) || qtd < 0 || (d.tipo !== "inventario" && qtd === 0)) throw invalido("Quantidade inválida.");
    return db.tx(async (q) => {
      const p = await q.one("SELECT estoque FROM produtos WHERE id = $1 AND empresa_id = $2", [Number(d.produto_id), e.id]);
      if (!p) throw invalido("Produto não encontrado.");
      const delta = d.tipo === "entrada_manual" ? qtd : d.tipo === "saida_manual" ? -qtd : qtd - Number(p.estoque);
      if (d.tipo === "inventario" && delta === 0) throw invalido("O saldo informado é igual ao atual.");
      return movimentar(q, {
        empresa_id: e.id, produto_id: Number(d.produto_id), tipo: d.tipo, quantidade: delta,
        custo_unitario_cent: d.custo_unitario_cent != null && d.custo_unitario_cent !== "" ? Number(d.custo_unitario_cent) : null,
        observacao: texto(d.observacao, 300), usuario_id: req.usuario.id,
      });
    });
  });

  // ---- Entrada por XML ----
  async function leitura(e, xml) {
    const nota = lerXmlCompra(xml);
    const ja = await db.one("SELECT id FROM entradas_xml WHERE empresa_id = $1 AND chave = $2", [e.id, nota.chave]);
    const pessoa = await db.one("SELECT id FROM pessoas WHERE empresa_id = $1 AND cpf_cnpj = $2 ORDER BY id LIMIT 1", [e.id, nota.fornecedor.cnpj]);
    const vinculos = await db.many("SELECT * FROM vinculos_fornecedor WHERE empresa_id = $1 AND fornecedor_cnpj = $2", [e.id, nota.fornecedor.cnpj]);
    const porCodigo = new Map(vinculos.map((v) => [v.codigo_fornecedor, v]));
    const itens = [];
    for (const it of nota.itens) {
      let sugestao = { acao: "criar", produto_id: null, fator: 1 };
      const v = porCodigo.get(it.codigo);
      if (v) sugestao = { acao: "vincular", produto_id: v.produto_id, fator: Number(v.fator) };
      else if (it.ean) {
        const p = await db.one("SELECT id FROM produtos WHERE empresa_id = $1 AND ean = $2 LIMIT 1", [e.id, it.ean]);
        if (p) sugestao = { acao: "vincular", produto_id: p.id, fator: 1 };
      }
      itens.push({ ...it, sugestao });
    }
    // Classificação fiscal sugerida (SPED): destino, CFOP de entrada, CST e crédito.
    const nfe = lerNfe(xml);
    const prods = new Map();
    for (const it of itens) {
      if (it.sugestao.produto_id) prods.set(it.indice, await db.one("SELECT tipo_item FROM produtos WHERE id = $1", [it.sugestao.produto_id]));
    }
    const sug = await sugestoes(db, e, nfe, prods);
    for (const it of itens) it.classificacao = sug.get(it.indice);
    return { nota, nfe, ja_lancada: !!ja, pessoa_id: pessoa?.id ?? null, itens };
  }

  api.post("/empresas/:eid/estoque/entrada-xml/ler", async (req) => {
    exigir(req, "estoque");
    const e = await empresaDaRota(req, db);
    const { nota, ja_lancada, pessoa_id, itens } = await leitura(e, req.body?.xml);
    return {
      ja_lancada, chave: nota.chave, numero: nota.numero, serie: nota.serie, emitida_em: nota.emitida_em, total_cent: nota.total_cent,
      frete_cent: nota.frete_cent, fornecedor: { cnpj: nota.fornecedor.cnpj, nome: nota.fornecedor.nome, uf: nota.fornecedor.uf, pessoa_id },
      destinatario_confere: !nota.destinatario_cnpj || nota.destinatario_cnpj === e.cnpj,
      data_entrada_sugerida: hojeISO(),
      itens,
    };
  });

  api.post("/empresas/:eid/estoque/entrada-xml/lancar", async (req) => {
    exigir(req, "estoque");
    const e = await empresaDaRota(req, db);
    const { nota, nfe, ja_lancada, pessoa_id, itens: lidos } = await leitura(e, req.body?.xml);
    if (ja_lancada) throw conflito("Esta nota de compra já foi lançada no estoque.");
    const escolhas = new Map((req.body?.itens ?? []).map((i) => [Number(i.indice), i]));
    // Valida os produtos novos antes de abrir a transação.
    const novos = new Map();
    for (const it of nota.itens) {
      const esc = escolhas.get(it.indice) ?? { acao: "ignorar" };
      if (esc.acao === "criar") {
        novos.set(it.indice, await normalizarProduto(db, e.id, {
          codigo: esc.novo?.codigo ?? it.codigo, descricao: esc.novo?.descricao ?? it.descricao, ncm: it.ncm, ean: it.ean,
          unidade: esc.novo?.unidade ?? it.unidade, preco_cent: esc.novo?.preco_cent ?? 0, perfil_id: esc.novo?.perfil_id, estoque_minimo: 0, ativo: true,
        }, false));
      } else if (esc.acao === "vincular" && !esc.produto_id) throw invalido(`Escolha o produto para vincular o item ${it.indice}.`);
    }

    return db.tx(async (q) => {
      let fornecedorId = pessoa_id;
      if (!fornecedorId) {
        const f = nota.fornecedor;
        const end = f.endereco;
        const r = await q.one(
          `INSERT INTO pessoas (empresa_id, tipo, cpf_cnpj, nome, nome_fantasia, ind_ie_dest, ie, logradouro, numero, bairro, cod_municipio, municipio, uf, cep, fone)
           VALUES ($1,'fornecedor',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [e.id, f.cnpj, f.nome.slice(0, 60), f.fantasia, f.ie ? "1" : "9", f.ie, end.xLgr ?? "", end.nro ?? "", end.xBairro ?? "", String(end.cMun ?? ""), end.xMun ?? "", f.uf, String(end.CEP ?? ""), String(end.fone ?? "")]
        );
        fornecedorId = r.id;
      } else {
        await q.query("UPDATE pessoas SET tipo = 'ambos' WHERE id = $1 AND tipo = 'cliente'", [fornecedorId]);
      }
      const ent = await q.one(
        "INSERT INTO entradas_xml (empresa_id, chave, fornecedor_id, numero, emitida_em, total_cent, xml) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [e.id, nota.chave, fornecedorId, nota.numero, nota.emitida_em, nota.total_cent, String(req.body.xml)]
      );
      let movimentos = 0;
      const produtoDoItem = new Map();
      for (const it of nota.itens) {
        const esc = escolhas.get(it.indice) ?? { acao: "ignorar" };
        if (esc.acao === "ignorar") continue;
        const fator = Number(esc.fator) > 0 ? Number(esc.fator) : 1;
        let produtoId = Number(esc.produto_id);
        if (esc.acao === "criar") {
          const c = novos.get(it.indice);
          const k = Object.keys(c);
          const p = await q.one(`INSERT INTO produtos (empresa_id, ${k.join(",")}) VALUES ($1, ${k.map((_, i) => `$${i + 2}`).join(",")}) RETURNING id`, [e.id, ...k.map((x) => c[x])]);
          produtoId = p.id;
        } else {
          const p = await q.one("SELECT id FROM produtos WHERE id = $1 AND empresa_id = $2", [produtoId, e.id]);
          if (!p) throw invalido(`Produto do item ${it.indice} não encontrado.`);
        }
        produtoDoItem.set(it.indice, produtoId);
        const qtd = it.quantidade * fator;
        await movimentar(q, {
          empresa_id: e.id, produto_id: produtoId, tipo: "entrada_xml", quantidade: qtd,
          custo_unitario_cent: it.custo_total_cent / qtd, entrada_id: ent.id,
          observacao: `NF ${nota.numero} ${nota.fornecedor.nome}`.slice(0, 300), usuario_id: req.usuario.id,
        });
        // Lembra o vínculo para a próxima nota do mesmo fornecedor.
        await q.query(
          `INSERT INTO vinculos_fornecedor (empresa_id, fornecedor_cnpj, codigo_fornecedor, produto_id, fator) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (empresa_id, fornecedor_cnpj, codigo_fornecedor) DO UPDATE SET produto_id = EXCLUDED.produto_id, fator = EXCLUDED.fator`,
          [e.id, nota.fornecedor.cnpj, it.codigo, produtoId, fator]
        );
        movimentos++;
      }
      // Classificação para o SPED: a enviada pela tela ou, sem ela, a sugerida ("a conferir").
      const enviadas = nota.itens.every((it) => escolhas.get(it.indice)?.classificacao);
      const sugeridas = new Map(lidos.map((l) => [l.indice, l.classificacao]));
      await salvarClassificacao(q, e, ent, nfe, {
        data_entrada: req.body?.data_entrada || hojeISO(),
        conferida: enviadas,
        itens: nota.itens.map((it) => ({
          num_item: it.indice,
          produto_id: produtoDoItem.get(it.indice) ?? null,
          ...(escolhas.get(it.indice)?.classificacao ?? sugeridas.get(it.indice)),
        })),
      });
      return { entrada_id: ent.id, movimentos, fornecedor_id: fornecedorId, classificada: enviadas };
    });
  });
}
