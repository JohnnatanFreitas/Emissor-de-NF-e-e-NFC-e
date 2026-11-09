import { cnpjValido, mascaraDocumento, soDigitos } from '../formato'
import { type Crt, type DadosReceita, type Empresa, type EmpresaEntrada, ROTULO_CRT } from '../tipos'
import { Campo } from '../ui/Campo'
import { CamposEndereco, ENDERECO_VAZIO, type ErrosEndereco, type FormEndereco, corpoEndereco, enderecoDaReceita,
  useConsultaCnpj, validarEndereco } from './Endereco'

export type FormEmp = FormEndereco & {
  cnpj: string; razao_social: string; nome_fantasia: string; ie: string; im: string; crt: Crt | ''; cnae: string
  fone: string; email: string
  serie_nfe: string; proximo_nfe: string; serie_nfce: string; proximo_nfce: string
}
export type ErrosEmp = ErrosEndereco & Partial<Record<'cnpj' | 'razao_social' | 'ie' | 'crt' | 'serie_nfe' | 'proximo_nfe'
  | 'serie_nfce' | 'proximo_nfce', string>>

export function formEmpresaVazio(): FormEmp {
  return {
    ...ENDERECO_VAZIO, cnpj: '', razao_social: '', nome_fantasia: '', ie: '', im: '', crt: '', cnae: '', fone: '',
    email: '', serie_nfe: '1', proximo_nfe: '1', serie_nfce: '1', proximo_nfce: '1',
  }
}

export function formDaEmpresa(e: Empresa): FormEmp {
  return {
    cnpj: mascaraDocumento(e.cnpj), razao_social: e.razao_social ?? '', nome_fantasia: e.nome_fantasia ?? '',
    ie: e.ie ?? '', im: e.im ?? '', crt: e.crt, cnae: e.cnae ?? '', fone: e.fone ?? '', email: e.email ?? '',
    logradouro: e.logradouro ?? '', numero: e.numero ?? '', complemento: e.complemento ?? '', bairro: e.bairro ?? '',
    cod_municipio: e.cod_municipio ?? '', municipio: e.municipio ?? '', uf: e.uf ?? '', cep: e.cep ?? '',
    serie_nfe: String(e.serie_nfe), proximo_nfe: String(e.proximo_nfe), serie_nfce: String(e.serie_nfce),
    proximo_nfce: String(e.proximo_nfce),
  }
}

const inteiroPositivo = (v: string, min = 1) => /^\d+$/.test(v.trim()) && Number(v) >= min

export function validarEmpresa(f: FormEmp): ErrosEmp {
  const e: ErrosEmp = { ...validarEndereco(f) }
  if (!cnpjValido(f.cnpj)) e.cnpj = 'CNPJ inválido'
  if (!f.razao_social.trim()) e.razao_social = 'Informe a razão social'
  if (!f.ie.trim()) e.ie = 'Informe a inscrição estadual'
  if (!f.crt) e.crt = 'Escolha o regime'
  if (!inteiroPositivo(f.serie_nfe, 0)) e.serie_nfe = 'Série inválida'
  if (!inteiroPositivo(f.proximo_nfe)) e.proximo_nfe = 'Número inválido'
  if (!inteiroPositivo(f.serie_nfce, 0)) e.serie_nfce = 'Série inválida'
  if (!inteiroPositivo(f.proximo_nfce)) e.proximo_nfce = 'Número inválido'
  return e
}

export function corpoEmpresa(f: FormEmp): EmpresaEntrada {
  return {
    ...corpoEndereco(f), cnpj: soDigitos(f.cnpj), razao_social: f.razao_social.trim(),
    nome_fantasia: f.nome_fantasia.trim(), ie: f.ie.trim(), im: f.im.trim() || undefined, crt: f.crt as Crt,
    cnae: soDigitos(f.cnae) || undefined, fone: f.fone.trim() || undefined, email: f.email.trim() || undefined,
    serie_nfe: Number(f.serie_nfe), proximo_nfe: Number(f.proximo_nfe), serie_nfce: Number(f.serie_nfce),
    proximo_nfce: Number(f.proximo_nfce),
  }
}

function preencherDaReceita(f: FormEmp, d: DadosReceita): FormEmp {
  return {
    ...f, ...enderecoDaReceita(d), razao_social: d.razao_social || f.razao_social,
    nome_fantasia: d.nome_fantasia || f.nome_fantasia, crt: d.crt_sugerido || f.crt, cnae: d.cnae || f.cnae,
    fone: d.fone || f.fone, email: d.email || f.email,
  }
}

/** Campos da empresa (cadastro e Configurações → Empresa). O CNPJ consulta a Receita ao sair do campo. */
export function CamposEmpresa({ f, setF, erros, cnpjTravado }: {
  f: FormEmp; setF: (fn: (a: FormEmp) => FormEmp) => void; erros: ErrosEmp; cnpjTravado?: boolean
}) {
  const receita = useConsultaCnpj()
  const mudar = (k: keyof FormEmp, v: string) => setF((a) => ({ ...a, [k]: v }))
  const m = (k: keyof FormEmp) => (e: { target: { value: string } }) => mudar(k, e.target.value)

  async function aoSairDoCnpj() {
    if (cnpjTravado) return
    const d = await receita.consultar(f.cnpj)
    if (d) setF((a) => preencherDaReceita(a, d))
  }

  return (
    <>
      <fieldset className="grupo">
        <legend>Identificação</legend>
        <div className="grade-campos">
          <Campo rotulo="CNPJ" erro={erros.cnpj}
            dica={receita.consultando ? 'Consultando a Receita…' : receita.mensagem || (cnpjTravado ? undefined : 'Saia do campo para buscar os dados na Receita')}>
            {(p) => (
              <input {...p} className="entrada mono" inputMode="numeric" autoComplete="off" value={f.cnpj}
                placeholder="00.000.000/0000-00" readOnly={cnpjTravado} onBlur={aoSairDoCnpj}
                onChange={(e) => mudar('cnpj', mascaraDocumento(e.target.value))} />
            )}
          </Campo>
          <Campo rotulo="Razão social" erro={erros.razao_social} largo>
            {(p) => <input {...p} className="entrada" value={f.razao_social} onChange={m('razao_social')} />}
          </Campo>
          <Campo rotulo="Nome fantasia">
            {(p) => <input {...p} className="entrada" value={f.nome_fantasia} onChange={m('nome_fantasia')} />}
          </Campo>
          <Campo rotulo="Inscrição estadual" erro={erros.ie}>
            {(p) => <input {...p} className="entrada mono" value={f.ie} onChange={m('ie')} />}
          </Campo>
          <Campo rotulo="Inscrição municipal">
            {(p) => <input {...p} className="entrada mono" value={f.im} onChange={m('im')} />}
          </Campo>
          <Campo rotulo="Regime (CRT)" erro={erros.crt}>
            {(p) => (
              <select {...p} className="entrada" value={f.crt} onChange={m('crt')}>
                <option value="">Selecione</option>
                {(Object.keys(ROTULO_CRT) as Crt[]).map((c) => <option key={c} value={c}>{c} — {ROTULO_CRT[c]}</option>)}
              </select>
            )}
          </Campo>
          <Campo rotulo="CNAE">
            {(p) => <input {...p} className="entrada mono" value={f.cnae} onChange={m('cnae')} />}
          </Campo>
          <Campo rotulo="Telefone">
            {(p) => <input {...p} className="entrada" type="tel" value={f.fone} onChange={m('fone')} />}
          </Campo>
          <Campo rotulo="E-mail">
            {(p) => <input {...p} className="entrada" type="email" value={f.email} onChange={m('email')} />}
          </Campo>
        </div>
      </fieldset>
      <CamposEndereco valor={f} mudar={(k, v) => mudar(k, v)} erros={erros} />
      <fieldset className="grupo">
        <legend>Numeração</legend>
        <div className="grade-campos">
          <Campo rotulo="Série da NF-e" erro={erros.serie_nfe}>
            {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={f.serie_nfe} onChange={m('serie_nfe')} />}
          </Campo>
          <Campo rotulo="Próximo número da NF-e" erro={erros.proximo_nfe}>
            {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={f.proximo_nfe} onChange={m('proximo_nfe')} />}
          </Campo>
          <Campo rotulo="Série da NFC-e" erro={erros.serie_nfce}>
            {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={f.serie_nfce} onChange={m('serie_nfce')} />}
          </Campo>
          <Campo rotulo="Próximo número da NFC-e" erro={erros.proximo_nfce}>
            {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={f.proximo_nfce} onChange={m('proximo_nfce')} />}
          </Campo>
        </div>
      </fieldset>
    </>
  )
}

/** Arquivo .pfx e senha do certificado A1. */
export function CamposCertificado({ arquivo, setArquivo, senha, setSenha, erro, obrigatorio }: {
  arquivo: File | null; setArquivo: (f: File | null) => void; senha: string; setSenha: (s: string) => void
  erro?: string; obrigatorio?: boolean
}) {
  return (
    <div className="grade-campos">
      <Campo rotulo={`Certificado A1 (.pfx)${obrigatorio ? '' : ' — opcional'}`} erro={erro} largo
        dica={arquivo ? `${arquivo.name} (${Math.ceil(arquivo.size / 1024)} KB)` : 'Arquivo .pfx ou .p12'}>
        {(p) => <input {...p} className="entrada" type="file" accept=".pfx,.p12,application/x-pkcs12"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />}
      </Campo>
      <Campo rotulo="Senha do certificado">
        {(p) => <input {...p} className="entrada" type="password" autoComplete="new-password" value={senha}
          onChange={(e) => setSenha(e.target.value)} />}
      </Campo>
    </div>
  )
}
