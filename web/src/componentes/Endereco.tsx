import { useState } from 'react'
import { ErroApi, api } from '../api'
import { soDigitos } from '../formato'
import type { DadosReceita } from '../tipos'
import { Campo, SelectUF } from '../ui/Campo'

export type FormEndereco = {
  logradouro: string; numero: string; complemento: string; bairro: string; cod_municipio: string; municipio: string
  uf: string; cep: string
}
export const ENDERECO_VAZIO: FormEndereco = {
  logradouro: '', numero: '', complemento: '', bairro: '', cod_municipio: '', municipio: '', uf: '', cep: '',
}
export type ErrosEndereco = Partial<Record<keyof FormEndereco, string>>

export function validarEndereco(f: FormEndereco): ErrosEndereco {
  const e: ErrosEndereco = {}
  if (!f.logradouro.trim()) e.logradouro = 'Informe o logradouro'
  if (!f.numero.trim()) e.numero = 'Informe o número (ou SN)'
  if (!f.bairro.trim()) e.bairro = 'Informe o bairro'
  if (!/^\d{7}$/.test(soDigitos(f.cod_municipio))) e.cod_municipio = 'Código IBGE com 7 dígitos'
  if (!f.municipio.trim()) e.municipio = 'Informe o município'
  if (!f.uf) e.uf = 'Informe a UF'
  if (!/^\d{8}$/.test(soDigitos(f.cep))) e.cep = 'CEP com 8 dígitos'
  return e
}

export function corpoEndereco(f: FormEndereco) {
  return {
    logradouro: f.logradouro.trim(), numero: f.numero.trim(), complemento: f.complemento.trim() || undefined,
    bairro: f.bairro.trim(), cod_municipio: soDigitos(f.cod_municipio), municipio: f.municipio.trim(), uf: f.uf,
    cep: soDigitos(f.cep),
  }
}

export function enderecoDaReceita(d: DadosReceita): FormEndereco {
  return {
    logradouro: d.logradouro ?? '', numero: d.numero ?? '', complemento: d.complemento ?? '', bairro: d.bairro ?? '',
    cod_municipio: d.cod_municipio ?? '', municipio: d.municipio ?? '', uf: d.uf ?? '', cep: soDigitos(d.cep),
  }
}

/** Campos de endereço (empresa e pessoa), com o código IBGE do município. */
export function CamposEndereco({ valor, mudar, erros = {} }: {
  valor: FormEndereco; mudar: (k: keyof FormEndereco, v: string) => void; erros?: ErrosEndereco
}) {
  const m = (k: keyof FormEndereco) => (e: { target: { value: string } }) => mudar(k, e.target.value)
  return (
    <fieldset className="grupo">
      <legend>Endereço</legend>
      <div className="grade-campos">
        <Campo rotulo="CEP" erro={erros.cep}>
          {(p) => <input {...p} className="entrada mono" inputMode="numeric" maxLength={9} value={valor.cep} onChange={m('cep')} />}
        </Campo>
        <Campo rotulo="Logradouro" erro={erros.logradouro} largo>
          {(p) => <input {...p} className="entrada" value={valor.logradouro} onChange={m('logradouro')} />}
        </Campo>
        <Campo rotulo="Número" erro={erros.numero}>
          {(p) => <input {...p} className="entrada" value={valor.numero} onChange={m('numero')} />}
        </Campo>
        <Campo rotulo="Complemento">
          {(p) => <input {...p} className="entrada" value={valor.complemento} onChange={m('complemento')} />}
        </Campo>
        <Campo rotulo="Bairro" erro={erros.bairro}>
          {(p) => <input {...p} className="entrada" value={valor.bairro} onChange={m('bairro')} />}
        </Campo>
        <Campo rotulo="Município" erro={erros.municipio}>
          {(p) => <input {...p} className="entrada" value={valor.municipio} onChange={m('municipio')} />}
        </Campo>
        <Campo rotulo="Código IBGE do município" erro={erros.cod_municipio} dica="7 dígitos">
          {(p) => <input {...p} className="entrada mono" inputMode="numeric" maxLength={7} value={valor.cod_municipio}
            onChange={m('cod_municipio')} />}
        </Campo>
        <Campo rotulo="UF" erro={erros.uf}>
          {(p) => <SelectUF {...p} valor={valor.uf} mudar={(v) => mudar('uf', v)} />}
        </Campo>
      </div>
    </fieldset>
  )
}

/** Consulta `GET /api/cnpj/:cnpj` (Receita via BrasilAPI). Devolve os dados ou null, com a mensagem para a tela. */
export function useConsultaCnpj() {
  const [consultando, setConsultando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [ultimo, setUltimo] = useState('')
  async function consultar(cnpj: string): Promise<DadosReceita | null> {
    const d = soDigitos(cnpj)
    if (d.length !== 14 || d === ultimo) return null
    setUltimo(d)
    setConsultando(true)
    setMensagem('')
    try {
      const r = await api<DadosReceita>(`/api/cnpj/${d}`)
      setMensagem(r.situacao && r.situacao.toUpperCase() !== 'ATIVA'
        ? `Dados da Receita preenchidos. Atenção: situação cadastral ${r.situacao}.`
        : 'Dados da Receita preenchidos. Confira antes de salvar.')
      return r
    } catch (e) {
      setMensagem(e instanceof ErroApi && e.status === 404 ? 'CNPJ não encontrado na Receita. Preencha os dados à mão.'
        : `Não foi possível consultar a Receita: ${e instanceof Error ? e.message : 'erro'}`)
      return null
    } finally {
      setConsultando(false)
    }
  }
  return { consultar, consultando, mensagem }
}
