import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, json, mensagemErro, pode, qs, rotaEmpresa, useEu } from '../api'
import { QuadroResumo } from '../componentes/Resumo'
import { brl, chaveBR, dataBR, dataHoraBR, hojeISO, pct, quantidade, somarDias } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import { type Inutilizacao, type Nota, type NotaResumo, type StatusNota, rotuloPagamento } from '../tipos'
import { Icone } from '../ui/Icone'
import { STATUS_INUTILIZACAO, STATUS_NOTA, Selo, SeloAmbiente, SeloNota } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { useAdiado } from './Produtos'

export const rotuloModelo = (m: string) => (m === '65' ? 'NFC-e' : 'NF-e')

function Lista({ eid }: { eid: number }) {
  const [modelo, setModelo] = useState('')
  const [status, setStatus] = useState('')
  const [de, setDe] = useState(somarDias(hojeISO(), -30))
  const [ate, setAte] = useState(hojeISO())
  const [busca, setBusca] = useState('')
  const termo = useAdiado(busca.trim())
  const q = useQuery({
    queryKey: ['notas', eid, modelo, status, de, ate, termo],
    queryFn: () => api<NotaResumo[]>(rotaEmpresa(eid, `notas${qs({ modelo, status, de, ate, busca: termo })}`)),
    placeholderData: keepPreviousData,
  })
  const total = (q.data ?? []).filter((n) => n.status === 'autorizada').reduce((s, n) => s + n.total_cent, 0)
  const { data: eu } = useEu()
  const [inutilizar, setInutilizar] = useState(false)
  return (
    <section className="notas">
      <TituloPagina titulo="Notas" destaque="fiscais" apoio="NF-e e NFC-e emitidas pela empresa selecionada"
        acoes={pode(eu, 'cancelar_nota') && (
          <button type="button" className="botao sec" aria-expanded={inutilizar} onClick={() => setInutilizar((v) => !v)}>
            Inutilizar numeração</button>
        )} />
      {inutilizar && <FormInutilizar eid={eid} fechar={() => setInutilizar(false)} />}
      <div className="ferramentas">
        <div className="busca" role="search">
          <input type="search" className="entrada" aria-label="Buscar nota" placeholder="Número, chave ou destinatário"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <label className="campo-linha">Modelo
          <select className="entrada" value={modelo} onChange={(e) => setModelo(e.target.value)}>
            <option value="">Todos</option><option value="55">NF-e</option><option value="65">NFC-e</option>
          </select>
        </label>
        <label className="campo-linha">Situação
          <select className="entrada" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            {(Object.keys(STATUS_NOTA) as StatusNota[]).map((s) => <option key={s} value={s}>{STATUS_NOTA[s].texto}</option>)}
          </select>
        </label>
        <span className="datas">
          <label>De <input type="date" className="entrada" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label>até <input type="date" className="entrada" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        </span>
      </div>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhuma nota no período</p>}
      {q.data && q.data.length > 0 && (
        <>
          <div className="cartao rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Número</th><th scope="col">Modelo</th><th scope="col">Emissão</th><th scope="col">Destinatário</th>
                  <th scope="col" className="num">Total</th><th scope="col">Situação</th><th scope="col">Retorno SEFAZ</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((n) => (
                  <tr key={n.id}>
                    <td className="mono"><Link to={`/notas/${n.id}`}>{n.serie}-{n.numero}</Link></td>
                    <td>{rotuloModelo(n.modelo)}{n.ambiente === 2 && <span className="mudo"> (homolog.)</span>}</td>
                    <td className="mono">{dataHoraBR(n.emitida_em)}</td>
                    <td>{n.destinatario || 'Consumidor'}</td>
                    <td className="num">{brl(n.total_cent)}</td>
                    <td><SeloNota status={n.status} motivo={n.x_motivo} /></td>
                    <td className="motivo">{n.c_stat ? `${n.c_stat} — ${n.x_motivo ?? ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mudo dica">{q.data.length} nota(s) · autorizadas somam {brl(total)}</p>
        </>
      )}
      <ListaInutilizacoes eid={eid} />
    </section>
  )
}

const MIN_JUST = 15

/** Formulário de inutilização de uma faixa de números (avisa a SEFAZ que eles nunca serão usados). */
function FormInutilizar({ eid, fechar }: { eid: number; fechar: () => void }) {
  const cliente = useQueryClient()
  const [modelo, setModelo] = useState<'55' | '65'>('55')
  const [serie, setSerie] = useState('')
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [just, setJust] = useState('')
  const [ok, setOk] = useState('')
  const m = useMutation({
    mutationFn: () => api<Inutilizacao>(rotaEmpresa(eid, 'inutilizacoes'), json('POST', {
      modelo, serie: serie === '' ? null : Number(serie), numero_inicial: Number(inicio),
      numero_final: fim === '' ? Number(inicio) : Number(fim), justificativa: just.trim(),
    })),
    onMutate: () => setOk(''),
    onSuccess: (r) => {
      void cliente.invalidateQueries({ queryKey: ['inutilizacoes', eid] })
      void cliente.invalidateQueries({ queryKey: ['notas', eid] })
      const faixa = r.numero_inicial === r.numero_final ? `Número ${r.numero_inicial}` : `Números ${r.numero_inicial} a ${r.numero_final}`
      if (r.status === 'homologada') {
        setOk(`${faixa} da série ${r.serie} inutilizado(s). Protocolo ${r.protocolo ?? '—'}.`)
        setInicio(''); setFim(''); setJust('')
      } else {
        setOk(`A SEFAZ não respondeu (${r.x_motivo ?? 'sem retorno'}). Os números seguem reservados: envie de novo a mesma faixa.`)
      }
    },
  })
  const n = just.trim().length
  const ini = Number(inicio)
  const valido = Number.isInteger(ini) && ini >= 1 && (fim === '' || Number(fim) >= ini) && n >= MIN_JUST
  return (
    <form className="cartao bloco espaco-acima" aria-labelledby="t-inutilizar"
      onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate() }}>
      <h2 id="t-inutilizar">Inutilizar numeração</h2>
      <p className="mudo">Use para números pulados ou de nota rejeitada que não vai mais sair. Não serve para nota autorizada (essa se cancela).
        A faixa deve começar no próximo número da série ou antes dele.</p>
      <div className="grade-campos">
        <label className="campo"><span>Modelo</span>
          <select className="entrada" value={modelo} onChange={(e) => setModelo(e.target.value as '55' | '65')}>
            <option value="55">NF-e (55)</option><option value="65">NFC-e (65)</option>
          </select>
        </label>
        <label className="campo"><span>Série</span>
          <input className="entrada" inputMode="numeric" placeholder="Série atual" value={serie}
            onChange={(e) => setSerie(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </label>
        <label className="campo"><span>Número inicial</span>
          <input className="entrada" inputMode="numeric" required value={inicio}
            onChange={(e) => setInicio(e.target.value.replace(/\D/g, '').slice(0, 9))} />
        </label>
        <label className="campo"><span>Número final</span>
          <input className="entrada" inputMode="numeric" placeholder="Igual ao inicial" value={fim}
            onChange={(e) => setFim(e.target.value.replace(/\D/g, '').slice(0, 9))} />
        </label>
        <label className="campo campo-largo"><span>Justificativa</span>
          <textarea className="entrada" rows={2} maxLength={255} value={just} aria-describedby="contador-inut"
            placeholder="Ex.: número pulado por falha no sistema emissor" onChange={(e) => setJust(e.target.value)} />
          <small id="contador-inut" className={n > 0 && n < MIN_JUST ? 'erro-campo' : 'mudo'}>{n} de {MIN_JUST} a 255 caracteres</small>
        </label>
      </div>
      {m.isError && <p className="erro" role="alert">{mensagemErro(m.error)}</p>}
      {ok && <p className={m.data?.status === 'homologada' ? 'ok' : 'erro'} role="status">{ok}</p>}
      <div className="acoes-form">
        <button type="submit" className="botao perigo" disabled={!valido || m.isPending}>{m.isPending ? 'Enviando…' : 'Inutilizar na SEFAZ'}</button>
        <button type="button" className="botao sec" onClick={fechar}>Fechar</button>
      </div>
    </form>
  )
}

function ListaInutilizacoes({ eid }: { eid: number }) {
  const q = useQuery({ queryKey: ['inutilizacoes', eid], queryFn: () => api<Inutilizacao[]>(rotaEmpresa(eid, 'inutilizacoes')) })
  if (!q.data?.length) return null
  return (
    <section className="espaco-acima" aria-labelledby="t-inutilizadas">
      <h2 id="t-inutilizadas">Numeração inutilizada</h2>
      <div className="cartao rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th scope="col">Modelo</th><th scope="col">Série</th><th scope="col">Números</th><th scope="col">Pedido em</th>
              <th scope="col">Justificativa</th><th scope="col">Situação</th><th scope="col">Protocolo / retorno</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((i) => {
              const s = STATUS_INUTILIZACAO[i.status]
              return (
                <tr key={i.id}>
                  <td>{rotuloModelo(i.modelo)}{i.ambiente === 2 && <span className="mudo"> (homolog.)</span>}</td>
                  <td className="mono">{i.serie}</td>
                  <td className="mono">{i.numero_inicial === i.numero_final ? i.numero_inicial : `${i.numero_inicial} a ${i.numero_final}`}</td>
                  <td className="mono">{dataHoraBR(i.criado_em)}{i.usuario_nome && <span className="mudo"> · {i.usuario_nome}</span>}</td>
                  <td className="motivo">{i.justificativa}</td>
                  <td><Selo texto={s.texto} tom={s.tom} titulo={i.x_motivo ?? undefined} /></td>
                  <td className="motivo">{i.status === 'homologada' ? <span className="mono">{i.protocolo ?? i.c_stat}</span> : `${i.c_stat ?? ''} ${i.x_motivo ?? ''}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function AcaoTexto({ titulo, rotulo, min, max, placeholder, enviar, pendente, fechar }: {
  titulo: string; rotulo: string; min: number; max: number; placeholder: string; enviar: (t: string) => void
  pendente: boolean; fechar: () => void
}) {
  const [texto, setTexto] = useState('')
  const n = texto.trim().length
  return (
    <div className="confirmacao" role="group" aria-label={titulo}>
      <p><b>{titulo}</b></p>
      <label className="campo">
        <span>{rotulo}</span>
        <textarea className="entrada" rows={3} maxLength={max} value={texto} placeholder={placeholder} autoFocus
          onChange={(e) => setTexto(e.target.value)} aria-describedby="contador-texto" />
        <small id="contador-texto" className={n > 0 && n < min ? 'erro-campo' : 'mudo'}>{n} de {min} a {max} caracteres</small>
      </label>
      <button type="button" className="botao perigo" disabled={n < min || n > max || pendente} onClick={() => enviar(texto.trim())}>
        {pendente ? 'Enviando…' : 'Enviar'}</button>
      <button type="button" className="botao sec" onClick={fechar}>Voltar</button>
    </div>
  )
}

function Detalhe({ eid, id }: { eid: number; id: number }) {
  const { data: eu } = useEu()
  const cliente = useQueryClient()
  const q = useQuery({ queryKey: ['nota', eid, id], queryFn: () => api<Nota>(rotaEmpresa(eid, `notas/${id}`)) })
  const [aberta, setAberta] = useState<'' | 'cce' | 'cancelar'>('')
  const [ok, setOk] = useState('')

  const acao = useMutation({
    mutationFn: ({ rota, corpo }: { rota: string; corpo?: unknown; msg: string }) =>
      api<Nota>(rotaEmpresa(eid, `notas/${id}/${rota}`), json('POST', corpo)),
    onMutate: () => setOk(''),
    onSuccess: (n, v) => {
      cliente.setQueryData(['nota', eid, id], n)
      void cliente.invalidateQueries({ queryKey: ['notas', eid] })
      void cliente.invalidateQueries({ queryKey: ['painel', eid] })
      if (v.rota === 'cancelar') {
        void cliente.invalidateQueries({ queryKey: ['receber', eid] })
        void cliente.invalidateQueries({ queryKey: ['produtos', eid] })
        void cliente.invalidateQueries({ queryKey: ['pedidos', eid] })
      }
      setAberta('')
      setOk(`${v.msg}: ${n.c_stat ?? ''} ${n.x_motivo ?? STATUS_NOTA[n.status]?.texto ?? n.status}`)
    },
  })

  if (q.isPending) return <p className="mudo" role="status">Carregando…</p>
  if (q.isError) return <p className="erro" role="alert">{mensagemErro(q.error)}</p>
  const n = q.data
  const emitir = pode(eu, 'emitir')
  const cancelarOk = pode(eu, 'cancelar_nota')
  const temArquivo = n.status === 'autorizada' || n.status === 'cancelada'

  return (
    <section className="nota-detalhe">
      <TituloPagina titulo={rotuloModelo(n.modelo)} destaque={`${n.serie}-${n.numero}`}
        migalhas={[{ rotulo: 'Notas fiscais', para: '/notas' }, { rotulo: `${rotuloModelo(n.modelo)} ${n.numero}` }]}
        apoio={<><SeloNota status={n.status} /> <SeloAmbiente ambiente={n.ambiente} /> emitida em {dataHoraBR(n.emitida_em)}</>}
        acoes={
          <>
            <a className={`botao${temArquivo ? '' : ' sec'}`} href={rotaEmpresa(eid, `notas/${n.id}/danfe`)} target="_blank" rel="noreferrer">
              <Icone nome="abrir" />DANFE</a>
            <a className="botao sec" href={rotaEmpresa(eid, `notas/${n.id}/xml`)} download><Icone nome="baixar" />Baixar XML</a>
          </>
        } />

      {ok && <p className="ok" role="status">{ok}</p>}
      {acao.isError && <p className="erro" role="alert">{mensagemErro(acao.error)}</p>}
      {(n.status === 'rejeitada' || n.status === 'denegada' || n.status === 'falha_assinatura') && (
        <p className="erro" role="alert">Retorno da SEFAZ: {n.c_stat} — {n.x_motivo}</p>
      )}

      <div className="acoes-form">
        {emitir && n.pode.consultar && (
          <button type="button" className="botao sec" disabled={acao.isPending}
            onClick={() => acao.mutate({ rota: 'consultar', msg: 'Consulta na SEFAZ' })}>Consultar na SEFAZ</button>
        )}
        {emitir && n.pode.reenviar && (
          <button type="button" className="botao" disabled={acao.isPending}
            onClick={() => acao.mutate({ rota: 'reenviar', msg: 'Reenvio' })}>Reenviar</button>
        )}
        {emitir && n.pode.cce && n.modelo === '55' && (
          <button type="button" className="botao sec" onClick={() => setAberta('cce')}>Carta de correção (CC-e)</button>
        )}
        {cancelarOk && n.pode.cancelar && (
          <button type="button" className="botao perigo" onClick={() => setAberta('cancelar')}>Cancelar nota</button>
        )}
      </div>
      {aberta === 'cce' && (
        <AcaoTexto titulo="Carta de correção" rotulo="Correção" min={15} max={1000} pendente={acao.isPending}
          placeholder="Descreva a correção. A CC-e não corrige valores, impostos, destinatário nem data."
          enviar={(t) => acao.mutate({ rota: 'cce', corpo: { correcao: t }, msg: 'CC-e' })} fechar={() => setAberta('')} />
      )}
      {aberta === 'cancelar' && (
        <AcaoTexto titulo="Cancelar a nota" rotulo="Justificativa" min={15} max={255} pendente={acao.isPending}
          placeholder="Motivo do cancelamento. O estoque volta, as parcelas são canceladas e o pedido reabre."
          enviar={(t) => acao.mutate({ rota: 'cancelar', corpo: { justificativa: t }, msg: 'Cancelamento' })} fechar={() => setAberta('')} />
      )}

      <div className="blocos-largos espaco-acima">
        <section className="bloco" aria-labelledby="t-dados-nota">
          <h2 id="t-dados-nota">Dados da nota</h2>
          <dl className="dados-cert">
            <div><dt>Destinatário</dt><dd>{n.destinatario || 'Consumidor'}</dd></div>
            <div><dt>Natureza da operação</dt><dd>{n.natureza || '—'}</dd></div>
            <div><dt>Chave de acesso</dt><dd className="mono">{chaveBR(n.chave)}</dd></div>
            <div><dt>Protocolo</dt><dd className="mono">{n.protocolo ?? '—'}</dd></div>
            {n.autorizada_em && <div><dt>Autorizada em</dt><dd className="mono">{dataHoraBR(n.autorizada_em)}</dd></div>}
            {n.cancelada_em && <div><dt>Cancelada em</dt><dd className="mono">{dataHoraBR(n.cancelada_em)}</dd></div>}
            <div><dt>Retorno SEFAZ</dt><dd>{n.c_stat ? `${n.c_stat} — ${n.x_motivo ?? ''}` : '—'}</dd></div>
            <div><dt>Pedido</dt><dd>{n.pedido_id ? <Link to={`/pedidos/${n.pedido_id}`}>Abrir o pedido</Link> : '—'}</dd></div>
            <div><dt>Pagamento</dt><dd>{n.pagamentos.length
              ? n.pagamentos.map((p) => `${rotuloPagamento(p.tPag)} ${brl(p.valor_cent)}`).join(' · ') : '—'}</dd></div>
          </dl>
        </section>

        <section className="bloco" aria-labelledby="t-itens-nota">
          <h2 id="t-itens-nota">Itens</h2>
          <div className="rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Produto</th><th scope="col" className="num">Qtd.</th><th scope="col" className="num">Unit.</th>
                  <th scope="col" className="num">Total</th><th scope="col">CFOP</th><th scope="col">CST</th>
                  <th scope="col" className="num">ICMS</th><th scope="col" className="num">ST</th><th scope="col" className="num">IPI</th>
                  <th scope="col" className="num">PIS</th><th scope="col" className="num">COFINS</th>
                  <th scope="col" className="num">IBS</th><th scope="col" className="num">CBS</th>
                </tr>
              </thead>
              <tbody>
                {n.itens.map((i, k) => (
                  <tr key={`${i.produto_id}-${k}`}>
                    <td className="produto"><b className="mono">{i.codigo}</b> {i.descricao}</td>
                    <td className="num">{quantidade(i.quantidade)}</td>
                    <td className="num">{brl(i.valor_unitario_cent)}</td>
                    <td className="num">{brl(i.valor_cent)}</td>
                    <td className="mono">{i.cfop}</td>
                    <td className="mono">{i.cst_icms}</td>
                    <td className="num" title={`Base ${brl(i.bc_icms_cent)} · ${pct(i.aliq_icms)}`}>{brl(i.icms_cent)}</td>
                    <td className="num">{brl(i.icms_st_cent)}</td>
                    <td className="num">{brl(i.ipi_cent)}</td>
                    <td className="num">{brl(i.pis_cent)}</td>
                    <td className="num">{brl(i.cofins_cent)}</td>
                    <td className="num">{brl(i.ibs_cent)}</td>
                    <td className="num">{brl(i.cbs_cent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <QuadroResumo titulo="Totais" totais={n.totais} />

        {n.duplicatas && n.duplicatas.length > 0 && (
          <section className="bloco" aria-labelledby="t-dups">
            <h2 id="t-dups">Duplicatas</h2>
            <div className="rolagem">
              <table className="tabela">
                <thead><tr><th scope="col">Número</th><th scope="col">Vencimento</th><th scope="col" className="num">Valor</th></tr></thead>
                <tbody>
                  {n.duplicatas.map((d) => (
                    <tr key={d.numero}><td className="mono">{d.numero}</td><td className="mono">{dataBR(d.vencimento)}</td>
                      <td className="num">{brl(d.valor_cent)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="bloco" aria-labelledby="t-eventos">
          <h2 id="t-eventos">Eventos</h2>
          {n.eventos.length === 0 ? <p className="mudo">Nenhum evento (CC-e ou cancelamento).</p> : (
            <div className="rolagem">
              <table className="tabela">
                <thead>
                  <tr><th scope="col">Data</th><th scope="col">Evento</th><th scope="col">Seq.</th><th scope="col">Texto</th>
                    <th scope="col">Retorno</th><th scope="col">Protocolo</th></tr>
                </thead>
                <tbody>
                  {n.eventos.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{dataHoraBR(e.criado_em)}</td>
                      <td>{e.tipo === 'cce' ? <Selo texto="CC-e" tom="azul" /> : <Selo texto="Cancelamento" tom="cinza" />}</td>
                      <td className="mono">{e.sequencia}</td>
                      <td className="motivo">{e.texto}</td>
                      <td className="motivo">{e.c_stat ? `${e.c_stat} — ${e.x_motivo ?? ''}` : '—'}</td>
                      <td className="mono">{e.protocolo ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

export function PaginaNotas() {
  return <ComEmpresa>{(eid) => <Lista key={eid} eid={eid} />}</ComEmpresa>
}

export function PaginaNota() {
  const { id } = useParams()
  return <ComEmpresa>{(eid) => <Detalhe key={`${eid}-${id}`} eid={eid} id={Number(id)} />}</ComEmpresa>
}
