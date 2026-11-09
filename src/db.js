// Banco: Postgres de verdade quando há DATABASE_URL (Docker); senão PGlite (o mesmo Postgres
// rodando dentro do Node, em uma pasta) para desenvolver e testar sem instalar nada.
// O resto do sistema só usa: db.query, db.one, db.many, db.tx(fn) e db.fechar().
import fs from "node:fs";
import { ESQUEMA } from "./esquema.js";

const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082;
const FUSO = process.env.TZ_BANCO || "America/Sao_Paulo";

function embrulhar(executar) {
  const query = async (sql, params = []) => (await executar(sql, params)).rows;
  return {
    query,
    many: query,
    one: async (sql, params = []) => (await executar(sql, params)).rows[0] ?? null,
  };
}

async function abrirPostgres(url) {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(INT8, (v) => Number(v));
  pg.types.setTypeParser(NUMERIC, (v) => Number(v));
  pg.types.setTypeParser(DATE, (v) => v);
  // Datas do dia (painel, vencimentos) no horário de Brasília, não em UTC.
  const pool = new pg.Pool({ connectionString: url, max: 10, options: `-c timezone=${FUSO}` });
  const base = embrulhar((sql, params) => pool.query(sql, params));
  return {
    tipo: "postgres",
    ...base,
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const cliente = await pool.connect();
      try {
        await cliente.query("BEGIN");
        const r = await fn(embrulhar((sql, params) => cliente.query(sql, params)));
        await cliente.query("COMMIT");
        return r;
      } catch (e) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        cliente.release();
      }
    },
    fechar: () => pool.end(),
  };
}

async function abrirPglite(dir) {
  const { PGlite } = await import("@electric-sql/pglite");
  const parsers = { [INT8]: (v) => Number(v), [NUMERIC]: (v) => Number(v), [DATE]: (v) => v };
  let pglite;
  if (dir === ":memoria:") pglite = await PGlite.create({ parsers });
  else {
    fs.mkdirSync(dir, { recursive: true });
    pglite = await PGlite.create(dir, { parsers });
  }
  await pglite.exec(`SET TIME ZONE '${FUSO}'`);
  // O PGlite tem uma conexão só: as transações são enfileiradas para não se misturarem.
  let fila = Promise.resolve();
  const enfileirar = (fn) => {
    const r = fila.then(fn, fn);
    fila = r.catch(() => {});
    return r;
  };
  const base = embrulhar((sql, params) => enfileirar(() => pglite.query(sql, params)));
  return {
    tipo: "pglite",
    ...base,
    exec: (sql) => enfileirar(() => pglite.exec(sql)),
    tx: (fn) => enfileirar(() => pglite.transaction((t) => fn(embrulhar((sql, params) => t.query(sql, params))))),
    fechar: () => pglite.close(),
  };
}

export async function abrirBanco(config) {
  const db = config.databaseUrl ? await abrirPostgres(config.databaseUrl) : await abrirPglite(config.pgliteDir);
  await db.exec(ESQUEMA);
  // Servidor caiu no meio de um envio: a nota fica "pendente" e só a consulta resolve.
  await db.query("UPDATE notas SET status = 'pendente' WHERE status = 'enviando'");
  // Inutilização que ficou sem resposta pode ser enviada de novo (a SEFAZ responde 563 se já registrou).
  await db.query("UPDATE inutilizacoes SET status = 'sem_resposta' WHERE status = 'enviando'");
  return db;
}
