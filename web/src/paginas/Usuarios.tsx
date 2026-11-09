import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { api, json, mensagemErro, useEu } from '../api'
import { useListaEmpresas } from '../empresa'
import { dataBR } from '../formato'
import { type EmpresaResumo, PAPEIS, type Papel, ROTULO_PAPEL, type Usuario } from '../tipos'
import { Campo } from '../ui/Campo'
import { Selo } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { MIN_SENHA } from './TrocarSenha'

/** Papéis que quem está logado pode atribuir: só admin cria ou promove para Administrador. */
export function papeisPermitidos(souAdmin: boolean) {
  return souAdmin ? PAPEIS : PAPEIS.filter((p) => p !== 'admin')
}

/** Escolha das empresas que o usuário enxerga: todas (null) ou uma lista. */
function EscolhaEmpresas({ valor, mudar, empresas }: {
  valor: number[] | null; mudar: (v: number[] | null) => void; empresas: EmpresaResumo[]
}) {
  const todas = valor === null
  return (
    <fieldset className="opcoes escolha-empresas">
      <legend>Empresas que enxerga</legend>
      <label className="opcao"><input type="checkbox" checked={todas} onChange={(e) => mudar(e.target.checked ? null : [])} />Todas</label>
      {!todas && empresas.map((e) => (
        <label key={e.id} className="opcao">
          <input type="checkbox" checked={valor.includes(e.id)}
            onChange={(ev) => mudar(ev.target.checked ? [...valor, e.id] : valor.filter((x) => x !== e.id))} />
          {e.nome_fantasia || e.razao_social}
        </label>
      ))}
    </fieldset>
  )
}

type Novo = { nome: string; email: string; papel: Papel; empresas: number[] | null; senha: string }
const VAZIO: Novo = { nome: '', email: '', papel: 'vendedor', empresas: [], senha: '' }

function FormNovo({ empresas, souAdmin }: { empresas: EmpresaResumo[]; souAdmin: boolean }) {
  const cliente = useQueryClient()
  const [f, setF] = useState<Novo>(VAZIO)
  const [erro, setErro] = useState('')
  const [criado, setCriado] = useState('')
  const criar = useMutation({
    mutationFn: (corpo: Novo) => api<Usuario>('/api/usuarios', json('POST', corpo)),
    onMutate: () => setCriado(''),
    onSuccess: (u) => {
      setCriado(`Usuário ${u.email} criado. Ele troca a senha provisória no primeiro acesso.`)
      setF(VAZIO)
      void cliente.invalidateQueries({ queryKey: ['usuarios'] })
    },
  })
  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!f.nome.trim() || !f.email.trim()) return setErro('Informe nome e e-mail')
    if (f.senha.length < MIN_SENHA) return setErro(`Senha provisória com pelo menos ${MIN_SENHA} caracteres`)
    if (f.empresas !== null && f.empresas.length === 0 && f.papel !== 'admin') return setErro('Escolha pelo menos uma empresa (ou Todas)')
    setErro('')
    criar.mutate({ ...f, nome: f.nome.trim(), email: f.email.trim() })
  }
  return (
    <form className="cartao formulario" aria-label="Novo usuário" onSubmit={enviar} noValidate>
      <h2>Novo usuário</h2>
      <div className="grade-campos">
        <Campo rotulo="Nome">
          {(p) => <input {...p} className="entrada" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />}
        </Campo>
        <Campo rotulo="E-mail">
          {(p) => <input {...p} className="entrada" type="email" autoComplete="off" value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })} />}
        </Campo>
        <Campo rotulo="Papel">
          {(p) => (
            <select {...p} className="entrada" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as Papel })}>
              {papeisPermitidos(souAdmin).map((x) => <option key={x} value={x}>{ROTULO_PAPEL[x]}</option>)}
            </select>
          )}
        </Campo>
        <Campo rotulo="Senha provisória" dica={`Pelo menos ${MIN_SENHA} caracteres`}>
          {(p) => <input {...p} className="entrada" type="password" autoComplete="new-password" value={f.senha}
            onChange={(e) => setF({ ...f, senha: e.target.value })} />}
        </Campo>
      </div>
      <EscolhaEmpresas valor={f.empresas} mudar={(v) => setF({ ...f, empresas: v })} empresas={empresas} />
      {erro && <p className="erro" role="alert">{erro}</p>}
      {criar.isError && <p className="erro" role="alert">{mensagemErro(criar.error)}</p>}
      {criado && <p className="ok" role="status">{criado}</p>}
      <button type="submit" className="botao" disabled={criar.isPending}>{criar.isPending ? 'Criando…' : 'Criar usuário'}</button>
    </form>
  )
}

function Edicao({ u, empresas, fechar, souAdmin }: { u: Usuario; empresas: EmpresaResumo[]; fechar: () => void; souAdmin: boolean }) {
  // A equipe só redefine a senha de um administrador; nada mais nele.
  const somenteSenha = !souAdmin && u.papel === 'admin'
  const cliente = useQueryClient()
  const [f, setF] = useState({ nome: u.nome, email: u.email, papel: u.papel, empresas: u.empresas, ativo: u.ativo, senha: '' })
  const [erro, setErro] = useState('')
  const salvar = useMutation({
    mutationFn: (corpo: unknown) => api<Usuario>(`/api/usuarios/${u.id}`, json('PUT', corpo)),
    onSuccess: () => { void cliente.invalidateQueries({ queryKey: ['usuarios'] }); fechar() },
  })
  function enviar(e: FormEvent) {
    e.preventDefault()
    if (f.senha && f.senha.length < MIN_SENHA) return setErro(`Senha provisória com pelo menos ${MIN_SENHA} caracteres`)
    if (somenteSenha) {
      if (!f.senha) return setErro('Digite a nova senha provisória')
      setErro('')
      return salvar.mutate({ senha: f.senha })
    }
    setErro('')
    const { senha, ...resto } = f
    salvar.mutate(senha ? { ...resto, senha } : resto)
  }
  return (
    <form className="cartao formulario" aria-label={`Editar ${u.nome}`} onSubmit={enviar} noValidate>
      <h2>Editar {u.nome}</h2>
      {somenteSenha && <p className="mudo">Este usuário é administrador: a equipe só pode redefinir a senha dele.</p>}
      <div className="grade-campos">
        {!somenteSenha && <>
        <Campo rotulo="Nome">{(p) => <input {...p} className="entrada" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />}</Campo>
        <Campo rotulo="E-mail">{(p) => <input {...p} className="entrada" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Campo>
        <Campo rotulo="Papel">
          {(p) => (
            <select {...p} className="entrada" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as Papel })}>
              {papeisPermitidos(souAdmin).map((x) => <option key={x} value={x}>{ROTULO_PAPEL[x]}</option>)}
            </select>
          )}
        </Campo>
        </>}
        <Campo rotulo="Redefinir senha" dica="Deixe vazio para manter. A nova senha é provisória.">
          {(p) => <input {...p} className="entrada" type="password" autoComplete="new-password" value={f.senha}
            onChange={(e) => setF({ ...f, senha: e.target.value })} />}
        </Campo>
      </div>
      {!somenteSenha && (
        <>
          <EscolhaEmpresas valor={f.empresas} mudar={(v) => setF({ ...f, empresas: v })} empresas={empresas} />
          <label className="opcao"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />Ativo</label>
        </>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
      <div className="acoes-form">
        <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="botao sec" onClick={fechar}>Cancelar</button>
      </div>
    </form>
  )
}

/** Configurações → Usuários (só admin: ação gerir_usuarios). */
export function PaginaUsuarios() {
  const { data: eu } = useEu()
  const souAdmin = eu?.papel === 'admin'
  const q = useQuery({ queryKey: ['usuarios'], queryFn: () => api<Usuario[]>('/api/usuarios') })
  const empresas = useListaEmpresas().data ?? []
  const [editando, setEditando] = useState<number | null>(null)
  const nomeEmpresas = (ids: number[] | null) => ids === null ? 'Todas'
    : ids.map((id) => { const e = empresas.find((x) => x.id === id); return e ? (e.nome_fantasia || e.razao_social) : `nº ${id}` }).join(', ') || 'Nenhuma'
  const alvo = q.data?.find((u) => u.id === editando)
  return (
    <section className="usuarios">
      <TituloPagina titulo="Usuários" migalhas={[{ rotulo: 'Configurações' }, { rotulo: 'Usuários' }]} />
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && (
        <div className="cartao rolagem">
          <table className="tabela" aria-label="Usuários">
            <thead>
              <tr><th scope="col">Nome</th><th scope="col">E-mail</th><th scope="col">Papel</th><th scope="col">Empresas</th>
                <th scope="col">Situação</th><th scope="col">Criado em</th><th scope="col">Ações</th></tr>
            </thead>
            <tbody>
              {q.data.map((u) => (
                <tr key={u.id} className={u.id === editando ? 'linha-ativa' : undefined}>
                  <td>{u.nome}</td>
                  <td>{u.email}</td>
                  <td>{ROTULO_PAPEL[u.papel] ?? u.papel}</td>
                  <td className="motivo">{nomeEmpresas(u.empresas)}</td>
                  <td>
                    {u.ativo ? <Selo texto="Ativo" tom="verde" /> : <Selo texto="Inativo" tom="cinza" />}{' '}
                    {u.trocar_senha && <Selo texto="Troca de senha pendente" tom="laranja" />}
                  </td>
                  <td className="mono">{dataBR(u.criado_em)}</td>
                  <td><button type="button" className="botao-texto" onClick={() => setEditando(u.id)}>
                    {!souAdmin && u.papel === 'admin' ? 'Redefinir senha' : 'Editar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="espaco-acima">
        {alvo ? <Edicao key={alvo.id} u={alvo} empresas={empresas} fechar={() => setEditando(null)} souAdmin={souAdmin} />
          : <FormNovo empresas={empresas} souAdmin={souAdmin} />}
      </div>
    </section>
  )
}
