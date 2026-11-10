// Notas de entrada: lista por período, detalhe com a classificação de cada item e a gravação dela.
// A classificação (destino, CFOP de entrada, CST, crédito) é o que o SPED leva para o C170/C190.
import { exigir, empresaDaRota } from "../acesso.js";
import { naoEncontrado } from "../util.js";
import { DESTINOS } from "../sped/classificacao.js";
import { garantirItens, salvarClassificacao, xmlDaEntrada } from "../servicos/classificar.js";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function rotasEntradas(api, { db }) {
  api.get("/empresas/:eid/entradas", async (req) => {
    exigir(req, "estoque");
    const e = await empresaDaRota(req, db);
    const params = [e.id];
    let where = "x.empresa_id = $1";
    // Período pela data de entrada (é ela que decide o mês do SPED); sem data, pela do lançamento.
    const quando = "coalesce(x.data_entrada, (x.criado_em AT TIME ZONE 'America/Sao_Paulo')::date)";
    if (DATA.test(req.query.de ?? "")) where += ` AND ${quando} >= $${params.push(req.query.de)}::date`;
    if (DATA.test(req.query.ate ?? "")) where += ` AND ${quando} <= $${params.push(req.query.ate)}::date`;
    if (req.query.situacao === "a_conferir") where += " AND NOT x.classificada";
    const linhas = await db.many(
      `SELECT x.id, x.chave, x.numero, x.emitida_em, x.total_cent, x.classificada, ${quando} AS data_entrada,
              p.nome AS fornecedor_nome, p.cpf_cnpj AS fornecedor_cnpj, p.uf AS fornecedor_uf
         FROM entradas_xml x LEFT JOIN pessoas p ON p.id = x.fornecedor_id
        WHERE ${where} ORDER BY ${quando} DESC, x.id DESC LIMIT 500`,
      params
    );
    return linhas;
  });

  async function entradaDaRota(req) {
    const e = await empresaDaRota(req, db);
    const x = await db.one("SELECT * FROM entradas_xml WHERE id = $1 AND empresa_id = $2", [Number(req.params.id), e.id]);
    if (!x) throw naoEncontrado("Nota de entrada não encontrada.");
    return { e, x };
  }

  async function detalhe(e, x) {
    await db.tx((q) => garantirItens(q, e, x));
    const atual = await db.one("SELECT * FROM entradas_xml WHERE id = $1", [x.id]);
    const nota = xmlDaEntrada(atual);
    const cls = new Map((await db.many(
      `SELECT i.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao FROM entrada_itens i
         LEFT JOIN produtos p ON p.id = i.produto_id WHERE i.entrada_id = $1`, [x.id]
    )).map((r) => [r.num_item, r]));
    return {
      id: atual.id,
      chave: nota.chave,
      numero: nota.numero,
      serie: nota.serie,
      dt_emissao: nota.dt_emissao,
      data_entrada: atual.data_entrada,
      classificada: atual.classificada,
      fornecedor: { nome: nota.emit?.nome, cnpj: nota.emit?.cnpj || nota.emit?.cpf, uf: nota.emit?.uf, simples: ["1", "2", "4"].includes(nota.crt) },
      total_cent: nota.total.vNF,
      itens: nota.itens.map((it) => {
        const c = cls.get(it.num);
        return {
          num_item: it.num,
          codigo_fornecedor: it.cProd,
          descricao: it.xProd,
          ncm: it.ncm,
          cfop_emitente: it.cfop,
          cst_emitente: it.cst || it.csosn,
          quantidade: it.qCom,
          unidade: it.uCom,
          valor_cent: it.vProd,
          bc_icms_cent: it.vBC,
          aliq_icms: it.pICMS,
          icms_cent: it.vICMS,
          icms_st_cent: it.vICMSST,
          ipi_cent: it.ipi.vIPI,
          credito_simples_cent: it.vCredICMSSN,
          produto: c?.produto_id ? { id: c.produto_id, codigo: c.produto_codigo, descricao: c.produto_descricao } : null,
          classificacao: c ? { destino: c.destino, cfop: c.cfop, cst_icms: c.cst_icms, credito_icms: c.credito_icms, credito_ipi: c.credito_ipi } : null,
        };
      }),
      destinos: Object.entries(DESTINOS).map(([valor, d]) => ({ valor, rotulo: d.rotulo, tipo_item: d.tipo_item, cfop_final: d.final, cfop_final_st: d.final_st })),
    };
  }

  api.get("/empresas/:eid/entradas/:id", async (req) => {
    exigir(req, "estoque");
    const { e, x } = await entradaDaRota(req);
    return detalhe(e, x);
  });

  api.put("/empresas/:eid/entradas/:id/classificacao", async (req) => {
    exigir(req, "estoque");
    const { e, x } = await entradaDaRota(req);
    const nota = xmlDaEntrada(x);
    await db.tx(async (q) => {
      await garantirItens(q, e, x);
      await salvarClassificacao(q, e, x, nota, { data_entrada: req.body?.data_entrada, itens: req.body?.itens, conferida: true });
    });
    return detalhe(e, x);
  });
}
