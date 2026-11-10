import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, json, mensagemErro, pode, qs, rotaEmpresa, useEu } from '../api'
import { BuscaCliente } from '../componentes/Busca'
import { brl, chaveBR, dataBR, dataHoraBR, documentoBR, hojeISO, pct, somarDias } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import { type ErrosServico, type FormNfse, type FormServico, corpoServico, formDoCatalogo, formDoServico, montarPedidoNfse,
  validarNfse, validarServico } from '../nfse'
import type { CalculoNfse, ConfigNfse, ItemCatalogoNfse, Nfse, Pessoa, Servico, StatusNfse } from '../tipos'
import { Campo, Marcar } from '../ui/Campo'
import { Icone } from '../ui/Icone'
import { STATUS_NFSE, Selo, SeloNfse } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { AcaoTexto } from './Notas'
import { useAdiado } from './Produtos'

const MIGALHA = { rotulo: 'NFS-e (serviços)', para: '/nfse' }
const ROTULO_REGIME = { simples: 'Simples Nacional', mei: 'MEI', normal: 'Regime normal' } as const

export function useConfigNfse(eid: number) {
  return useQuery({ queryKey: ['nfse-config', eid], queryFn: () => api<ConfigNfse>(rotaEmpresa(eid, 'nfse/config')) })
}
export function useServicos(eid: number) {
  return useQuery({ queryKey: ['nfse-servicos', eid], queryFn: () => api<Servico[]>(rotaEmpresa(eid, 'nfse/servicos')) })
}

/** Faixa de aviso: emissão simulada (sem valor fiscal) e/ou ambiente de produção restrita. */
export function FaixaNfse({ eid }: { eid: number }) {
  const cfg = useConfigNfse(eid)
  if (!cfg.data) return null
  const simulado = cfg.data.modo === 'simulado'
  const restrita = cfg.data.ambiente === 2
  if (!simulado && !restrita) return null
  return (
    <div className="faixa-nfse" role="status">
      <Icone nome="alerta" />
      <span>
        {simulado && <><b>Emissão SIMULADA:</b> as NFS-e não são enviadas ao Portal Nacional e não têm valor fiscal. </>}
        {restrita && <><b>Produção restrita</b> (ambiente 2 do Portal Nacional): ambiente de testes, sem valor fiscal.</>}
      </span>
    </div>
  )
}

const numeroNfse = (n: Nfse) => (n.numero_nfse != null && n.numero_nfse !== '' ? String(n.numero_nfse) : null)

/* ---------------- lista ---------------- */

function Lista({ eid }: { eid: number }) {
  const { data: eu } = useEu()
  const [status, setStatus] = useState('')
  const [de, setDe] = useState(somarDias(hojeISO(), -30))
  const [ate, setAte] = useState(hojeISO())
  const q = useQuery({
    queryKey: ['nfse', eid, status, de, ate],
    queryFn: () => api<Nfse[]>(rotaEmpresa(eid, `nfse${qs({ de, ate, status })}`)),
    placeholderData: keepPreviousData,
  })
  const total = (q.data ?? []).filter((n) => n.status === 'autorizada').reduce((s, n) => s + n.valor_cent, 0)
  return (
    <section className="nfse">
      <TituloPagina titulo="Notas de" destaque="serviço" apoio="NFS-e no padrão nacional emitidas pela empresa selecionada"
        acoes={pode(eu, 'emitir') && <Link to="/nfse/nova" className="botao"><Icone nome="mais" />Emitir NFS-e</Link>} />
      <FaixaNfse eid={eid} />
      <div className="ferramentas">
        <label className="campo-linha">Situação
          <select className="entrada" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            {(Object.keys(STATUS_NFSE) as StatusNfse[]).map((s) => <option key={s} value={s}>{STATUS_NFSE[s].texto}</option>)}
          </select>
        </label>
        <span className="datas">
          <label>De <input type="date" className="entrada" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label>até <input type="date" className="entrada" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        </span>
      </div>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhuma NFS-e no período</p>}
      {q.data && q.data.length > 0 && (
        <>
          <div className="cartao rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">NFS-e</th><th scope="col">DPS</th><th scope="col">Competência</th><th scope="col">Emissão</th>
                  <th scope="col">Tomador</th><th scope="col" className="num">Valor</th><th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((n) => (
                  <tr key={n.id}>
                    <td className="mono"><Link to={`/nfse/${n.id}`}>{numeroNfse(n) ?? 'sem número'}</Link></td>
                    <td className="mono">{n.serie_dps}-{n.numero_dps}</td>
                    <td className="mono">{dataBR(n.competencia)}</td>
                    <td className="mono">{dataHoraBR(n.emitida_em)}</td>
                    <td>{n.tomador_nome}</td>
                    <td className="num">{brl(n.valor_cent)}</td>
                    <td><span className="acoes-linha"><SeloNfse status={n.status} motivo={n.mensagem} />
                      {n.modo === 'simulado' && <Selo texto="Simulada" tom="laranja" titulo="Sem valor fiscal" />}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mudo dica">{q.data.length} NFS-e · autorizadas somam {brl(total)}</p>
        </>
      )}
    </section>
  )
}

/* ---------------- quadro de valores (cálculo e detalhe) ---------------- */

function QuadroNfse({ calc, carregando, erro, aviso, titulo = 'Cálculo' }: {
  calc?: CalculoNfse | null; carregando?: boolean; erro?: string; aviso?: string; titulo?: string
}) {
  const ret: [keyof CalculoNfse, string][] = [
    ['irrf_cent', 'IRRF'], ['pis_cent', 'PIS'], ['cofins_cent', 'COFINS'], ['csll_cent', 'CSLL'], ['inss_cent', 'INSS'],
  ]
  return (
    <section className="cartao resumo" aria-labelledby="t-calc-nfse" aria-busy={carregando || undefined}>
      <h2 id="t-calc-nfse">{titulo}</h2>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {!calc && !erro && <p className="mudo">{carregando ? 'Calculando…' : aviso ?? 'Escolha serviço, tomador e valor.'}</p>}
      {calc && (
        <>
          <dl className={`resumo-linhas${carregando ? ' recalculando' : ''}`}>
            <div><dt>Valor do serviço</dt><dd className="mono">{brl(calc.valor_servico_cent)}</dd></div>
            {calc.deducoes_cent > 0 && <div><dt>Deduções</dt><dd className="mono">{brl(calc.deducoes_cent)}</dd></div>}
            {calc.desconto_incond_cent > 0 && <div><dt>Desconto incondicionado</dt><dd className="mono">{brl(calc.desconto_incond_cent)}</dd></div>}
            <div className="resumo-base"><dt>Base de cálculo</dt><dd className="mono">{brl(calc.base_calculo_cent)}</dd></div>
            <div><dt>ISS ({pct(calc.aliq_iss)}){calc.iss_retido ? ' retido' : ''}</dt><dd className="mono">{brl(calc.iss_cent)}</dd></div>
            {ret.map(([k, r]) => (
              <div key={k}><dt>{r} retido</dt><dd className="mono">{brl(calc[k] as number)}</dd></div>
            ))}
            <div><dt>Total de retenções</dt><dd className="mono">{brl(calc.retencoes_cent)}</dd></div>
            <div className="resumo-total"><dt>Valor líquido</dt><dd className="mono">{brl(calc.liquido_cent)}</dd></div>
          </dl>
          <h3 className="titulo-lista espaco-acima">IBS e CBS (informativos)</h3>
          <dl className="resumo-linhas informativo">
            <div><dt>CBS ({pct(calc.aliq_cbs)})</dt><dd className="mono">{brl(calc.cbs_cent)}</dd></div>
            <div><dt>IBS estadual ({pct(calc.aliq_ibs_uf)})</dt><dd className="mono">{brl(calc.ibs_uf_cent)}</dd></div>
            <div><dt>IBS municipal ({pct(calc.aliq_ibs_mun)})</dt><dd className="mono">{brl(calc.ibs_mun_cent)}</dd></div>
          </dl>
          {calc.regras?.fase && <p className="mudo dica">{calc.regras.ano}: {calc.regras.fase}</p>}
        </>
      )}
    </section>
  )
}

/* ---------------- emitir ---------------- */

function Emitir({ eid }: { eid: number }) {
  const navegar = useNavigate()
  const cliente = useQueryClient()
  const servicos = useServicos(eid)
  const cfg = useConfigNfse(eid)
  const [tomador, setTomador] = useState<Pessoa | null>(null)
  const [f, setF] = useState<FormNfse>({
    servico_id: '', tomador_id: null, valor: '', deducoes: '', desconto: '', competencia: hojeISO(),
    iss_retido: true, reter_inss: false, descricao: '',
  })
  const [erros, setErros] = useState<string[]>([])
  const ativos = (servicos.data ?? []).filter((s) => s.ativo)
  const m = (k: keyof FormNfse) => (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value }))

  function escolherServico(id: string) {
    const s = ativos.find((x) => String(x.id) === id)
    setF((a) => ({ ...a, servico_id: id, iss_retido: s ? s.iss_retido : a.iss_retido,
      descricao: a.descricao.trim() ? a.descricao : s?.descricao ?? '' }))
  }

  const pedido = useMemo(() => montarPedidoNfse(f), [f])
  const adiado = useAdiado(pedido, 400)
  const calculo = useQuery({
    queryKey: ['nfse-calculo', eid, adiado], enabled: adiado != null,
    queryFn: () => api<CalculoNfse>(rotaEmpresa(eid, 'nfse/calculo'), json('POST', adiado)),
    placeholderData: keepPreviousData, retry: false,
  })

  const emitir = useMutation({
    mutationFn: (corpo: unknown) => api<Nfse>(rotaEmpresa(eid, 'nfse'), json('POST', corpo)),
    onSuccess: (n) => {
      void cliente.invalidateQueries({ queryKey: ['nfse', eid] })
      void cliente.invalidateQueries({ queryKey: ['nfse-config', eid] })
      navegar(`/nfse/${n.id}`, { state: { emitida: true } })
    },
  })

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    const v = validarNfse(f, hojeISO())
    setErros(v)
    const p = montarPedidoNfse(f)
    if (v.length === 0 && p) emitir.mutate({ ...p, descricao: f.descricao.trim() })
  }

  const n = f.descricao.trim().length
  return (
    <section className="nfse-nova">
      <TituloPagina titulo="Emitir" destaque="NFS-e" migalhas={[MIGALHA, { rotulo: 'Emitir NFS-e' }]}
        apoio={cfg.data ? `${ROTULO_REGIME[cfg.data.regime]} · DPS série ${cfg.data.serie_dps}, próximo número ${cfg.data.proximo_dps}` : undefined} />
      <FaixaNfse eid={eid} />
      {servicos.isSuccess && ativos.length === 0 && (
        <p className="erro" role="alert">Nenhum serviço ativo cadastrado. <Link to="/nfse/servicos">Cadastre um serviço</Link> antes de emitir.</p>
      )}
      <form className="pedido-grade" onSubmit={enviar} noValidate>
        <div className="pedido-principal">
          <section className="cartao" aria-labelledby="t-serv">
            <h2 id="t-serv">Serviço e tomador</h2>
            <div className="grade-campos">
              <Campo rotulo="Serviço prestado" largo erro={servicos.isError ? mensagemErro(servicos.error) : undefined}>
                {(p) => (
                  <select {...p} className="entrada" value={f.servico_id} onChange={(e) => escolherServico(e.target.value)}>
                    <option value="">Selecione</option>
                    {ativos.map((s) => (
                      <option key={s.id} value={String(s.id)}>{s.cod_trib_nac} · {s.descricao} (ISS {pct(Number(s.aliq_iss))})</option>
                    ))}
                  </select>
                )}
              </Campo>
            </div>
            <h3 className="titulo-lista espaco-acima">Tomador</h3>
            {tomador ? (
              <p className="cliente-escolhido">
                <b>{tomador.nome}</b><span className="mudo mono"> · {documentoBR(tomador.cpf_cnpj)} · {tomador.municipio}/{tomador.uf}</span>
                <button type="button" className="botao-texto" onClick={() => { setTomador(null); setF((a) => ({ ...a, tomador_id: null })) }}>
                  Trocar</button>
              </p>
            ) : (
              <BuscaCliente eid={eid} rotulo="Buscar tomador" aoEscolher={(p) => { setTomador(p); setF((a) => ({ ...a, tomador_id: p.id })) }} />
            )}
          </section>

          <section className="cartao" aria-labelledby="t-vals">
            <h2 id="t-vals">Valores</h2>
            <div className="grade-campos">
              <Campo rotulo="Valor do serviço (R$)">
                {(p) => <input {...p} className="entrada mono" inputMode="decimal" placeholder="0,00" value={f.valor} onChange={m('valor')} />}
              </Campo>
              <Campo rotulo="Deduções (R$)" dica="Materiais e subempreitadas, quando a lei permite">
                {(p) => <input {...p} className="entrada mono" inputMode="decimal" placeholder="0,00" value={f.deducoes} onChange={m('deducoes')} />}
              </Campo>
              <Campo rotulo="Desconto incondicionado (R$)">
                {(p) => <input {...p} className="entrada mono" inputMode="decimal" placeholder="0,00" value={f.desconto} onChange={m('desconto')} />}
              </Campo>
              <Campo rotulo="Competência">
                {(p) => <input {...p} type="date" className="entrada" max={hojeISO()} value={f.competencia} onChange={m('competencia')} />}
              </Campo>
            </div>
            <div className="acoes-form">
              <Marcar rotulo="ISS retido pelo tomador" marcado={f.iss_retido} mudar={(v) => setF((a) => ({ ...a, iss_retido: v }))} />
              <Marcar rotulo="Reter INSS" dica="11% sobre a base, cessão de mão de obra" marcado={f.reter_inss}
                mudar={(v) => setF((a) => ({ ...a, reter_inss: v }))} />
            </div>
          </section>

          <section className="cartao" aria-labelledby="t-disc">
            <h2 id="t-disc">Discriminação</h2>
            <Campo rotulo="Descrição do serviço prestado" dica={`${n} de 5 a 2000 caracteres`}>
              {(p) => <textarea {...p} className="entrada" rows={4} maxLength={2000} value={f.descricao} onChange={m('descricao')} />}
            </Campo>
          </section>
        </div>

        <aside className="pedido-lateral">
          <QuadroNfse calc={adiado ? calculo.data : undefined} carregando={calculo.isFetching}
            erro={calculo.isError ? mensagemErro(calculo.error) : undefined} />
          {erros.length > 0 && (
            <div className="erro" role="alert">
              {erros.length === 1 ? erros[0] : <ul className="lista-erros">{erros.map((e) => <li key={e}>{e}</li>)}</ul>}
            </div>
          )}
          {emitir.isError && <p className="erro" role="alert">{mensagemErro(emitir.error)}</p>}
          <button type="submit" className="botao largo" disabled={emitir.isPending}>
            {emitir.isPending ? 'Emitindo NFS-e…' : 'Emitir NFS-e'}</button>
        </aside>
      </form>
    </section>
  )
}

/* ---------------- detalhe ---------------- */

function Detalhe({ eid, id }: { eid: number; id: number }) {
  const { data: eu } = useEu()
  const cliente = useQueryClient()
  const { state } = useLocation() as { state: { emitida?: boolean } | null }
  const q = useQuery({ queryKey: ['nfse-nota', eid, id], queryFn: () => api<Nfse>(rotaEmpresa(eid, `nfse/${id}`)) })
  const [aberta, setAberta] = useState(false)
  const [ok, setOk] = useState('')
  const cancelar = useMutation({
    mutationFn: (motivo: string) => api<Nfse>(rotaEmpresa(eid, `nfse/${id}/cancelar`), json('POST', { motivo })),
    onMutate: () => setOk(''),
    onSuccess: (n) => {
      cliente.setQueryData(['nfse-nota', eid, id], n)
      void cliente.invalidateQueries({ queryKey: ['nfse', eid] })
      setAberta(false)
      setOk('NFS-e cancelada.')
    },
  })

  if (q.isPending) return <p className="mudo" role="status">Carregando…</p>
  if (q.isError) return <p className="erro" role="alert">{mensagemErro(q.error)}</p>
  const n = q.data
  const num = numeroNfse(n)
  const titulo = num ? `NFS-e ${num}` : `DPS ${n.serie_dps}-${n.numero_dps}`
  const temArquivo = n.status === 'autorizada' || n.status === 'cancelada'

  return (
    <section className="nfse-detalhe">
      <TituloPagina titulo="NFS-e" destaque={num ?? `DPS ${n.serie_dps}-${n.numero_dps}`}
        migalhas={[MIGALHA, { rotulo: titulo }]}
        apoio={<><SeloNfse status={n.status} />{' '}{n.modo === 'simulado' && <Selo texto="Simulada" tom="laranja" />}{' '}
          {n.ambiente === 2 ? <Selo texto="Produção restrita" tom="laranja" /> : <Selo texto="Produção" tom="verde" />}
          {' '}emitida em {dataHoraBR(n.emitida_em)}</>}
        acoes={
          <>
            <a className={`botao${temArquivo ? '' : ' sec'}`} href={rotaEmpresa(eid, `nfse/${n.id}/danfse`)} target="_blank" rel="noreferrer">
              <Icone nome="abrir" />DANFSe</a>
            <a className="botao sec" href={rotaEmpresa(eid, `nfse/${n.id}/xml`)} download><Icone nome="baixar" />Baixar XML</a>
          </>
        } />
      <FaixaNfse eid={eid} />
      {state?.emitida && !ok && n.status === 'autorizada' && <p className="ok" role="status">{titulo} autorizada ({brl(n.valor_cent)}).</p>}
      {ok && <p className="ok" role="status">{ok}</p>}
      {(n.status === 'rejeitada' || n.status === 'pendente') && n.mensagem && (
        <p className="erro" role="alert">Retorno: {n.mensagem}</p>
      )}
      {cancelar.isError && <p className="erro" role="alert">{mensagemErro(cancelar.error)}</p>}
      {pode(eu, 'cancelar_nota') && n.status === 'autorizada' && !aberta && (
        <div className="acoes-form">
          <button type="button" className="botao perigo" onClick={() => setAberta(true)}>Cancelar NFS-e</button>
        </div>
      )}
      {aberta && (
        <AcaoTexto titulo="Cancelar a NFS-e" rotulo="Motivo" min={15} max={255} pendente={cancelar.isPending}
          placeholder="Motivo do cancelamento (de 15 a 255 caracteres)." enviar={(t) => cancelar.mutate(t)} fechar={() => setAberta(false)} />
      )}

      <div className="blocos-largos espaco-acima">
        <section className="bloco" aria-labelledby="t-dados-nfse">
          <h2 id="t-dados-nfse">Dados da NFS-e</h2>
          <dl className="dados-cert">
            <div><dt>Tomador</dt><dd>{n.tomador_nome}</dd></div>
            <div><dt>Competência</dt><dd className="mono">{dataBR(n.competencia)}</dd></div>
            <div><dt>Número da NFS-e</dt><dd className="mono">{num ?? '—'}</dd></div>
            <div><dt>DPS</dt><dd className="mono">série {n.serie_dps}, número {n.numero_dps}</dd></div>
            <div><dt>Chave de acesso</dt><dd className="mono">{n.chave ? chaveBR(n.chave) : '—'}</dd></div>
            <div><dt>Envio</dt><dd>{n.modo === 'simulado' ? 'Simulado (sem valor fiscal)' : 'Portal Nacional'}</dd></div>
            {n.cancelada_em && <div><dt>Cancelada em</dt><dd className="mono">{dataHoraBR(n.cancelada_em)}</dd></div>}
            {n.motivo_cancelamento && <div><dt>Motivo do cancelamento</dt><dd>{n.motivo_cancelamento}</dd></div>}
            {n.mensagem && <div><dt>Mensagem</dt><dd>{n.mensagem}</dd></div>}
          </dl>
        </section>
        {n.servico && (
          <section className="bloco" aria-labelledby="t-serv-nfse">
            <h2 id="t-serv-nfse">Serviço</h2>
            <dl className="dados-cert">
              <div><dt>Código de tributação nacional</dt><dd className="mono">{n.servico.cod_trib_nac}</dd></div>
              <div><dt>Item da LC 116</dt><dd className="mono">{n.servico.item_lc116 || '—'}</dd></div>
              <div><dt>NBS</dt><dd className="mono">{n.servico.nbs || '—'}</dd></div>
              <div><dt>Serviço</dt><dd>{n.servico.descricao}</dd></div>
            </dl>
            <h3 className="titulo-lista">Discriminação</h3>
            <p className="previa-descricao">{n.descricao}</p>
          </section>
        )}
        <QuadroNfse titulo="Valores" calc={n.valores} />
      </div>
    </section>
  )
}

/* ---------------- serviços e configuração ---------------- */

function Servicos({ eid }: { eid: number }) {
  const { data: eu } = useEu()
  const editar = pode(eu, 'editar_produtos')
  const q = useServicos(eid)
  const [edicao, setEdicao] = useState<Servico | 'novo' | null>(null)
  return (
    <section className="nfse-servicos">
      <TituloPagina titulo="Serviços" destaque="NFS-e" migalhas={[MIGALHA, { rotulo: 'Serviços' }]}
        apoio="Serviços prestados pela empresa, com o código de tributação nacional e a alíquota do ISS"
        acoes={editar && !edicao && <button type="button" className="botao" onClick={() => setEdicao('novo')}><Icone nome="mais" />Novo serviço</button>} />
      <FaixaNfse eid={eid} />
      {edicao && <FormServicoNfse key={edicao === 'novo' ? 'novo' : edicao.id} eid={eid} servico={edicao === 'novo' ? null : edicao}
        fechar={() => setEdicao(null)} />}
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhum serviço cadastrado</p>}
      {q.data && q.data.length > 0 && (
        <div className="cartao rolagem espaco-acima">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Código</th><th scope="col">Item LC 116</th><th scope="col">NBS</th><th scope="col">Descrição</th>
                <th scope="col" className="num">ISS</th><th scope="col">ISS retido</th><th scope="col">Situação</th>
                {editar && <th scope="col"><span className="so-leitor">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {q.data.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.cod_trib_nac}</td>
                  <td className="mono">{s.item_lc116 || '—'}</td>
                  <td className="mono">{s.nbs || '—'}</td>
                  <td className="produto">{s.descricao}</td>
                  <td className="num">{pct(Number(s.aliq_iss))}</td>
                  <td>{s.iss_retido ? 'Sim' : 'Não'}</td>
                  <td>{s.ativo ? <Selo texto="Ativo" tom="verde" /> : <Selo texto="Inativo" tom="cinza" />}</td>
                  {editar && <td><button type="button" className="botao-texto" onClick={() => setEdicao(s)}
                    aria-label={`Editar ${s.descricao}`}>Editar</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfigNfseBloco eid={eid} />
    </section>
  )
}

function FormServicoNfse({ eid, servico, fechar }: { eid: number; servico: Servico | null; fechar: () => void }) {
  const cliente = useQueryClient()
  const [f, setF] = useState<FormServico>(formDoServico(servico))
  const [erros, setErros] = useState<ErrosServico>({})
  const [catalogo, setCatalogo] = useState(false)
  const cat = useQuery({
    queryKey: ['nfse-catalogo'], queryFn: () => api<ItemCatalogoNfse[]>('/api/nfse/catalogo'), staleTime: Infinity, enabled: catalogo,
  })
  const m = (k: keyof FormServico) => (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value }))
  const salvar = useMutation({
    mutationFn: () => servico
      ? api<Servico>(rotaEmpresa(eid, `nfse/servicos/${servico.id}`), json('PUT', corpoServico(f)))
      : api<Servico>(rotaEmpresa(eid, 'nfse/servicos'), json('POST', corpoServico(f))),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['nfse-servicos', eid] })
      fechar()
    },
  })
  function enviar(ev: FormEvent) {
    ev.preventDefault()
    const v = validarServico(f)
    setErros(v)
    if (Object.keys(v).length === 0) salvar.mutate()
  }
  return (
    <form className="cartao formulario espaco-acima" aria-labelledby="t-form-serv" onSubmit={enviar} noValidate>
      <h2 id="t-form-serv">{servico ? 'Editar serviço' : 'Novo serviço'}</h2>
      <div>
        <button type="button" className="botao sec" aria-expanded={catalogo} onClick={() => setCatalogo((v) => !v)}>
          Importar do catálogo</button>
      </div>
      {catalogo && (
        <div className="catalogo-nfse">
          {cat.isPending && <p className="mudo" role="status">Carregando catálogo…</p>}
          {cat.isError && <p className="erro" role="alert">{mensagemErro(cat.error)}</p>}
          {cat.data && (
            <div className="rolagem">
              <table className="tabela">
                <caption className="so-leitor">Catálogo de serviços sugeridos</caption>
                <thead>
                  <tr><th scope="col">Código</th><th scope="col">Item LC 116</th><th scope="col">Descrição</th>
                    <th scope="col" className="num">ISS</th><th scope="col"><span className="so-leitor">Usar</span></th></tr>
                </thead>
                <tbody>
                  {cat.data.map((c) => (
                    <tr key={c.cod_trib_nac}>
                      <td className="mono">{c.cod_trib_nac}</td><td className="mono">{c.item_lc116}</td><td>{c.descricao}</td>
                      <td className="num">{pct(c.aliq_iss)}</td>
                      <td><button type="button" className="botao-texto" aria-label={`Usar ${c.descricao}`}
                        onClick={() => { setF((a) => formDoCatalogo(c, a)); setErros({}); setCatalogo(false) }}>Usar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="grade-campos">
        <Campo rotulo="Código de tributação nacional" erro={erros.cod_trib_nac} dica="6 dígitos: item, subitem e desdobramento">
          {(p) => <input {...p} className="entrada mono" inputMode="numeric" maxLength={8} value={f.cod_trib_nac} onChange={m('cod_trib_nac')} />}
        </Campo>
        <Campo rotulo="Item da LC 116" erro={erros.item_lc116} dica="Ex.: 1.07">
          {(p) => <input {...p} className="entrada mono" maxLength={5} value={f.item_lc116} onChange={m('item_lc116')} />}
        </Campo>
        <Campo rotulo="NBS (opcional)" erro={erros.nbs} dica="9 dígitos">
          {(p) => <input {...p} className="entrada mono" inputMode="numeric" maxLength={12} value={f.nbs} onChange={m('nbs')} />}
        </Campo>
        <Campo rotulo="Alíquota do ISS (%)" erro={erros.aliq_iss} dica="De 0 a 5">
          {(p) => <input {...p} className="entrada mono" inputMode="decimal" value={f.aliq_iss} onChange={m('aliq_iss')} />}
        </Campo>
        <Campo rotulo="Descrição" erro={erros.descricao} largo>
          {(p) => <input {...p} className="entrada" maxLength={255} value={f.descricao} onChange={m('descricao')} />}
        </Campo>
      </div>
      <div className="acoes-form">
        <Marcar rotulo="ISS retido por padrão" marcado={f.iss_retido} mudar={(v) => setF((a) => ({ ...a, iss_retido: v }))} />
        <Marcar rotulo="Ativo" marcado={f.ativo} mudar={(v) => setF((a) => ({ ...a, ativo: v }))} />
      </div>
      {Object.keys(erros).length > 0 && <p className="erro" role="alert">Confira os campos destacados.</p>}
      {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
      <div className="acoes-form">
        <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar serviço'}</button>
        <button type="button" className="botao sec" onClick={fechar}>Cancelar</button>
      </div>
    </form>
  )
}

function ConfigNfseBloco({ eid }: { eid: number }) {
  const { data: eu } = useEu()
  const cliente = useQueryClient()
  const cfg = useConfigNfse(eid)
  const gerir = pode(eu, 'gerir_empresas')
  const [mei, setMei] = useState<boolean | null>(null)
  const [serie, setSerie] = useState<string | null>(null)
  const [ok, setOk] = useState('')
  const salvar = useMutation({
    mutationFn: (corpo: { mei: boolean; serie_dps: number }) => api<ConfigNfse>(rotaEmpresa(eid, 'nfse/config'), json('PUT', corpo)),
    onMutate: () => setOk(''),
    onSuccess: (c) => {
      cliente.setQueryData(['nfse-config', eid], c)
      setMei(null); setSerie(null)
      setOk('Configuração da NFS-e salva.')
    },
  })
  if (cfg.isPending) return <p className="mudo" role="status">Carregando configuração…</p>
  if (cfg.isError) return <p className="erro" role="alert">{mensagemErro(cfg.error)}</p>
  const c = cfg.data
  const meiAtual = mei ?? c.mei
  const serieAtual = serie ?? String(c.serie_dps)
  const serieNum = Number(serieAtual)
  const serieOk = Number.isInteger(serieNum) && serieNum >= 1 && serieNum <= 99999
  return (
    <section className="cartao espaco-acima" aria-labelledby="t-cfg-nfse">
      <h2 id="t-cfg-nfse">Configuração da NFS-e</h2>
      <dl className="dados-cert">
        <div><dt>Regime</dt><dd>{ROTULO_REGIME[c.regime]}</dd></div>
        <div><dt>DPS</dt><dd className="mono">série {c.serie_dps}, próximo {c.proximo_dps}</dd></div>
        <div><dt>Envio</dt><dd>{c.modo === 'simulado' ? 'Simulado (sem valor fiscal)' : 'Portal Nacional'}</dd></div>
        <div><dt>Ambiente</dt><dd>{c.ambiente === 2 ? 'Produção restrita' : 'Produção'}</dd></div>
        <div><dt>Inscrição municipal</dt><dd className="mono">{c.im || '—'}</dd></div>
      </dl>
      {gerir && (
        <form className="formulario" noValidate onSubmit={(e) => { e.preventDefault(); if (serieOk) salvar.mutate({ mei: meiAtual, serie_dps: serieNum }) }}>
          <div className="grade-campos">
            <Campo rotulo="Série da DPS" erro={serieOk ? undefined : 'De 1 a 99999'}>
              {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={serieAtual} onChange={(e) => setSerie(e.target.value)} />}
            </Campo>
            <div className="campo campo-caixa"><Marcar rotulo="Empresa é MEI" marcado={meiAtual} mudar={setMei}
              dica="sem alíquota de ISS na DPS" /></div>
          </div>
          {ok && <p className="ok" role="status">{ok}</p>}
          {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
          <div className="acoes-form">
            <button type="submit" className="botao sec" disabled={salvar.isPending || !serieOk}>
              {salvar.isPending ? 'Salvando…' : 'Salvar configuração'}</button>
          </div>
        </form>
      )}
    </section>
  )
}

/* ---------------- páginas ---------------- */

export function PaginaNfseLista() {
  return <ComEmpresa>{(eid) => <Lista key={eid} eid={eid} />}</ComEmpresa>
}
export function PaginaNfseNova() {
  return <ComEmpresa>{(eid) => <Emitir key={eid} eid={eid} />}</ComEmpresa>
}
export function PaginaNfseServicos() {
  return <ComEmpresa>{(eid) => <Servicos key={eid} eid={eid} />}</ComEmpresa>
}
export function PaginaNfse() {
  const { id } = useParams()
  return <ComEmpresa>{(eid) => <Detalhe key={`${eid}-${id}`} eid={eid} id={Number(id)} />}</ComEmpresa>
}
