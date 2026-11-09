// Inutilização de numeração com SEFAZ simulada.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { servidorTeste, EMPRESA, CLIENTE_SP } from "./apoio.js";
import { inutilizarNumeracao } from "../src/servicos/inutilizacao.js";
import { criarSefazSimulada } from "../src/nfe/sefaz.js";
import { interpretarInutilizacao } from "../src/nfe/retorno.js";

let s;
let eid;
let produto;
let cliente;
const JUST = "Numero pulado por falha no sistema";

const proximoNfe = async () => (await s.db.one("SELECT proximo_nfe FROM empresas WHERE id = $1", [eid])).proximo_nfe;
const inutilizar = (corpo) => s.chamar("POST", `/api/empresas/${eid}/inutilizacoes`, { modelo: "55", justificativa: JUST, ...corpo });

async function emitirNfe() {
  const r = await s.chamar("POST", `/api/empresas/${eid}/pedidos`, {
    tipo: "pedido", cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 1, valor_unitario_cent: 1000 }],
    forma_pagamento: "01", emitir: true,
  });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.nota.status, "autorizada", r.json.erro_emissao);
  return r.json.nota;
}

before(async () => {
  s = await servidorTeste();
  await s.login();
  eid = (await s.chamar("POST", "/api/empresas", EMPRESA)).json.id;
  const perfis = (await s.chamar("GET", `/api/empresas/${eid}/perfis`)).json;
  produto = (await s.chamar("POST", `/api/empresas/${eid}/produtos`, {
    codigo: "P1", descricao: "PRODUTO TESTE", ncm: "8544.42.00", unidade: "UN", preco_cent: 1000, perfil_id: perfis[0].id, ativo: true,
  })).json;
  cliente = (await s.chamar("POST", `/api/empresas/${eid}/pessoas`, CLIENTE_SP)).json;
});
after(async () => s.fechar());

test("não inutiliza número de nota autorizada", async () => {
  const nota = await emitirNfe();
  assert.equal(nota.numero, 1);
  const r = await inutilizar({ numero_inicial: 1 });
  assert.equal(r.status, 409, r.body);
  assert.match(r.json.erro, /1 \(autorizada\)/);
});

test("não deixa abrir buraco depois do próximo número", async () => {
  const r = await inutilizar({ numero_inicial: 3, numero_final: 5 });
  assert.equal(r.status, 422, r.body);
  assert.match(r.json.erro, /próximo número desta série é 2/);
});

test("valida justificativa e faixa", async () => {
  assert.equal((await inutilizar({ numero_inicial: 2, justificativa: "curta" })).status, 422);
  assert.equal((await inutilizar({ numero_inicial: 5, numero_final: 2 })).status, 422);
  assert.equal((await inutilizar({ numero_inicial: 0 })).status, 422);
});

test("inutiliza 2 a 4: SEFAZ homologa, próximo número pula para 5", async () => {
  const r = await inutilizar({ numero_inicial: 2, numero_final: 4 });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.status, "homologada");
  assert.equal(r.json.c_stat, "102");
  assert.ok(r.json.protocolo);
  assert.equal(r.json.serie, 1);
  assert.equal(await proximoNfe(), 5);

  const nota = await emitirNfe();
  assert.equal(nota.numero, 5);

  const lista = (await s.chamar("GET", `/api/empresas/${eid}/inutilizacoes`)).json;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].usuario_nome, "Admin");
});

test("não inutiliza de novo a mesma faixa", async () => {
  const r = await inutilizar({ numero_inicial: 3 });
  assert.equal(r.status, 409, r.body);
  assert.match(r.json.erro, /já foram inutilizados/);
});

test("nota rejeitada dentro da faixa vira 'inutilizada'", async () => {
  // Simula uma NF-e 6 rejeitada que não vai mais sair.
  await s.db.query(
    `INSERT INTO notas (empresa_id, modelo, serie, numero, status, ambiente, c_stat, x_motivo) VALUES ($1,'55',1,6,'rejeitada',2,'539','Rejeicao')`,
    [eid]
  );
  await s.db.query("UPDATE empresas SET proximo_nfe = 7 WHERE id = $1", [eid]);
  const r = await inutilizar({ numero_inicial: 6 });
  assert.equal(r.status, 200, r.body);
  const n = await s.db.one("SELECT status, x_motivo FROM notas WHERE empresa_id = $1 AND numero = 6", [eid]);
  assert.equal(n.status, "inutilizada");
  assert.match(n.x_motivo, /inutilizado/);
  assert.equal(await proximoNfe(), 7);
});

test("SEFAZ recusa: registra a recusa e devolve o próximo número", async () => {
  const fabrica = ({ empresa, modelo }) => criarSefazSimulada({ empresa, modelo, rejeitarCom: { cStat: "241", xMotivo: "Rejeicao: Um numero da faixa ja foi utilizado" } });
  const r = await inutilizarNumeracao({ db: s.db, config: s.config, empresaId: eid, dados: { modelo: "55", numero_inicial: 7, numero_final: 8, justificativa: JUST }, fabrica });
  assert.equal(r.status, "rejeitada");
  assert.equal(r.c_stat, "241");
  assert.equal(await proximoNfe(), 7);
  // A recusa não bloqueia uma nova tentativa da mesma faixa.
  const ok = await inutilizar({ numero_inicial: 7, numero_final: 8 });
  assert.equal(ok.status, 200, ok.body);
  assert.equal(await proximoNfe(), 9);
});

test("sem resposta da SEFAZ: fica 'sem_resposta', número continua reservado e pode reenviar", async () => {
  const fabrica = () => ({ inutilizar: async () => { throw new Error("ECONNRESET"); } });
  const r = await inutilizarNumeracao({ db: s.db, config: s.config, empresaId: eid, dados: { modelo: "55", numero_inicial: 9, justificativa: JUST }, fabrica });
  assert.equal(r.status, "sem_resposta");
  assert.equal(await proximoNfe(), 10);
  const ok = await inutilizar({ numero_inicial: 9 });
  assert.equal(ok.status, 200, ok.body);
  assert.equal(ok.json.status, "homologada");
});

test("retorno 563 (faixa já inutilizada na SEFAZ) conta como homologada", () => {
  const r = interpretarInutilizacao(
    `<retInutNFe versao="4.00"><infInut><cStat>563</cStat><xMotivo>Rejeicao: Ja existe pedido de inutilizacao com a mesma faixa</xMotivo></infInut></retInutNFe>`
  );
  assert.equal(r.situacao, "homologada");
  assert.equal(interpretarInutilizacao("<retInutNFe><infInut><cStat>241</cStat><xMotivo>x</xMotivo></infInut></retInutNFe>").situacao, "rejeitada");
});
