import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, json, mensagemErro, pode, qs, rotaEmpresa, useEu } from '../api'
import { CamposEndereco, ENDERECO_VAZIO, type ErrosEndereco, type FormEndereco, corpoEndereco, enderecoDaReceita,
  useConsultaCnpj, validarEndereco } from '../componentes/Endereco'
import { cnpjValido, cpfValido, documentoBR, mascaraDocumento, soDigitos } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { IndIeDest, Pessoa, PessoaEntrada, TipoPessoa } from '../tipos'
import { Campo, Marcar } from '../ui/Campo'
import { Icone } from '../ui/Icone'
import { Selo } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { useAdiado } from './Produtos'

export const ROTULO_TIPO: Record<TipoPessoa, string> = { cliente: 'Cliente', fornecedor: 'Fornecedor', ambos: 'Cliente e fornecedor' }
export const ROTULO_IE: Record<IndIeDest, string> = {
  '1': 'Contribuinte do ICMS', '2': 'Contribuinte isento', '9': 'Não contribuinte',
}

export function usePessoas(eid: number, tipo = '', busca = '') {
  return useQuery({
    queryKey: ['pessoas', eid, tipo, busca],
    queryFn: () => api<Pessoa[]>(rotaEmpresa(eid, `pessoas${qs({ tipo, busca })}`)),
    placeholderData: keepPreviousData,
  })
}

function Lista({ eid }: { eid: number }) {
  const { data: eu } = useEu()
  const editar = pode(eu, 'editar_pessoas')
  const [tipo, setTipo] = useState('')
  const [busca, setBusca] = useState('')
  const termo = useAdiado(busca.trim())
  const q = usePessoas(eid, tipo, termo)
  return (
    <section className="pessoas">
      <TituloPagina titulo="Clientes e" destaque="fornecedores"
        acoes={editar && <Link to="/pessoas/novo" className="botao"><Icone nome="mais" />Novo cadastro</Link>} />
      <div className="ferramentas">
        <div className="busca" role="search">
          <input type="search" className="entrada" aria-label="Buscar por nome ou CPF/CNPJ" placeholder="Nome ou CPF/CNPJ"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <label className="campo-linha">Tipo
          <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option><option value="cliente">Clientes</option><option value="fornecedor">Fornecedores</option>
          </select>
        </label>
      </div>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhum cadastro encontrado</p>}
      {q.data && q.data.length > 0 && (
        <div className="cartao rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Nome</th><th scope="col">CPF/CNPJ</th><th scope="col">Tipo</th><th scope="col">ICMS</th>
                <th scope="col">Município</th><th scope="col">Contato</th><th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td>{editar ? <Link to={`/pessoas/${p.id}`}>{p.nome}</Link> : p.nome}
                    {p.nome_fantasia && <div className="mudo">{p.nome_fantasia}</div>}</td>
                  <td className="mono">{documentoBR(p.cpf_cnpj)}</td>
                  <td>{ROTULO_TIPO[p.tipo]}</td>
                  <td>{ROTULO_IE[p.ind_ie_dest]}{p.ie ? <div className="mudo mono">IE {p.ie}</div> : null}</td>
                  <td>{p.municipio}/{p.uf}</td>
                  <td>{p.email || p.fone || '—'}</td>
                  <td>{p.ativo ? <Selo texto="Ativo" tom="verde" /> : <Selo texto="Inativo" tom="cinza" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type FormPessoa = FormEndereco & {
  tipo: TipoPessoa; cpf_cnpj: string; nome: string; nome_fantasia: string; ind_ie_dest: IndIeDest; ie: string
  email: string; fone: string; ativo: boolean
}
type ErrosPessoa = ErrosEndereco & Partial<Record<'cpf_cnpj' | 'nome' | 'ie', string>>

function formDaPessoa(p?: Pessoa): FormPessoa {
  if (!p) {
    return { ...ENDERECO_VAZIO, tipo: 'cliente', cpf_cnpj: '', nome: '', nome_fantasia: '', ind_ie_dest: '9', ie: '',
      email: '', fone: '', ativo: true }
  }
  return {
    tipo: p.tipo, cpf_cnpj: mascaraDocumento(p.cpf_cnpj), nome: p.nome, nome_fantasia: p.nome_fantasia ?? '',
    ind_ie_dest: p.ind_ie_dest, ie: p.ie ?? '', email: p.email ?? '', fone: p.fone ?? '', ativo: p.ativo,
    logradouro: p.logradouro ?? '', numero: p.numero ?? '', complemento: p.complemento ?? '', bairro: p.bairro ?? '',
    cod_municipio: p.cod_municipio ?? '', municipio: p.municipio ?? '', uf: p.uf ?? '', cep: p.cep ?? '',
  }
}

export function validarPessoa(f: FormPessoa): ErrosPessoa {
  const e: ErrosPessoa = { ...validarEndereco(f) }
  const d = soDigitos(f.cpf_cnpj)
  if (!(d.length === 11 ? cpfValido(d) : cnpjValido(d))) e.cpf_cnpj = 'CPF ou CNPJ inválido'
  if (!f.nome.trim()) e.nome = 'Informe o nome'
  if (f.ind_ie_dest === '1' && !f.ie.trim()) e.ie = 'Contribuinte do ICMS precisa da inscrição estadual'
  if (f.ind_ie_dest === '1' && d.length === 11 && !f.ie.trim()) e.ie = 'Informe a IE (produtor rural)'
  return e
}

function Formulario({ eid, id }: { eid: number; id: number | null }) {
  const lista = usePessoas(eid)
  const existente = id != null ? lista.data?.find((p) => p.id === id) : undefined
  if (id != null && lista.isPending) return <p className="mudo" role="status">Carregando…</p>
  if (id != null && lista.isError) return <p className="erro" role="alert">{mensagemErro(lista.error)}</p>
  if (id != null && !existente) return <p className="erro" role="alert">Cadastro não encontrado nesta empresa.</p>
  return <FormPessoaEdicao eid={eid} id={id} inicial={formDaPessoa(existente)} />
}

function FormPessoaEdicao({ eid, id, inicial }: { eid: number; id: number | null; inicial: FormPessoa }) {
  const navegar = useNavigate()
  const cliente = useQueryClient()
  const receita = useConsultaCnpj()
  const [f, setF] = useState(inicial)
  const [erros, setErros] = useState<ErrosPessoa>({})
  const mudar = (k: keyof FormPessoa, v: string | boolean) => setF((a) => ({ ...a, [k]: v }))
  const m = (k: keyof FormPessoa) => (e: { target: { value: string } }) => mudar(k, e.target.value)

  const salvar = useMutation({
    mutationFn: (corpo: PessoaEntrada) => id == null
      ? api<Pessoa>(rotaEmpresa(eid, 'pessoas'), json('POST', corpo))
      : api<Pessoa>(rotaEmpresa(eid, `pessoas/${id}`), json('PUT', corpo)),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['pessoas', eid] })
      navegar('/pessoas')
    },
  })

  async function aoSairDoDocumento() {
    if (soDigitos(f.cpf_cnpj).length !== 14) return
    const d = await receita.consultar(f.cpf_cnpj)
    if (d) {
      setF((a) => ({
        ...a, ...enderecoDaReceita(d), nome: d.razao_social || a.nome, nome_fantasia: d.nome_fantasia || a.nome_fantasia,
        email: d.email || a.email, fone: d.fone || a.fone,
      }))
    }
  }

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    const v = validarPessoa(f)
    setErros(v)
    if (Object.keys(v).length) return
    salvar.mutate({
      ...corpoEndereco(f), tipo: f.tipo, cpf_cnpj: soDigitos(f.cpf_cnpj), nome: f.nome.trim(),
      nome_fantasia: f.nome_fantasia.trim() || undefined, ind_ie_dest: f.ind_ie_dest,
      ie: f.ind_ie_dest === '9' ? undefined : f.ie.trim() || undefined, email: f.email.trim() || undefined,
      fone: f.fone.trim() || undefined, ativo: f.ativo,
    })
  }

  return (
    <section className="pessoa-form">
      <TituloPagina titulo={id == null ? 'Novo' : 'Cadastro de'} destaque={id == null ? 'cadastro' : inicial.nome}
        migalhas={[{ rotulo: 'Clientes e fornecedores', para: '/pessoas' }, { rotulo: id == null ? 'Novo cadastro' : inicial.nome }]} />
      <form className="cartao formulario" onSubmit={enviar} noValidate>
        <fieldset className="grupo">
          <legend>Identificação</legend>
          <div className="grade-campos">
            <Campo rotulo="Tipo">
              {(p) => (
                <select {...p} className="entrada" value={f.tipo} onChange={m('tipo')}>
                  {(Object.keys(ROTULO_TIPO) as TipoPessoa[]).map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
                </select>
              )}
            </Campo>
            <Campo rotulo="CPF ou CNPJ" erro={erros.cpf_cnpj}
              dica={receita.consultando ? 'Consultando a Receita…' : receita.mensagem || 'Com CNPJ, os dados vêm da Receita ao sair do campo'}>
              {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={f.cpf_cnpj} onBlur={aoSairDoDocumento}
                onChange={(e) => mudar('cpf_cnpj', mascaraDocumento(e.target.value))} />}
            </Campo>
            <Campo rotulo="Nome / razão social" erro={erros.nome} largo>
              {(p) => <input {...p} className="entrada" value={f.nome} onChange={m('nome')} />}
            </Campo>
            <Campo rotulo="Nome fantasia">
              {(p) => <input {...p} className="entrada" value={f.nome_fantasia} onChange={m('nome_fantasia')} />}
            </Campo>
            <Campo rotulo="E-mail">
              {(p) => <input {...p} className="entrada" type="email" value={f.email} onChange={m('email')} />}
            </Campo>
            <Campo rotulo="Telefone">
              {(p) => <input {...p} className="entrada" type="tel" value={f.fone} onChange={m('fone')} />}
            </Campo>
            <div className="campo campo-caixa"><Marcar rotulo="Ativo" marcado={f.ativo} mudar={(v) => mudar('ativo', v)} /></div>
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>ICMS do destinatário</legend>
          <div className="opcoes" role="radiogroup" aria-label="Contribuinte do ICMS">
            {(Object.keys(ROTULO_IE) as IndIeDest[]).map((v) => (
              <label key={v} className="opcao">
                <input type="radio" name="ind_ie_dest" value={v} checked={f.ind_ie_dest === v} onChange={() => mudar('ind_ie_dest', v)} />
                {ROTULO_IE[v]}
              </label>
            ))}
          </div>
          {f.ind_ie_dest !== '9' && (
            <div className="grade-campos espaco-acima">
              <Campo rotulo="Inscrição estadual" erro={erros.ie} dica={f.ind_ie_dest === '2' ? 'Opcional para isento' : undefined}>
                {(p) => <input {...p} className="entrada mono" value={f.ie} onChange={m('ie')} />}
              </Campo>
            </div>
          )}
        </fieldset>
        <CamposEndereco valor={f} mudar={(k, v) => mudar(k, v)} erros={erros} />
        {Object.keys(erros).length > 0 && <p className="erro" role="alert">Confira os campos destacados.</p>}
        {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
        <div className="acoes-form">
          <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</button>
          <Link to="/pessoas" className="botao sec">Cancelar</Link>
        </div>
      </form>
    </section>
  )
}

export function PaginaPessoas() {
  return <ComEmpresa>{(eid) => <Lista key={eid} eid={eid} />}</ComEmpresa>
}

export function PaginaPessoa() {
  const { id } = useParams()
  const n = id && id !== 'novo' ? Number(id) : null
  return <ComEmpresa>{(eid) => <Formulario key={`${eid}-${id}`} eid={eid} id={n} />}</ComEmpresa>
}
