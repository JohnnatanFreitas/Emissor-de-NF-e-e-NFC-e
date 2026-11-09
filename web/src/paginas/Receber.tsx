import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, json, mensagemErro, qs, rotaEmpresa } from '../api'
import { brl, centavosParaTexto, dataBR, hojeISO, textoParaCentavos } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import { FORMAS_PAGAMENTO, type Parcela, rotuloPagamento } from '../tipos'
import { Indicador } from '../ui/Indicador'
import { SeloParcela } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'

/** Somatórios dos indicadores (sobre a lista filtrada). */
export function totaisReceber(lista: Parcela[]) {
  let aberto = 0, vencido = 0, recebido = 0
  for (const p of lista) {
    if (p.status === 'aberta') {
      aberto += p.valor_cent
      if (p.vencida) vencido += p.valor_cent
    } else if (p.status === 'recebida') recebido += p.valor_recebido_cent ?? p.valor_cent
  }
  return { aberto, vencido, recebido }
}

function Baixa({ eid, p, fechar }: { eid: number; p: Parcela; fechar: () => void }) {
  const cliente = useQueryClient()
  const [valor, setValor] = useState(centavosParaTexto(p.valor_cent))
  const [data, setData] = useState(hojeISO())
  const [forma, setForma] = useState('15')
  const [erro, setErro] = useState('')
  const baixar = useMutation({
    mutationFn: (corpo: unknown) => api<Parcela>(rotaEmpresa(eid, `receber/${p.id}/baixar`), json('POST', corpo)),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['receber', eid] })
      void cliente.invalidateQueries({ queryKey: ['painel', eid] })
      fechar()
    },
  })
  function confirmar() {
    const v = textoParaCentavos(valor)
    if (v == null || v <= 0) return setErro('Valor inválido')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return setErro('Data inválida')
    setErro('')
    baixar.mutate({ valor_recebido_cent: v, recebida_em: data, forma })
  }
  return (
    <div className="confirmacao baixa" role="group" aria-label={`Baixar parcela ${p.numero_dup}`}>
      <div className="linha-pagamento">
        <input className="entrada mono entrada-num" inputMode="decimal" aria-label="Valor recebido" value={valor}
          onChange={(e) => setValor(e.target.value)} />
        <input className="entrada" type="date" aria-label="Recebida em" value={data} onChange={(e) => setData(e.target.value)} />
        <select className="entrada" aria-label="Forma" value={forma} onChange={(e) => setForma(e.target.value)}>
          {FORMAS_PAGAMENTO.filter((f) => f.valor !== '90').map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
        </select>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {baixar.isError && <p className="erro" role="alert">{mensagemErro(baixar.error)}</p>}
      <button type="button" className="botao" disabled={baixar.isPending} onClick={confirmar}>{baixar.isPending ? 'Baixando…' : 'Confirmar baixa'}</button>
      <button type="button" className="botao sec" onClick={fechar}>Voltar</button>
    </div>
  )
}

function Lista({ eid }: { eid: number }) {
  const cliente = useQueryClient()
  const [sp] = useSearchParams()
  const [status, setStatus] = useState(sp.get('status') ?? 'aberta')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [baixando, setBaixando] = useState<number | null>(null)
  const q = useQuery({
    queryKey: ['receber', eid, status, de, ate],
    queryFn: () => api<Parcela[]>(rotaEmpresa(eid, `receber${qs({ status, de, ate })}`)),
    placeholderData: keepPreviousData,
  })
  const estornar = useMutation({
    mutationFn: (id: number) => api<Parcela>(rotaEmpresa(eid, `receber/${id}/estornar`), json('POST')),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['receber', eid] })
      void cliente.invalidateQueries({ queryKey: ['painel', eid] })
    },
  })
  const t = totaisReceber(q.data ?? [])
  return (
    <section className="receber">
      <TituloPagina titulo="Contas a" destaque="receber" apoio="Parcelas geradas pelas notas a prazo" />
      <div className="ferramentas">
        <label className="campo-linha">Situação
          <select className="entrada" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option><option value="aberta">Abertas</option><option value="vencida">Vencidas</option>
            <option value="recebida">Recebidas</option><option value="cancelada">Canceladas</option>
          </select>
        </label>
        <span className="datas">
          <label>Vencimento de <input type="date" className="entrada" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label>até <input type="date" className="entrada" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        </span>
      </div>
      {q.data && (
        <div className="indicadores">
          <Indicador rotulo="Em aberto" valor={brl(t.aberto)} tom="atencao" />
          <Indicador rotulo="Vencido" valor={brl(t.vencido)} tom={t.vencido > 0 ? 'critico' : 'ok'} />
          <Indicador rotulo="Recebido" valor={brl(t.recebido)} tom="ok" />
        </div>
      )}
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {estornar.isError && <p className="erro" role="alert">{mensagemErro(estornar.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhuma parcela</p>}
      {q.data && q.data.length > 0 && (
        <div className="cartao rolagem">
          <table className="tabela">
            <thead>
              <tr><th scope="col">Duplicata</th><th scope="col">Cliente</th><th scope="col">Nota</th><th scope="col">Vencimento</th>
                <th scope="col" className="num">Valor</th><th scope="col">Situação</th><th scope="col">Recebimento</th>
                <th scope="col">Ações</th></tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.numero_dup || p.parcela}</td>
                  <td>{p.cliente_nome}</td>
                  <td className="mono">{p.nota_id ? <Link to={`/notas/${p.nota_id}`}>{p.nota_numero}</Link> : '—'}</td>
                  <td className="mono">{dataBR(p.vencimento)}</td>
                  <td className="num">{brl(p.valor_cent)}</td>
                  <td><SeloParcela status={p.status} vencida={p.vencida} /></td>
                  <td>{p.status === 'recebida'
                    ? `${dataBR(p.recebida_em)} · ${brl(p.valor_recebido_cent)} · ${rotuloPagamento(p.forma)}` : '—'}</td>
                  <td className="acoes-linha">
                    {p.status === 'aberta' && baixando !== p.id && (
                      <button type="button" className="botao-texto" onClick={() => setBaixando(p.id)}>Baixar</button>
                    )}
                    {p.status === 'aberta' && baixando === p.id && <Baixa eid={eid} p={p} fechar={() => setBaixando(null)} />}
                    {p.status === 'recebida' && (
                      <button type="button" className="botao-texto" disabled={estornar.isPending}
                        onClick={() => { if (window.confirm(`Estornar o recebimento da duplicata ${p.numero_dup}?`)) estornar.mutate(p.id) }}>
                        Estornar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function PaginaReceber() {
  return <ComEmpresa>{(eid) => <Lista key={eid} eid={eid} />}</ComEmpresa>
}
