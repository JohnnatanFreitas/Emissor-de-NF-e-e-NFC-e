// Inutilização de numeração: avisa a SEFAZ que uma faixa de números da série nunca será usada
// (número pulado por erro, nota rejeitada que não vai mais sair, salto na sequência).
//
// Regras:
// - A faixa não pode conter nota que a SEFAZ conhece (autorizada, cancelada, denegada) nem nota
//   pendente ou em envio (essas precisam ser consultadas antes).
// - Notas rejeitadas / não enviadas dentro da faixa viram "inutilizada" quando a SEFAZ homologa.
// - Se a faixa passa do próximo número da série, o próximo número avança antes do envio (assim
//   nenhuma emissão usa um número que está sendo inutilizado). Se a SEFAZ recusar, ele volta.
import { criarSefaz } from "../nfe/sefaz.js";
import { interpretarInutilizacao } from "../nfe/retorno.js";
import { conflito, invalido, texto, hojeISO } from "../util.js";

const fabricaPadrao = (args) => criarSefaz(args);
const NUMERO_MAX = 999999999;
const FAIXA_MAX = 10000; // proteção contra digitação errada (ex.: 1 a 100000)
const STATUS_LIVRES = ["rejeitada", "nao_enviada", "falha_assinatura"];

export function inutilizacaoPublica(i) {
  return {
    id: i.id,
    modelo: i.modelo,
    serie: i.serie,
    numero_inicial: i.numero_inicial,
    numero_final: i.numero_final,
    justificativa: i.justificativa,
    ambiente: i.ambiente,
    status: i.status,
    protocolo: i.protocolo,
    c_stat: i.c_stat,
    x_motivo: i.x_motivo,
    usuario_nome: i.usuario_nome ?? null,
    criado_em: i.criado_em,
  };
}

function normalizar(d, empresa) {
  const modelo = String(d.modelo ?? "55");
  if (!["55", "65"].includes(modelo)) throw invalido("Modelo deve ser 55 (NF-e) ou 65 (NFC-e).");
  const serie = d.serie == null || d.serie === "" ? (modelo === "65" ? empresa.serie_nfce : empresa.serie_nfe) : Number(d.serie);
  if (!Number.isInteger(serie) || serie < 0 || serie > 999) throw invalido("Série inválida (0 a 999).");
  const inicio = Number(d.numero_inicial);
  const fim = d.numero_final == null || d.numero_final === "" ? inicio : Number(d.numero_final);
  if (!Number.isInteger(inicio) || inicio < 1 || inicio > NUMERO_MAX) throw invalido("Número inicial inválido.");
  if (!Number.isInteger(fim) || fim < inicio || fim > NUMERO_MAX) throw invalido("O número final deve ser maior ou igual ao inicial.");
  if (fim - inicio + 1 > FAIXA_MAX) throw invalido(`A faixa tem mais de ${FAIXA_MAX} números. Confira os números digitados.`);
  const justificativa = texto(d.justificativa, 255).normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (justificativa.length < 15) throw invalido("A justificativa precisa ter de 15 a 255 caracteres.");
  return { modelo, serie, inicio, fim, justificativa };
}

export async function inutilizarNumeracao({ db, config, empresaId, dados, usuarioId = null, fabrica = fabricaPadrao }) {
  // 1) Confere e reserva (numa transação com a empresa travada, como a emissão).
  const reserva = await db.tx(async (q) => {
    const empresa = await q.one("SELECT * FROM empresas WHERE id = $1 FOR UPDATE", [empresaId]);
    const { modelo, serie, inicio, fim, justificativa } = normalizar(dados ?? {}, empresa);

    const ocupadas = await q.many(
      `SELECT numero, status FROM notas
        WHERE empresa_id = $1 AND modelo = $2 AND serie = $3 AND numero BETWEEN $4 AND $5 AND NOT (status = ANY($6))
        ORDER BY numero LIMIT 5`,
      [empresa.id, modelo, serie, inicio, fim, STATUS_LIVRES]
    );
    if (ocupadas.length) {
      const lista = ocupadas.map((n) => `${n.numero} (${n.status})`).join(", ");
      throw conflito(`A faixa contém nota que não pode ser inutilizada: ${lista}. Notas pendentes precisam ser consultadas antes.`);
    }
    const sobreposta = await q.one(
      `SELECT numero_inicial, numero_final, status FROM inutilizacoes
        WHERE empresa_id = $1 AND modelo = $2 AND serie = $3 AND ambiente = $4 AND status IN ('homologada','enviando')
          AND numero_inicial <= $6 AND numero_final >= $5 LIMIT 1`,
      [empresa.id, modelo, serie, empresa.ambiente, inicio, fim]
    );
    if (sobreposta) {
      throw conflito(`Os números ${sobreposta.numero_inicial} a ${sobreposta.numero_final} já foram inutilizados (ou estão sendo enviados).`);
    }

    // A série em uso: se a faixa passa do próximo número, ele avança.
    const campo = modelo === "65" ? "proximo_nfce" : "proximo_nfe";
    const serieAtual = modelo === "65" ? empresa.serie_nfce : empresa.serie_nfe;
    let proximoAnterior = null;
    if (serie === serieAtual && inicio > empresa[campo]) {
      // Inutilizar números "do futuro" abriria um buraco entre o próximo número e o início da faixa.
      throw invalido(`O próximo número desta série é ${empresa[campo]}. A faixa deve começar em ${empresa[campo]} ou antes.`);
    }
    if (serie === serieAtual && fim >= empresa[campo]) {
      proximoAnterior = empresa[campo];
      await q.query(`UPDATE empresas SET ${campo} = $1 WHERE id = $2`, [fim + 1, empresa.id]);
    }

    const registro = await q.one(
      `INSERT INTO inutilizacoes (empresa_id, modelo, serie, numero_inicial, numero_final, justificativa, ambiente, status, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'enviando',$8) RETURNING *`,
      [empresa.id, modelo, serie, inicio, fim, justificativa, empresa.ambiente, usuarioId]
    );
    return { empresa, registro, campo, proximoAnterior };
  });

  // 2) Envia fora da transação (a SEFAZ pode demorar).
  const { empresa, registro, campo, proximoAnterior } = reserva;
  let resposta = null;
  let r;
  try {
    const sefaz = fabrica({ config, empresa, modelo: registro.modelo });
    resposta = await sefaz.inutilizar({
      serie: registro.serie, inicio: registro.numero_inicial, fim: registro.numero_final,
      justificativa: registro.justificativa, ano: Number(hojeISO().slice(0, 4)),
    });
    r = interpretarInutilizacao(typeof resposta === "string" ? resposta : String(resposta));
  } catch (e) {
    r = { situacao: "sem_resposta", cStat: null, xMotivo: `Sem resposta da SEFAZ: ${String(e?.message ?? e).slice(0, 200)}`, protocolo: null };
  }

  // 3) Grava o resultado.
  return db.tx(async (q) => {
    const status = r.situacao; // homologada | rejeitada | sem_resposta
    const atual = await q.one(
      `UPDATE inutilizacoes SET status = $2, protocolo = $3, c_stat = $4, x_motivo = $5, xml = $6 WHERE id = $1 RETURNING *`,
      [registro.id, status, r.protocolo, r.cStat, r.xMotivo, typeof resposta === "string" ? resposta : null]
    );
    if (status === "homologada") {
      await q.query(
        `UPDATE notas SET status = 'inutilizada', x_motivo = $7
          WHERE empresa_id = $1 AND modelo = $2 AND serie = $3 AND numero BETWEEN $4 AND $5 AND status = ANY($6)`,
        [registro.empresa_id, registro.modelo, registro.serie, registro.numero_inicial, registro.numero_final, STATUS_LIVRES,
          `Número inutilizado (protocolo ${r.protocolo ?? "-"})`]
      );
    } else if (status === "rejeitada" && proximoAnterior != null) {
      // A SEFAZ recusou: devolve o próximo número, se ninguém emitiu nada nesse meio tempo.
      await q.query(`UPDATE empresas SET ${campo} = $1 WHERE id = $2 AND ${campo} = $3`, [proximoAnterior, registro.empresa_id, registro.numero_final + 1]);
    }
    // sem_resposta: o próximo número fica avançado (a SEFAZ pode ter registrado). Basta enviar de novo:
    // se ela já tinha registrado, responde 563 e o sistema trata como homologada.
    return atual;
  });
}
