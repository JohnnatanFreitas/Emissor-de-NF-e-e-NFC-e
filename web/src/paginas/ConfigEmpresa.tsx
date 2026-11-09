import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, json, lerBase64, mensagemErro, pode, rotaEmpresa, useEu } from '../api'
import { CamposCertificado, CamposEmpresa, type ErrosEmp, corpoEmpresa, formDaEmpresa, validarEmpresa }
  from '../componentes/FormEmpresa'
import { useEmpresaDetalhe } from '../empresa'
import { cnpjBR, dataBR } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { Empresa, StatusSefaz } from '../tipos'
import { Campo } from '../ui/Campo'
import { Selo, SeloAmbiente, SeloCertificado } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'

export const FRASE_PRODUCAO = 'LIBERAR PRODUCAO'

/** PUT /api/empresas/:eid com o cache da empresa e da lista atualizados. */
function useAtualizarEmpresa(eid: number) {
  const cliente = useQueryClient()
  return (emp: Empresa) => {
    cliente.setQueryData(['empresa', eid], emp)
    void cliente.invalidateQueries({ queryKey: ['empresas'] })
  }
}

function BlocoSituacao({ emp }: { emp: Empresa }) {
  const status = useQuery({
    queryKey: ['sefaz', emp.id], enabled: false, retry: false,
    queryFn: () => api<StatusSefaz>(rotaEmpresa(emp.id, 'sefaz/status')),
  })
  const c = emp.certificado
  return (
    <section className="bloco" aria-labelledby="t-situacao">
      <h2 id="t-situacao">Situação</h2>
      <dl className="dados-cert">
        <div><dt>CNPJ</dt><dd className="mono">{cnpjBR(emp.cnpj)}</dd></div>
        <div><dt>Ambiente</dt><dd><SeloAmbiente ambiente={emp.ambiente} /></dd></div>
        <div><dt>Certificado</dt><dd><SeloCertificado validade={c?.validade} dias={c?.dias_restantes} /></dd></div>
        <div><dt>Titular do certificado</dt><dd>{c?.titular ?? '—'}</dd></div>
        <div><dt>Validade</dt><dd>{c ? `${dataBR(c.validade)} (${c.dias_restantes} dias)` : '—'}</dd></div>
        <div><dt>NFC-e (CSC)</dt><dd>{emp.tem_csc ? <Selo texto={`Cadastrado — ID ${emp.csc_id}`} tom="verde" />
          : <Selo texto="Não cadastrado" tom="laranja" />}</dd></div>
      </dl>
      <div className="acoes-form">
        <button type="button" className="botao sec" disabled={status.isFetching} onClick={() => void status.refetch()}>
          {status.isFetching ? 'Consultando…' : 'Consultar status da SEFAZ'}
        </button>
      </div>
      {status.isError && <p className="erro" role="alert">{mensagemErro(status.error)}</p>}
      {status.data && (
        <p className={status.data.cStat === '107' ? 'ok' : 'aviso'} role="status">
          SEFAZ (modelo {status.data.modelo}): <b className="mono">{status.data.cStat}</b> — {status.data.xMotivo}
        </p>
      )}
    </section>
  )
}

function BlocoDados({ emp }: { emp: Empresa }) {
  const atualizar = useAtualizarEmpresa(emp.id)
  const [f, setF] = useState(() => formDaEmpresa(emp))
  const [erros, setErros] = useState<ErrosEmp>({})
  const [ok, setOk] = useState(false)
  const salvar = useMutation({
    mutationFn: () => api<Empresa>(rotaEmpresa(emp.id), json('PUT', corpoEmpresa(f))),
    onMutate: () => setOk(false),
    onSuccess: (e) => { atualizar(e); setOk(true) },
  })
  function enviar(ev: FormEvent) {
    ev.preventDefault()
    const v = validarEmpresa(f)
    setErros(v)
    if (Object.keys(v).length === 0) salvar.mutate()
  }
  return (
    <section className="bloco" aria-labelledby="t-dados">
      <h2 id="t-dados">Dados da empresa</h2>
      <form onSubmit={enviar} noValidate>
        <CamposEmpresa f={f} setF={setF} erros={erros} cnpjTravado />
        {Object.keys(erros).length > 0 && <p className="erro" role="alert">Confira os campos destacados.</p>}
        {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
        {ok && <p className="ok" role="status">Dados salvos.</p>}
        <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar dados'}</button>
      </form>
    </section>
  )
}

function BlocoCertificado({ emp }: { emp: Empresa }) {
  const atualizar = useAtualizarEmpresa(emp.id)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState(false)
  const salvar = useMutation({
    mutationFn: async () => api<Empresa>(rotaEmpresa(emp.id), json('PUT', {
      certificado_base64: await lerBase64(arquivo!), certificado_senha: senha,
    })),
    onMutate: () => setOk(false),
    onSuccess: (e) => { atualizar(e); setOk(true); setArquivo(null); setSenha('') },
  })
  function enviar(ev: FormEvent) {
    ev.preventDefault()
    if (!arquivo) return setErro('Escolha o novo arquivo .pfx')
    if (!senha) return setErro('Digite a senha do certificado')
    setErro('')
    salvar.mutate()
  }
  return (
    <section className="bloco" aria-labelledby="t-cert">
      <h2 id="t-cert">Trocar certificado</h2>
      <p className="mudo">Use quando o certificado A1 for renovado. O arquivo vai cifrado para o servidor.</p>
      <form onSubmit={enviar} noValidate>
        <CamposCertificado arquivo={arquivo} setArquivo={setArquivo} senha={senha} setSenha={setSenha} erro={erro} obrigatorio />
        {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
        {ok && <p className="ok" role="status">Certificado trocado.</p>}
        <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Enviando…' : 'Trocar certificado'}</button>
      </form>
    </section>
  )
}

function BlocoCsc({ emp }: { emp: Empresa }) {
  const atualizar = useAtualizarEmpresa(emp.id)
  const [cscId, setCscId] = useState(emp.csc_id ?? '')
  const [csc, setCsc] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState(false)
  const salvar = useMutation({
    mutationFn: () => api<Empresa>(rotaEmpresa(emp.id), json('PUT', { csc_id: cscId.trim(), csc: csc.trim() })),
    onMutate: () => setOk(false),
    onSuccess: (e) => { atualizar(e); setOk(true); setCsc('') },
  })
  function enviar(ev: FormEvent) {
    ev.preventDefault()
    if (!cscId.trim()) return setErro('Informe o ID do CSC (ex.: 000001)')
    if (!csc.trim()) return setErro('Informe o código CSC')
    setErro('')
    salvar.mutate()
  }
  return (
    <section className="bloco" aria-labelledby="t-csc">
      <h2 id="t-csc">NFC-e (CSC)</h2>
      <p className="mudo">
        Código de Segurança do Contribuinte, gerado no portal da SEFAZ do estado. Em homologação, use o CSC de homologação.
        {emp.tem_csc && ' Já existe um CSC cadastrado; preencha só para trocar.'}
      </p>
      <form onSubmit={enviar} noValidate>
        <div className="grade-campos">
          <Campo rotulo="ID do CSC" erro={erro && !cscId.trim() ? erro : undefined}>
            {(p) => <input {...p} className="entrada mono" value={cscId} placeholder="000001" onChange={(e) => setCscId(e.target.value)} />}
          </Campo>
          <Campo rotulo="Código CSC" largo erro={erro && cscId.trim() ? erro : undefined}>
            {(p) => <input {...p} className="entrada mono" type="password" autoComplete="off" value={csc}
              onChange={(e) => setCsc(e.target.value)} />}
          </Campo>
        </div>
        {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
        {ok && <p className="ok" role="status">CSC salvo. A venda balcão (NFC-e) já pode ser usada.</p>}
        <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar CSC'}</button>
      </form>
    </section>
  )
}

function BlocoAmbiente({ emp }: { emp: Empresa }) {
  const { data: eu } = useEu()
  const atualizar = useAtualizarEmpresa(emp.id)
  const [confirmando, setConfirmando] = useState(false)
  const [frase, setFrase] = useState('')
  const producao = useMutation({
    mutationFn: () => api<Empresa>(rotaEmpresa(emp.id, 'producao'), json('POST', { confirmacao: frase.trim() })),
    onSuccess: (e) => { atualizar(e); setConfirmando(false); setFrase('') },
  })
  const homologacao = useMutation({
    mutationFn: () => api<Empresa>(rotaEmpresa(emp.id, 'homologacao'), json('POST')),
    onSuccess: (e) => { atualizar(e); setConfirmando(false) },
  })
  const erro = producao.error ?? homologacao.error

  return (
    <section className="bloco" aria-labelledby="t-amb">
      <h2 id="t-amb">Ambiente de emissão</h2>
      {emp.ambiente === 2 ? (
        <>
          <p>A empresa está em <b>homologação</b>: as notas vão para o ambiente de testes da SEFAZ e não têm valor fiscal.</p>
          {!pode(eu, 'liberar_producao') ? (
            <p className="mudo">Só um administrador pode liberar a emissão em produção.</p>
          ) : !confirmando ? (
            <button type="button" className="botao perigo" onClick={() => setConfirmando(true)}>Liberar produção</button>
          ) : (
            <div className="confirmacao" role="group" aria-label="Confirmar liberação de produção">
              <p>
                Em produção, cada nota autorizada vale como documento fiscal. Confira os perfis fiscais, a numeração e o
                certificado antes. Para confirmar, digite <b className="mono">{FRASE_PRODUCAO}</b>.
              </p>
              <input className="entrada mono" aria-label={`Digite ${FRASE_PRODUCAO}`} value={frase} autoFocus
                onChange={(e) => setFrase(e.target.value)} />
              <div className="acoes-form">
                <button type="button" className="botao perigo" disabled={frase.trim() !== FRASE_PRODUCAO || producao.isPending}
                  onClick={() => producao.mutate()}>{producao.isPending ? 'Liberando…' : 'Confirmar produção'}</button>
                <button type="button" className="botao sec" onClick={() => { setConfirmando(false); setFrase('') }}>Cancelar</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p>A empresa está em <b>produção</b>: as notas autorizadas têm valor fiscal.</p>
          {!confirmando ? (
            <button type="button" className="botao sec" onClick={() => setConfirmando(true)}>Voltar para homologação</button>
          ) : (
            <div className="confirmacao" role="group" aria-label="Confirmar volta para homologação">
              <p>As próximas notas irão para o ambiente de testes, sem valor fiscal. Confirma?</p>
              <button type="button" className="botao perigo" disabled={homologacao.isPending}
                onClick={() => homologacao.mutate()}>{homologacao.isPending ? 'Voltando…' : 'Voltar para homologação'}</button>
              <button type="button" className="botao sec" onClick={() => setConfirmando(false)}>Cancelar</button>
            </div>
          )}
        </>
      )}
      {erro && <p className="erro" role="alert">{mensagemErro(erro)}</p>}
    </section>
  )
}

function Conteudo({ eid }: { eid: number }) {
  const q = useEmpresaDetalhe(eid)
  const { state } = useLocation()
  const criada = (state as { criada?: boolean } | null)?.criada
  return (
    <section className="config-empresa">
      <TituloPagina titulo="Configurações da" destaque="empresa" migalhas={[{ rotulo: 'Configurações' }, { rotulo: 'Empresa' }]}
        apoio={q.data ? `${q.data.razao_social} — ${cnpjBR(q.data.cnpj)}` : undefined} />
      {criada && <p className="ok" role="status">Empresa cadastrada em homologação, com 3 perfis fiscais padrão.</p>}
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && (
        <div className="blocos">
          <BlocoSituacao emp={q.data} />
          <BlocoDados key={`d-${q.data.id}`} emp={q.data} />
          <BlocoCertificado emp={q.data} />
          <BlocoCsc key={`c-${q.data.id}`} emp={q.data} />
          <BlocoAmbiente emp={q.data} />
        </div>
      )}
    </section>
  )
}

export function PaginaConfigEmpresa() {
  return <ComEmpresa>{(eid) => <Conteudo key={eid} eid={eid} />}</ComEmpresa>
}
