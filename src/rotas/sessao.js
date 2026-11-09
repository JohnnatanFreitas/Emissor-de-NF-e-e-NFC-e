// Login, sessão, minha senha, usuários, saúde e consulta de CNPJ.
import { assinarToken, conferirSenha, hashSenha } from "../seguranca.js";
import { exigir, eu, acoesDoPapel } from "../acesso.js";
import { consultarCnpj } from "../receita.js";
import { ErroHttp, invalido, naoEncontrado, pegar, montarSet, texto } from "../util.js";
import { COOKIE } from "../app.js";

const PAPEIS = ["admin", "equipe", "vendedor", "financeiro"];
const VERSAO = "1.0.0";

function senhaForte(s) {
  if (String(s ?? "").length < 12) throw invalido("A senha precisa ter pelo menos 12 caracteres.");
}

const usuarioPublico = (u) => ({
  id: u.id, nome: u.nome, email: u.email, papel: u.papel, empresas: u.empresas ?? null,
  ativo: u.ativo, trocar_senha: u.trocar_senha, criado_em: u.criado_em,
});

export async function rotasSessao(api, { db, config, fetchImpl }) {
  // Limite simples de tentativas de login por IP+email (10 em 15 minutos).
  const tentativas = new Map();
  const JANELA = 15 * 60 * 1000;

  const gravarCookie = (reply, u) => {
    const token = assinarToken({ uid: u.id, v: u.senha_hash.slice(-12) }, config.jwtSecret);
    reply.setCookie(COOKIE, token, { path: "/", httpOnly: true, sameSite: "strict", secure: config.cookieSeguro, maxAge: 12 * 3600 });
  };

  api.get("/saude", async () => ({ ok: true, versao: VERSAO, banco: db.tipo, modo_sefaz: config.modoSefaz }));

  api.post("/sessao", async (req, reply) => {
    const email = texto(req.body?.email, 200).toLowerCase();
    const senha = String(req.body?.senha ?? "");
    const chave = `${req.ip}|${email}`;
    const agora = Date.now();
    const lista = (tentativas.get(chave) ?? []).filter((t) => agora - t < JANELA);
    if (lista.length >= 10) throw new ErroHttp(429, "Muitas tentativas. Aguarde alguns minutos.");
    const u = email ? await db.one("SELECT * FROM usuarios WHERE email = $1", [email]) : null;
    if (!u || !u.ativo || !conferirSenha(senha, u.senha_hash)) {
      lista.push(agora);
      tentativas.set(chave, lista);
      throw new ErroHttp(401, "E-mail ou senha incorretos.");
    }
    tentativas.delete(chave);
    gravarCookie(reply, u);
    return eu(u);
  });

  api.delete("/sessao", async (req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  api.get("/eu", async (req) => eu(req.usuario));

  api.post("/eu/senha", async (req, reply) => {
    const { senha_atual, nova_senha } = req.body ?? {};
    if (!conferirSenha(senha_atual ?? "", req.usuario.senha_hash)) throw invalido("A senha atual não confere.");
    senhaForte(nova_senha);
    if (nova_senha === senha_atual) throw invalido("A nova senha precisa ser diferente da atual.");
    const u = await db.one("UPDATE usuarios SET senha_hash = $1, trocar_senha = false WHERE id = $2 RETURNING *", [hashSenha(nova_senha), req.usuario.id]);
    gravarCookie(reply, u);
    return { ok: true };
  });

  api.get("/cnpj/:cnpj", async (req) => consultarCnpj(req.params.cnpj, { url: config.consultaCnpjUrl, fetchImpl }));

  // ---- Usuários (admin) ----
  api.get("/usuarios", async (req) => {
    exigir(req, "gerir_usuarios");
    return (await db.many("SELECT * FROM usuarios ORDER BY nome")).map(usuarioPublico);
  });

  const validarUsuario = (d, novo) => {
    if (novo || d.nome !== undefined) if (!texto(d.nome)) throw invalido("Informe o nome.");
    if (novo || d.email !== undefined) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email ?? ""))) throw invalido("E-mail inválido.");
    if (novo || d.papel !== undefined) if (!PAPEIS.includes(d.papel)) throw invalido("Papel inválido.");
    if (d.empresas != null && (!Array.isArray(d.empresas) || d.empresas.some((x) => !Number.isInteger(Number(x))))) throw invalido("Lista de empresas inválida.");
  };

  api.post("/usuarios", async (req) => {
    exigir(req, "gerir_usuarios");
    const d = req.body ?? {};
    validarUsuario(d, true);
    if (d.papel === "admin" && req.usuario.papel !== "admin") throw invalido("Só um administrador cria outro administrador.");
    senhaForte(d.senha);
    const u = await db.one(
      `INSERT INTO usuarios (nome, email, senha_hash, papel, empresas, trocar_senha) VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
      [texto(d.nome), String(d.email).trim().toLowerCase(), hashSenha(d.senha), d.papel, d.empresas?.length ? d.empresas.map(Number) : null]
    );
    return usuarioPublico(u);
  });

  api.put("/usuarios/:id", async (req) => {
    exigir(req, "gerir_usuarios");
    const id = Number(req.params.id);
    const d = req.body ?? {};
    validarUsuario(d, false);
    const campos = pegar(d, ["nome", "email", "papel", "ativo"]);
    if (campos.email) campos.email = String(campos.email).trim().toLowerCase();
    if (d.empresas !== undefined) campos.empresas = d.empresas?.length ? d.empresas.map(Number) : null;
    if (d.senha) {
      senhaForte(d.senha);
      campos.senha_hash = hashSenha(d.senha);
      campos.trocar_senha = true;
    }
    if (id === req.usuario.id && (campos.ativo === false || (campos.papel && campos.papel !== req.usuario.papel))) {
      throw invalido("Você não pode desativar nem mudar o papel do seu próprio usuário.");
    }
    if (req.usuario.papel !== "admin") {
      const alvo = await db.one("SELECT papel FROM usuarios WHERE id = $1", [id]);
      const soSenha = Object.keys(campos).every((k) => ["senha_hash", "trocar_senha"].includes(k));
      if (campos.papel === "admin" || (alvo?.papel === "admin" && !soSenha)) {
        throw invalido("A equipe só pode redefinir a senha de um administrador; o resto é com outro administrador.");
      }
    }
    if (!Object.keys(campos).length) throw invalido("Nada para alterar.");
    const { sql, valores } = montarSet(campos, 2);
    const u = await db.one(`UPDATE usuarios SET ${sql} WHERE id = $1 RETURNING *`, [id, ...valores]);
    if (!u) throw naoEncontrado("Usuário não encontrado.");
    return usuarioPublico(u);
  });
}

export { acoesDoPapel };
