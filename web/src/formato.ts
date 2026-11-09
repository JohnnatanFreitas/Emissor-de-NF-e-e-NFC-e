/** Formatação pt-BR do Argus Emissor: dinheiro (a API manda centavos), datas, CNPJ/CPF e chave de acesso. */

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const DECIMAL2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })
const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
const INTEIRO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** Centavos (inteiro) em "R$ 1.234,56"; nulo ou inválido: "—". */
export function brl(centavos: number | null | undefined) {
  if (centavos == null || !Number.isFinite(Number(centavos))) return '—'
  return MOEDA.format(Number(centavos) / 100).replace(/ /g, ' ')
}

/** Centavos em texto para um campo editável: 123456 → "1.234,56". */
export function centavosParaTexto(centavos: number | null | undefined) {
  if (centavos == null || !Number.isFinite(Number(centavos))) return ''
  return DECIMAL2.format(Number(centavos) / 100)
}

/** Texto digitado ("1.234,56", "1234.56", "12") em centavos; vazio ou inválido: null. */
export function textoParaCentavos(texto: string): number | null {
  let t = texto.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

/** Número decimal digitado ("1,5", "2.000,25") em número; vazio ou inválido: null. */
export function textoParaNumero(texto: string): number | null {
  let t = texto.trim().replace(/\s/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** Número em texto pt-BR para campo editável (sem milhar): 1.5 → "1,5". */
export function numeroParaTexto(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  return String(n).replace('.', ',')
}

/** Quantidade com até 4 casas: 1500.5 → "1.500,5". */
export function quantidade(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return QTD.format(Number(n))
}

export function inteiro(n: number | null | undefined) {
  return INTEIRO.format(Number(n ?? 0) || 0)
}

/** Alíquota em % (a API manda 18 = 18%): "18%", "0,1%". */
export function pct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${PCT.format(Number(n))}%`
}

/** AAAA-MM-DD[...] em dd/mm/aaaa, sem passar por Date (não muda de dia por causa do fuso). */
export function dataBR(iso: string | null | undefined) {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',
})

/** Instante ISO em "dd/mm/aaaa hh:mm" no horário de Brasília; vazio ou inválido: "—". */
export function dataHoraBR(iso: string | null | undefined) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return '—'
  const p = Object.fromEntries(DATA_HORA.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`
}

/** Hoje em AAAA-MM-DD no horário de Brasília. */
export function hojeISO(base = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(base).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Soma dias a uma data AAAA-MM-DD (sem fuso). */
export function somarDias(iso: string, dias: number) {
  const [a, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d + dias))
  return dt.toISOString().slice(0, 10)
}

export function soDigitos(v: string | null | undefined) {
  return (v ?? '').replace(/\D/g, '')
}

export function cnpjBR(v: string | null | undefined) {
  const d = soDigitos(v)
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (v || '—')
}

export function cpfBR(v: string | null | undefined) {
  const d = soDigitos(v)
  return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : (v || '—')
}

/** CPF (11 dígitos) ou CNPJ (14 dígitos) formatado; outro tamanho sai como veio. */
export function documentoBR(v: string | null | undefined) {
  const d = soDigitos(v)
  if (d.length === 14) return cnpjBR(d)
  if (d.length === 11) return cpfBR(d)
  return v || '—'
}

/** Máscara progressiva enquanto digita: CPF até 11 dígitos, CNPJ de 12 a 14. */
export function mascaraDocumento(v: string) {
  const d = soDigitos(v).slice(0, 14)
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4').replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5')
}

/** Dígitos verificadores do CNPJ (módulo 11). */
export function cnpjValido(v: string) {
  const d = soDigitos(v)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const dv = (base: string) => {
    let soma = 0
    let peso = base.length - 7
    for (const c of base) {
      soma += Number(c) * peso
      peso = peso === 2 ? 9 : peso - 1
    }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

/** Dígitos verificadores do CPF. */
export function cpfValido(v: string) {
  const d = soDigitos(v)
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const dv = (n: number) => {
    let soma = 0
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/** Chave de acesso (44 dígitos) em grupos de 4: "3526 1100 ...". */
export function chaveBR(v: string | null | undefined) {
  const d = soDigitos(v)
  if (!d) return '—'
  return d.replace(/(\d{4})(?=\d)/g, '$1 ')
}
