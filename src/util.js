// Utilitários pequenos usados em todo o servidor.

/** Erro com status HTTP e mensagem para o usuário (vira `{ erro }`). */
export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}
export const invalido = (msg) => new ErroHttp(422, msg);
export const naoEncontrado = (msg = "Registro não encontrado.") => new ErroHttp(404, msg);
export const conflito = (msg) => new ErroHttp(409, msg);
export const proibido = (msg = "Acesso restrito ao seu perfil.") => new ErroHttp(403, msg);

export const soDigitos = (s) => String(s ?? "").replace(/\D/g, "");
export const reais = (cent) => (Math.round(Number(cent)) / 100).toFixed(2);
export const centavos = (valor) => Math.round(Number(valor) * 100);
/** Arredonda centavos (pode vir fracionado de multiplicação por alíquota). */
export const arred = (v) => Math.round(Number(v) + Number.EPSILON * Math.sign(Number(v)));

export function validarCNPJ(cnpj) {
  const c = soDigitos(cnpj);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const d of base) {
      soma += Number(d) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

export function validarCPF(cpf) {
  const c = soDigitos(cpf);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/** Copia só as chaves permitidas que vieram no objeto. */
export function pegar(obj, chaves) {
  const r = {};
  for (const k of chaves) if (obj && Object.hasOwn(obj, k) && obj[k] !== undefined) r[k] = obj[k];
  return r;
}

/** Monta "SET a=$1, b=$2" a partir de um objeto, começando no parâmetro `inicio`. */
export function montarSet(campos, inicio = 1) {
  const chaves = Object.keys(campos);
  return {
    sql: chaves.map((k, i) => `${k} = $${i + inicio}`).join(", "),
    valores: chaves.map((k) => campos[k]),
  };
}

export const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function somarDias(dataISO, dias) {
  const d = new Date(`${dataISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function texto(v, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}
