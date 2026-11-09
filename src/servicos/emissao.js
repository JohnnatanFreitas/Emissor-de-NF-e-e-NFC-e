// Fluxo da nota: reserva o número, monta, assina e valida (tudo numa transação: se falhar, o número
// não é gasto), envia, e aplica os efeitos da autorização (estoque, contas a receber, pedido).
// Também consulta, reenvia, cancela e envia carta de correção.
import { montarXml } from "../nfe/montar.js";
import { criarSefaz } from "../nfe/sefaz.js";
import { interpretarEnvio, interpretarConsulta, interpretarEvento, montarNfeProc } from "../nfe/retorno.js";
import { carregarCliente, carregarItens, itemPublico } from "./carregar.js";
import { calcularDocumento } from "../fiscal/calculo.js";
import { movimentar } from "./estoque.js";
import { conflito, invalido, soDigitos, validarCPF, validarCNPJ, texto, ErroHttp } from "../util.js";

const fabricaPadrao = (args) => criarSefaz(args);

/** Monta cliente + cálculo + pagamentos a partir da entrada guardada na nota. */
async function prepararDocumento(q, empresa, modelo, entrada) {
  let cliente = null;
  let destinatario = "CONSUMIDOR NÃO IDENTIFICADO";
  if (modelo === "55") {
    cliente = await carregarCliente(q, empresa.id, entrada.cliente_id);
    if (!cliente) throw invalido("Escolha o cliente da NF-e.");
    if (!cliente.logradouro || !cliente.cod_municipio || !cliente.uf || !cliente.cep) {
      throw invalido("O cadastro do cliente está sem endereço completo (logradouro, município IBGE, UF e CEP).");
    }
    destinatario = cliente.nome;
  } else if (entrada.consumidor?.cpf) {
    const doc = soDigitos(entrada.consumidor.cpf);
    if (doc.length === 11 ? !validarCPF(doc) : !validarCNPJ(doc)) throw invalido("CPF/CNPJ do consumidor inválido.");
    cliente = { cpf_cnpj: doc, nome: texto(entrada.consumidor.nome, 60) || null };
    destinatario = cliente.nome || doc;
  }
  const itens = await carregarItens(q, empresa.id, entrada.itens);
  const calculo = calcularDocumento({ empresa, cliente: modelo === "65" ? null : cliente, modelo, itens });
  const total = calculo.totais.total_cent;
  const pagamentos = (entrada.pagamentos?.length ? entrada.pagamentos : [{ tPag: "01", valor_cent: total }]).map((p) => ({
    tPag: String(p.tPag).padStart(2, "0"),
    valor_cent: Math.round(Number(p.valor_cent ?? total)),
  }));
  const duplicatas = modelo === "55" ? entrada.duplicatas ?? [] : [];
  if (duplicatas.length) {
    const soma = duplicatas.reduce((s, d) => s + d.valor_cent, 0);
    if (soma !== total) {
      // Recalcula as parcelas sobre o total atual (o total pode mudar se o cadastro mudou antes do reenvio).
      const n = duplicatas.length;
      const base = Math.floor(total / n);
      duplicatas.forEach((d, i) => (d.valor_cent = base + (i === 0 ? total - base * n : 0)));
    }
    if (pagamentos.length === 1) pagamentos[0].valor_cent = total;
  }
  return { cliente, destinatario, calculo, pagamentos, duplicatas };
}

/** Monta, assina e valida. Lança 422 se o leiaute não passar (nada é enviado). */
async function montarAssinarValidar({ sefaz, empresa, doc, modelo, serie, numero, natureza, config, infCpl }) {
  const { xml, chave } = montarXml({
    empresa,
    cliente: doc.cliente,
    calculo: doc.calculo,
    pagamentos: doc.pagamentos,
    duplicatas: doc.duplicatas,
    nota: { modelo, serie, numero, ambiente: empresa.ambiente, natureza, infCpl },
    respTec: config.respTec,
  });
  let assinado;
  try {
    assinado = await sefaz.assinar(xml);
  } catch (e) {
    throw invalido(`Não foi possível assinar a nota com o certificado: ${String(e?.message ?? e).slice(0, 300)}`);
  }
  const v = await sefaz.validar(assinado);
  if (!v.ok) throw invalido(`A nota não passou na validação do leiaute: ${v.erro.slice(0, 600)}. Nada foi enviado e o número não foi gasto.`);
  return { xml: assinado, chave };
}

function sefazDa(config, empresa, modelo, fabrica) {
  if (modelo === "65" && !empresa.csc_cifrado) throw invalido("Cadastre o CSC da NFC-e em Configurações → Empresa antes de emitir.");
  return fabrica({ config, empresa, modelo });
}

/**
 * Emite NF-e (55) ou NFC-e (65).
 * entrada: { cliente_id?, consumidor?: { cpf, nome }, itens, pagamentos?, duplicatas?, infCpl? }
 */
export async function emitirNota({ db, config, empresaId, modelo, entrada, pedidoId = null, usuarioId = null, fabrica = fabricaPadrao }) {
  const nota = await db.tx(async (q) => {
    const empresa = await q.one("SELECT * FROM empresas WHERE id = $1 FOR UPDATE", [empresaId]);
    const sefaz = sefazDa(config, empresa, modelo, fabrica);
    const doc = await prepararDocumento(q, empresa, modelo, entrada);
    const serie = modelo === "65" ? empresa.serie_nfce : empresa.serie_nfe;
    const numero = modelo === "65" ? empresa.proximo_nfce : empresa.proximo_nfe;
    const natureza = "VENDA";
    const { xml, chave } = await montarAssinarValidar({ sefaz, empresa, doc, modelo, serie, numero, natureza, config, infCpl: entrada.infCpl });
    const n = await q.one(
      `INSERT INTO notas (empresa_id, modelo, serie, numero, chave, status, ambiente, cliente_id, destinatario, pedido_id, natureza,
                          total_cent, totais, dados, xml_assinado, enviando_desde)
       VALUES ($1,$2,$3,$4,$5,'enviando',$6,$7,$8,$9,$10,$11,$12,$13,$14,now()) RETURNING *`,
      [
        empresa.id, modelo, serie, numero, chave, empresa.ambiente, modelo === "55" ? doc.cliente.id : null, doc.destinatario, pedidoId, natureza,
        doc.calculo.totais.total_cent, JSON.stringify(doc.calculo.totais),
        JSON.stringify({ entrada, itens: doc.calculo.itens.map(itemPublico), pagamentos: doc.pagamentos, duplicatas: doc.duplicatas, usuario_id: usuarioId }),
        xml,
      ]
    );
    await q.query(`UPDATE empresas SET ${modelo === "65" ? "proximo_nfce" : "proximo_nfe"} = $1 WHERE id = $2`, [numero + 1, empresa.id]);
    return n;
  });
  return enviar({ db, config, nota, fabrica, usuarioId });
}

/** Envia o XML já assinado e grava o resultado. Queda de conexão vira "pendente" (só a consulta resolve). */
async function enviar({ db, config, nota, fabrica, usuarioId }) {
  const empresa = await db.one("SELECT * FROM empresas WHERE id = $1", [nota.empresa_id]);
  const sefaz = fabrica({ config, empresa, modelo: nota.modelo });
  let r;
  try {
    r = interpretarEnvio(await sefaz.enviar(nota.xml_assinado));
  } catch (e) {
    r = { situacao: "sem_resposta", cStat: null, xMotivo: `Sem resposta da SEFAZ: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  return gravarResultado({ db, nota, r, usuarioId });
}

async function gravarResultado({ db, nota, r, usuarioId }) {
  return db.tx(async (q) => {
    if (r.situacao === "autorizada") {
      const proc = montarNfeProc(nota.xml_assinado, r.protNFeXml);
      const n = await q.one(
        `UPDATE notas SET status = 'autorizada', protocolo = $2, c_stat = $3, x_motivo = $4, xml_autorizado = $5, autorizada_em = now()
          WHERE id = $1 RETURNING *`,
        [nota.id, r.protocolo, r.cStat, r.xMotivo, proc]
      );
      await aplicarEfeitos(q, n, usuarioId ?? n.dados?.usuario_id ?? null);
      return q.one("SELECT * FROM notas WHERE id = $1", [n.id]);
    }
    const status = { rejeitada: "rejeitada", denegada: "denegada" }[r.situacao] ?? "pendente";
    return q.one("UPDATE notas SET status = $2, c_stat = $3, x_motivo = $4 WHERE id = $1 RETURNING *", [nota.id, status, r.cStat, r.xMotivo]);
  });
}

/** Efeitos da autorização, uma única vez: baixa de estoque, parcelas a receber e pedido faturado. */
async function aplicarEfeitos(q, nota, usuarioId) {
  if (nota.efeitos_aplicados) return;
  for (const it of nota.dados?.itens ?? []) {
    await movimentar(q, {
      empresa_id: nota.empresa_id, produto_id: it.produto_id, tipo: "venda", quantidade: -Number(it.quantidade),
      nota_id: nota.id, observacao: `${nota.modelo === "65" ? "NFC-e" : "NF-e"} ${nota.numero}`, usuario_id: usuarioId,
    });
  }
  for (const [i, d] of (nota.dados?.duplicatas ?? []).entries()) {
    await q.query(
      `INSERT INTO contas_receber (empresa_id, nota_id, pedido_id, cliente_id, parcela, numero_dup, vencimento, valor_cent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [nota.empresa_id, nota.id, nota.pedido_id, nota.cliente_id, i + 1, d.numero, d.vencimento, d.valor_cent]
    );
  }
  if (nota.pedido_id) {
    await q.query("UPDATE pedidos SET status = 'faturado', tipo = 'pedido', nota_id = $2, atualizado_em = now() WHERE id = $1", [nota.pedido_id, nota.id]);
  }
  await q.query("UPDATE notas SET efeitos_aplicados = true WHERE id = $1", [nota.id]);
}

/** Desfaz os efeitos no cancelamento: estoque volta, parcelas canceladas, pedido reaberto. */
async function reverterEfeitos(q, nota, usuarioId) {
  if (!nota.efeitos_aplicados) return;
  for (const it of nota.dados?.itens ?? []) {
    await movimentar(q, {
      empresa_id: nota.empresa_id, produto_id: it.produto_id, tipo: "estorno_venda", quantidade: Number(it.quantidade),
      nota_id: nota.id, observacao: `Cancelamento ${nota.modelo === "65" ? "NFC-e" : "NF-e"} ${nota.numero}`, usuario_id: usuarioId,
    });
  }
  await q.query("UPDATE contas_receber SET status = 'cancelada' WHERE nota_id = $1 AND status <> 'cancelada'", [nota.id]);
  if (nota.pedido_id) {
    await q.query("UPDATE pedidos SET status = 'aberto', nota_id = NULL, atualizado_em = now() WHERE id = $1", [nota.pedido_id]);
  }
  await q.query("UPDATE notas SET efeitos_aplicados = false WHERE id = $1", [nota.id]);
}

export async function consultarNota({ db, config, nota, fabrica = fabricaPadrao, usuarioId }) {
  if (!nota.chave) throw conflito("A nota não tem chave para consultar.");
  const empresa = await db.one("SELECT * FROM empresas WHERE id = $1", [nota.empresa_id]);
  let r;
  try {
    r = interpretarConsulta(await fabrica({ config, empresa, modelo: nota.modelo }).consultar(nota.chave));
  } catch (e) {
    throw new ErroHttp(502, `A SEFAZ não respondeu à consulta: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  if (r.situacao === "autorizada" && nota.status !== "autorizada" && nota.status !== "cancelada") {
    return gravarResultado({ db, nota, r, usuarioId });
  }
  return db.tx(async (q) => {
    if (r.situacao === "cancelada" && nota.status !== "cancelada") {
      await reverterEfeitos(q, nota, usuarioId);
      return q.one("UPDATE notas SET status = 'cancelada', cancelada_em = coalesce(cancelada_em, now()), c_stat = $2, x_motivo = $3 WHERE id = $1 RETURNING *", [nota.id, r.cStat, r.xMotivo]);
    }
    if (r.situacao === "nao_encontrada" && ["pendente", "enviando"].includes(nota.status)) {
      return q.one("UPDATE notas SET status = 'nao_enviada', c_stat = $2, x_motivo = $3 WHERE id = $1 RETURNING *", [nota.id, r.cStat, r.xMotivo]);
    }
    if (r.situacao === "denegada") return q.one("UPDATE notas SET status = 'denegada', c_stat = $2, x_motivo = $3 WHERE id = $1 RETURNING *", [nota.id, r.cStat, r.xMotivo]);
    return q.one("UPDATE notas SET c_stat = $2, x_motivo = $3 WHERE id = $1 RETURNING *", [nota.id, r.cStat, r.xMotivo]);
  });
}

/** Reenvia com o MESMO número (nota rejeitada ou que a consulta confirmou não ter chegado). */
export async function reenviarNota({ db, config, nota, fabrica = fabricaPadrao, usuarioId }) {
  if (!["rejeitada", "nao_enviada", "falha_assinatura"].includes(nota.status)) {
    throw conflito(nota.status === "pendente" ? "Nota pendente: consulte a SEFAZ antes de reenviar (evita duplicidade)." : "Esta nota não pode ser reenviada.");
  }
  const atualizada = await db.tx(async (q) => {
    const n = await q.one("SELECT * FROM notas WHERE id = $1 FOR UPDATE", [nota.id]);
    if (n.status !== nota.status) throw conflito("A nota mudou de situação. Atualize a tela.");
    const empresa = await q.one("SELECT * FROM empresas WHERE id = $1", [n.empresa_id]);
    const sefaz = sefazDa(config, empresa, n.modelo, fabrica);
    const doc = await prepararDocumento(q, empresa, n.modelo, n.dados.entrada);
    const { xml, chave } = await montarAssinarValidar({
      sefaz, empresa, doc, modelo: n.modelo, serie: n.serie, numero: n.numero, natureza: n.natureza, config, infCpl: n.dados.entrada?.infCpl,
    });
    return q.one(
      `UPDATE notas SET status = 'enviando', enviando_desde = now(), chave = $2, xml_assinado = $3, total_cent = $4, totais = $5, dados = $6,
              destinatario = $7, ambiente = $8, c_stat = NULL, x_motivo = NULL WHERE id = $1 RETURNING *`,
      [
        n.id, chave, xml, doc.calculo.totais.total_cent, JSON.stringify(doc.calculo.totais),
        JSON.stringify({ ...n.dados, itens: doc.calculo.itens.map(itemPublico), pagamentos: doc.pagamentos, duplicatas: doc.duplicatas }),
        doc.destinatario, empresa.ambiente,
      ]
    );
  });
  return enviar({ db, config, nota: atualizada, fabrica, usuarioId });
}

export async function cancelarNota({ db, config, nota, justificativa, fabrica = fabricaPadrao, usuarioId }) {
  const just = texto(justificativa, 255);
  if (just.length < 15) throw invalido("A justificativa do cancelamento precisa ter de 15 a 255 caracteres.");
  if (nota.status !== "autorizada") throw conflito("Só nota autorizada pode ser cancelada.");
  const empresa = await db.one("SELECT * FROM empresas WHERE id = $1", [nota.empresa_id]);
  let r;
  try {
    r = interpretarEvento(await fabrica({ config, empresa, modelo: nota.modelo }).cancelar({ chave: nota.chave, protocolo: nota.protocolo, justificativa: just, sequencia: 1 }));
  } catch (e) {
    throw new ErroHttp(502, `Falha ao enviar o cancelamento: ${String(e?.message ?? e).slice(0, 300)}`);
  }
  const sqlEvento = `INSERT INTO nota_eventos (nota_id, tipo, sequencia, texto, protocolo, c_stat, x_motivo, registrado) VALUES ($1,'cancelamento',1,$2,$3,$4,$5,$6)`;
  if (!r.registrado) {
    await db.query(sqlEvento, [nota.id, just, r.protocolo, r.cStat, r.xMotivo, false]);
    throw conflito(`A SEFAZ recusou o cancelamento: ${r.cStat} - ${r.xMotivo}`);
  }
  return db.tx(async (q) => {
    await q.query(sqlEvento, [nota.id, just, r.protocolo, r.cStat, r.xMotivo, true]);
    const atual = await q.one("SELECT * FROM notas WHERE id = $1 FOR UPDATE", [nota.id]);
    await reverterEfeitos(q, atual, usuarioId);
    return q.one("UPDATE notas SET status = 'cancelada', cancelada_em = now(), c_stat = $2, x_motivo = $3 WHERE id = $1 RETURNING *", [nota.id, r.cStat, r.xMotivo]);
  });
}

export async function cceNota({ db, config, nota, correcao, fabrica = fabricaPadrao }) {
  const txt = texto(correcao, 1000).normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (txt.length < 15) throw invalido("A correção precisa ter de 15 a 1000 caracteres.");
  if (nota.modelo !== "55") throw invalido("Carta de correção só existe para NF-e (modelo 55).");
  if (nota.status !== "autorizada") throw conflito("Só nota autorizada aceita carta de correção.");
  const { seq } = await db.one("SELECT coalesce(max(sequencia),0)::int + 1 AS seq FROM nota_eventos WHERE nota_id = $1 AND tipo = 'cce' AND registrado", [nota.id]);
  if (seq > 20) throw conflito("A nota já tem 20 cartas de correção (limite da SEFAZ).");
  const empresa = await db.one("SELECT * FROM empresas WHERE id = $1", [nota.empresa_id]);
  let r;
  try {
    r = interpretarEvento(await fabrica({ config, empresa, modelo: "55" }).cce({ chave: nota.chave, correcao: txt, sequencia: seq }));
  } catch (e) {
    throw new ErroHttp(502, `Falha ao enviar a carta de correção: ${String(e?.message ?? e).slice(0, 300)}`);
  }
  await db.query(
    `INSERT INTO nota_eventos (nota_id, tipo, sequencia, texto, protocolo, c_stat, x_motivo, registrado) VALUES ($1,'cce',$2,$3,$4,$5,$6,$7)`,
    [nota.id, seq, txt, r.protocolo, r.cStat, r.xMotivo, r.registrado]
  );
  if (!r.registrado) throw conflito(`A SEFAZ recusou a carta de correção: ${r.cStat} - ${r.xMotivo}`);
  return db.one("SELECT * FROM notas WHERE id = $1", [nota.id]);
}
