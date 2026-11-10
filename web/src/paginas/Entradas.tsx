import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, json, mensagemErro, qs, rotaEmpresa } from '../api'
import { classificacaoPadrao, limitesDoMes, mesAnterior, problemaDataEntrada, problemasClassificacao } from '../classificacao'
import { CamposClassificacao } from '../componentes/CamposClassificacao'
import { brl, chaveBR, cnpjBR, dataBR, hojeISO, quantidade } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { Classificacao, EntradaDetalhe, EntradaResumo } from '../tipos'
import { Marcar } from '../ui/Campo'
import { Selo } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'

const MIGALHAS = [{ rotulo: 'Estoque', para: '/estoque' }, { rotulo: 'Classificar entradas', para: '/estoque/entradas' }]

export function SeloConferida({ classificada }: { classificada: boolean }) {
  return classificada ? <Selo texto="Conferida" tom="verde" /> : <Selo texto="A conferir" tom="laranja" />
}

function Lista({ eid }: { eid: number }) {
  const [de, setDe] = useState(() => limitesDoMes(mesAnterior(hojeISO())).de)
  const [ate, setAte] = useState(() => hojeISO())
  const [soAConferir, setSoAConferir] = useState(false)
  const q = useQuery({
    queryKey: ['entradas', eid, de, ate, soAConferir],
    queryFn: () => api<EntradaResumo[]>(rotaEmpresa(eid, `entradas${qs({ de, ate, situacao: soAConferir ? 'a_conferir' : '' })}`)),
    placeholderData: keepPreviousData,
  })
  const aConferir = (q.data ?? []).filter((e) => !e.classificada).length
  return (
    <section className="entradas">
      <TituloPagina titulo="Classificar" destaque="entradas" migalhas={[MIGALHAS[0], { rotulo: 'Classificar entradas' }]}
        apoio="O destino de cada item (revenda, insumo, uso e consumo, ativo) define o CFOP, o CST e o crédito que vão para o SPED."
        acoes={<Link to="/estoque/entrada-xml" className="botao sec">Entrada por XML</Link>} />
      <div className="ferramentas">
        <span className="datas">
          <label>Entrada de <input type="date" className="entrada" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label>até <input type="date" className="entrada" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        </span>
        <Marcar rotulo="Só a conferir" marcado={soAConferir} mudar={setSoAConferir} />
      </div>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length > 0 && aConferir > 0 && (
        <p className="aviso aviso-painel">{aConferir} nota(s) a conferir no período. Notas sem conferência vão para o SPED com a
          classificação sugerida.</p>
      )}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhuma nota de entrada no período</p>}
      {q.data && q.data.length > 0 && (
        <div className="cartao rolagem">
          <table className="tabela">
            <thead>
              <tr><th scope="col">Nota</th><th scope="col">Entrada</th><th scope="col">Fornecedor</th><th scope="col">Emissão</th>
                <th scope="col" className="num">Total</th><th scope="col">Situação</th></tr>
            </thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.id}>
                  <td className="mono"><Link to={`/estoque/entradas/${e.id}`}>{e.numero}</Link></td>
                  <td className="mono">{dataBR(e.data_entrada)}</td>
                  <td>{e.fornecedor_nome ?? '—'}
                    {e.fornecedor_cnpj && <div className="mudo dica mono">{cnpjBR(e.fornecedor_cnpj)}{e.fornecedor_uf ? ` · ${e.fornecedor_uf}` : ''}</div>}</td>
                  <td className="mono">{dataBR(e.emitida_em)}</td>
                  <td className="num">{brl(e.total_cent)}</td>
                  <td><SeloConferida classificada={e.classificada} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Detalhe({ eid, id }: { eid: number; id: number }) {
  const q = useQuery({
    queryKey: ['entrada', eid, id],
    queryFn: () => api<EntradaDetalhe>(rotaEmpresa(eid, `entradas/${id}`)),
  })
  return (
    <section className="entrada-detalhe">
      <TituloPagina titulo="Nota de" destaque={q.data ? `entrada ${q.data.serie}-${q.data.numero}` : 'entrada'}
        migalhas={[...MIGALHAS, { rotulo: q.data ? `Nota ${q.data.numero}` : 'Nota' }]}
        apoio={q.data ? <>{q.data.fornecedor.nome} · <SeloConferida classificada={q.data.classificada} /></> : undefined} />
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && <FormClassificacao key={q.data.id} eid={eid} ent={q.data} />}
    </section>
  )
}

function FormClassificacao({ eid, ent }: { eid: number; ent: EntradaDetalhe }) {
  const cliente = useQueryClient()
  const [data, setData] = useState(ent.data_entrada ?? hojeISO())
  const [classifs, setClassifs] = useState<Record<number, Classificacao>>(() =>
    Object.fromEntries(ent.itens.map((i) => [i.num_item, i.classificacao ?? classificacaoPadrao(i.cfop_emitente)])))
  const [problemas, setProblemas] = useState<string[]>([])
  const [ok, setOk] = useState(false)
  const salvar = useMutation({
    mutationFn: (corpo: unknown) => api<EntradaDetalhe>(rotaEmpresa(eid, `entradas/${ent.id}/classificacao`), json('PUT', corpo)),
    onMutate: () => setOk(false),
    onSuccess: (d) => {
      cliente.setQueryData(['entrada', eid, ent.id], d)
      void cliente.invalidateQueries({ queryKey: ['entradas', eid] })
      setOk(true)
    },
  })
  const creditoSimples = ent.fornecedor.simples ? ent.itens.reduce((s, i) => s + (i.credito_simples_cent || 0), 0) : 0

  function enviar() {
    const p = problemasClassificacao(ent.itens.map((i) => ({ rotulo: `Item ${i.num_item}`, c: classifs[i.num_item] })))
    const pData = problemaDataEntrada(data, ent.dt_emissao)
    if (pData) p.unshift(pData)
    setProblemas(p)
    if (p.length) return
    salvar.mutate({
      data_entrada: data,
      itens: ent.itens.map((i) => ({ num_item: i.num_item, ...classifs[i.num_item] })),
    })
  }

  return (
    <div className="blocos-largos espaco-acima">
      <section className="bloco" aria-labelledby="t-nota-ent">
        <h2 id="t-nota-ent">Nota</h2>
        <dl className="dados-cert">
          <div><dt>Fornecedor</dt><dd>{ent.fornecedor.nome}</dd></div>
          <div><dt>CNPJ</dt><dd className="mono">{cnpjBR(ent.fornecedor.cnpj)} · {ent.fornecedor.uf}</dd></div>
          <div><dt>Regime do fornecedor</dt><dd>{ent.fornecedor.simples
            ? <Selo texto="Simples Nacional" tom="azul" /> : <Selo texto="Regime normal" tom="cinza" />}</dd></div>
          <div><dt>Emissão</dt><dd className="mono">{dataBR(ent.dt_emissao)}</dd></div>
          <div><dt>Total da nota</dt><dd className="mono">{brl(ent.total_cent)}</dd></div>
          <div><dt>Chave</dt><dd className="mono">{chaveBR(ent.chave)}</dd></div>
        </dl>
        <div className="grade-campos">
          <div className="campo">
            <label htmlFor="data-entrada"><span>Data de entrada</span></label>
            <input id="data-entrada" type="date" className="entrada" value={data} min={ent.dt_emissao.slice(0, 10)} max={hojeISO()}
              aria-describedby="data-entrada-dica" onChange={(e) => setData(e.target.value)} />
            <small id="data-entrada-dica" className="mudo dica">Decide o mês do SPED em que a nota é escriturada.</small>
          </div>
        </div>
        {creditoSimples > 0 && (
          <p className="aviso">Fornecedor do Simples Nacional com crédito de ICMS informado no XML ({brl(creditoSimples)}).
            Esse crédito não é lançado automaticamente no SPED: se a empresa tiver direito, faça o ajuste na apuração.</p>
        )}
      </section>

      <section className="bloco" aria-labelledby="t-itens-ent">
        <h2 id="t-itens-ent">Itens e classificação fiscal</h2>
        <p className="mudo dica">Ao trocar o destino, o CFOP é sugerido de novo (mantém o 1º dígito; com ICMS-ST usa o final de ST).
          Sem ICMS destacado não há crédito de ICMS.</p>
        <div className="rolagem">
          <table className="tabela tabela-entrada">
            <thead>
              <tr><th scope="col">Item do fornecedor</th><th scope="col">CFOP forn.</th><th scope="col">Valores</th>
                <th scope="col">Produto vinculado</th><th scope="col">Classificação (destino, CFOP, CST, créditos)</th></tr>
            </thead>
            <tbody>
              {ent.itens.map((i) => (
                <tr key={i.num_item}>
                  <td className="produto"><b className="mono">{i.num_item}.</b> {i.descricao}
                    <div className="mudo dica mono">Cód. {i.codigo_fornecedor} · NCM {i.ncm} · CST {i.cst_emitente || '—'}</div>
                    <div className="mudo dica">{quantidade(i.quantidade)} {i.unidade}</div></td>
                  <td className="mono">{i.cfop_emitente}</td>
                  <td>
                    <div className="valores-item">
                      <span><small>Produto</small>{brl(i.valor_cent)}</span>
                      <span><small>ICMS</small>{brl(i.icms_cent)}</span>
                      <span><small>ST</small>{brl(i.icms_st_cent)}</span>
                      <span><small>IPI</small>{brl(i.ipi_cent)}</span>
                    </div>
                  </td>
                  <td>{i.produto ? <><b className="mono">{i.produto.codigo}</b> {i.produto.descricao}</>
                    : <span className="mudo">Fora do estoque</span>}</td>
                  <td>
                    <CamposClassificacao item={`item ${i.num_item}`} valor={classifs[i.num_item]} destinos={ent.destinos}
                      comSt={i.icms_st_cent > 0} temIcms={i.icms_cent > 0} temIpi={i.ipi_cent > 0}
                      mudar={(c) => setClassifs((a) => ({ ...a, [i.num_item]: c }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {problemas.length > 0 && <ul className="erro lista-erros" role="alert">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
        {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
        {ok && <p className="ok espaco-acima" role="status">Classificação salva. A nota está conferida e o fornecedor fica lembrado
          para as próximas entradas.</p>}
        <div className="acoes-form">
          <button type="button" className="botao" disabled={salvar.isPending} onClick={enviar}>
            {salvar.isPending ? 'Salvando…' : 'Salvar classificação'}</button>
          <Link to="/estoque/entradas" className="botao sec">Voltar à lista</Link>
        </div>
      </section>
    </div>
  )
}

export function PaginaEntradas() {
  return <ComEmpresa>{(eid) => <Lista key={eid} eid={eid} />}</ComEmpresa>
}

export function PaginaEntrada() {
  const { id } = useParams()
  return <ComEmpresa>{(eid) => <Detalhe key={`${eid}-${id}`} eid={eid} id={Number(id)} />}</ComEmpresa>
}
