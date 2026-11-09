import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, mensagemErro, pode, rotaEmpresa, useEu } from '../api'
import { useEmpresa } from '../empresa'
import { brl, dataBR, dataHoraBR, inteiro, quantidade } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { Painel } from '../tipos'
import { Indicador } from '../ui/Indicador'
import { Quadro } from '../ui/Quadro'
import { SeloNota } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'

const COMPACTO = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

/** "2026-11-08" em "08/11". */
export function rotuloDia(dia: string) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(dia)
  return m ? `${m[2]}/${m[1]}` : dia
}

function GraficoFaturamento({ dias }: { dias: Painel['faturamento_dias'] }) {
  const dados = dias.map((d) => ({ dia: d.dia, reais: d.total_cent / 100 }))
  const vazio = dados.every((d) => d.reais === 0)
  return (
    <Quadro titulo="Faturamento dos últimos 30 dias" subtitulo="Total das notas autorizadas por dia"
      estado={dados.length === 0 || vazio ? 'vazio' : 'pronto'} mensagem="Nenhuma nota autorizada nos últimos 30 dias">
      <div className="grafico" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--linha)" />
            <XAxis dataKey="dia" tickFormatter={rotuloDia} tickLine={false} axisLine={{ stroke: 'var(--linha)' }}
              tick={{ fill: 'var(--texto-2)', fontSize: 11 }} minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} width={64} tick={{ fill: 'var(--texto-2)', fontSize: 11 }}
              tickFormatter={(v: number) => `R$ ${COMPACTO.format(v)}`} />
            <Tooltip cursor={{ fill: 'var(--trilho)' }} labelFormatter={(d: string) => dataBR(d)}
              formatter={(v: number) => [brl(Math.round(v * 100)), 'Faturamento']}
              contentStyle={{ background: 'var(--cartao)', border: '1px solid var(--linha)', borderRadius: 6, color: 'var(--texto)' }}
              labelStyle={{ color: 'var(--texto)', fontWeight: 600 }} />
            <Bar dataKey="reais" name="Faturamento" fill="var(--c1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="so-leitor">
        <caption>Faturamento dos últimos 30 dias</caption>
        <thead><tr><th scope="col">Dia</th><th scope="col">Total</th></tr></thead>
        <tbody>{dias.map((d) => <tr key={d.dia}><td>{dataBR(d.dia)}</td><td>{brl(d.total_cent)}</td></tr>)}</tbody>
      </table>
    </Quadro>
  )
}

function Conteudo({ eid }: { eid: number }) {
  const { data: eu } = useEu()
  const { atual } = useEmpresa()
  const q = useQuery({ queryKey: ['painel', eid], queryFn: () => api<Painel>(rotaEmpresa(eid, 'painel')) })
  const d = q.data

  return (
    <section className="painel">
      <TituloPagina titulo="Painel" destaque={atual?.nome_fantasia || atual?.razao_social}
        apoio="Números do mês corrente da empresa selecionada" />
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {d && (
        <>
          <div className="indicadores">
            <Indicador rotulo="Faturamento do mês" valor={brl(d.faturamento_mes_cent)} para="/notas" />
            <Indicador rotulo="Notas no mês" valor={inteiro(d.notas_mes)} para="/notas" />
            <Indicador rotulo="ICMS do mês" valor={brl(d.icms_mes_cent)} />
            <Indicador rotulo="IBS do mês" valor={brl(d.ibs_mes_cent)} />
            <Indicador rotulo="CBS do mês" valor={brl(d.cbs_mes_cent)} />
            {pode(eu, 'financeiro') && (
              <>
                <Indicador rotulo="A receber em aberto" valor={brl(d.receber_aberto_cent)} para="/receber" />
                <Indicador rotulo="A receber vencido" valor={brl(d.receber_vencido_cent)}
                  tom={d.receber_vencido_cent > 0 ? 'critico' : 'ok'} para="/receber?status=vencida" />
              </>
            )}
            <Indicador rotulo="Pedidos em aberto" valor={inteiro(d.pedidos_abertos)}
              para={pode(eu, 'pedidos') ? '/pedidos?status=aberto' : undefined} />
          </div>
          <GraficoFaturamento dias={d.faturamento_dias} />
          <div className="grade-2 painel-listas">
            <Quadro titulo="Últimas notas" estado={d.ultimas_notas.length ? 'pronto' : 'vazio'}
              mensagem="Nenhuma nota emitida ainda" acoes={<Link to="/notas">Ver todas</Link>}>
              <ul className="pendencias">
                {d.ultimas_notas.map((n) => (
                  <li key={n.id}>
                    <Link to={`/notas/${n.id}`}>
                      {n.modelo === '65' ? 'NFC-e' : 'NF-e'} {n.numero} · {n.destinatario || 'Consumidor'}
                    </Link>
                    <span className="pend-dir">
                      <span className="mudo mono">{dataHoraBR(n.emitida_em)}</span>
                      <span className="mono">{brl(n.total_cent)}</span>
                      <SeloNota status={n.status} motivo={n.x_motivo} />
                    </span>
                  </li>
                ))}
              </ul>
            </Quadro>
            <Quadro titulo="Estoque baixo" subtitulo="Produtos no estoque mínimo ou abaixo dele"
              estado={d.estoque_baixo.length ? 'pronto' : 'vazio'} mensagem="Nenhum produto abaixo do mínimo">
              <ul className="pendencias">
                {d.estoque_baixo.map((p) => (
                  <li key={p.id}>
                    {pode(eu, 'estoque')
                      ? <Link to={`/estoque/movimentos?produto=${p.id}`}>{p.codigo} · {p.descricao}</Link>
                      : <span>{p.codigo} · {p.descricao}</span>}
                    <span className="pend-dir"><span className="selo selo-st st-laranja mono">{quantidade(p.estoque)}</span></span>
                  </li>
                ))}
              </ul>
            </Quadro>
          </div>
        </>
      )}
    </section>
  )
}

export function PaginaPainel() {
  return <ComEmpresa>{(eid) => <Conteudo eid={eid} />}</ComEmpresa>
}
