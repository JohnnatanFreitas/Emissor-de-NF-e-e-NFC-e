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

async function abrirPostgres(url, { serverless = false } = {}) {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(INT8, (v) => Number(v));
  pg.types.setTypeParser(NUMERIC, (v) => Number(v));
  pg.types.setTypeParser(DATE, (v) => v);
  // Datas do dia (painel, vencimentos) no horário de Brasília, não em UTC.
  // Na Vercel cada instância da função tem o seu pool: poucas conexões, liberadas logo.
  const pool = new pg.Pool({
    connectionString: url,
    max: serverless ? 3 : 10,
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    options: `-c timezone=${FUSO}`,
  });
  pool.on("error", () => {}); // conexão ociosa derrubada pelo servidor: o pool abre outra
  // Fuso também como padrão do banco (vale até se a conexão passar por um pgbouncer).
  await pool
    .query(`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), '${FUSO}'); END $$`)
    .catch(() => {});
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

// Trava do esquema: várias instâncias da função subindo juntas não criam as tabelas ao mesmo tempo.
const TRAVA_ESQUEMA = 7_420_011;

export async function abrirBanco(config) {
  const db = config.databaseUrl ? await abrirPostgres(config.databaseUrl, config) : await abrirPglite(config.pgliteDir);
  if (db.tipo === "postgres") {
    await db.tx(async (q) => {
      await q.query(`SELECT pg_advisory_xact_lock(${TRAVA_ESQUEMA})`);
      await q.query(ESQUEMA);
    });
  } else {
    await db.exec(ESQUEMA);
  }
  await liberarEnviosParados(db, config);
  return db;
}

/**
 * Envio interrompido (servidor caiu, função encerrada no meio): a nota vira "pendente" e só a
 * consulta resolve; a inutilização fica "sem_resposta" e pode ser enviada de novo.
 * Num servidor único, tudo que estava "enviando" ao subir parou. Na Vercel outra instância pode
 * estar enviando agora: só conta como parado o que passou do tempo máximo de uma função.
 */
export async function liberarEnviosParados(db, config) {
  const cond = config.serverless ? "AND coalesce(enviando_desde, emitida_em) < now() - interval '10 minutes'" : "";
  const condInut = config.serverless ? "AND criado_em < now() - interval '10 minutes'" : "";
  await db.query(`UPDATE notas SET status = 'pendente' WHERE status = 'enviando' ${cond}`);
  await db.query(`UPDATE inutilizacoes SET status = 'sem_resposta' WHERE status = 'enviando' ${condInut}`);
}
