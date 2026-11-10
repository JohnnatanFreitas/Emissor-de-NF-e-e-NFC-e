// Papéis, ações e checagens de acesso usadas pelas rotas.
import { proibido, ErroHttp, naoEncontrado } from "./util.js";

export const TODAS_ACOES = [
  "gerir_usuarios", "gerir_empresas", "liberar_producao", "editar_perfis", "editar_produtos", "editar_pessoas",
  "pedidos", "emitir", "cancelar_nota", "estoque", "financeiro", "sped",
];

const ACOES_POR_PAPEL = {
  admin: TODAS_ACOES,
  // A equipe gere usuários (inclusive redefinir a senha de um admin), mas não cria nem promove admins.
  equipe: TODAS_ACOES.filter((a) => a !== "liberar_producao"),
  vendedor: ["editar_pessoas", "pedidos", "emitir"],
  financeiro: ["financeiro"],
};

export const acoesDoPapel = (papel) => ACOES_POR_PAPEL[papel] ?? [];

export function exigir(req, acao) {
  if (!req.usuario) throw new ErroHttp(401, "Faça login.");
  if (!acoesDoPapel(req.usuario.papel).includes(acao)) throw proibido();
}

export function enxergaEmpresa(usuario, empresaId) {
  if (["admin", "equipe"].includes(usuario.papel)) return true;
  return !usuario.empresas || usuario.empresas.includes(Number(empresaId));
}

export function eu(usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    empresas: usuario.empresas ?? null,
    trocar_senha: usuario.trocar_senha,
    acoes: acoesDoPapel(usuario.papel),
  };
}

/** Carrega a empresa da rota e confere acesso. */
export async function empresaDaRota(req, db) {
  const id = Number(req.params.eid);
  if (!Number.isInteger(id)) throw naoEncontrado("Empresa não encontrada.");
  if (!enxergaEmpresa(req.usuario, id)) throw proibido("Você não tem acesso a esta empresa.");
  const e = await db.one("SELECT * FROM empresas WHERE id = $1", [id]);
  if (!e) throw naoEncontrado("Empresa não encontrada.");
  return e;
}
