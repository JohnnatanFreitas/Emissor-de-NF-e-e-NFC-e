import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, json, mensagemErro, qs, rotaEmpresa } from '../api'
import { BuscaProduto } from '../componentes/Busca'
import { brl, dataHoraBR, quantidade, textoParaCentavos, textoParaNumero } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { Movimento, Produto, TipoMovimento } from '../tipos'
import { Campo } from '../ui/Campo'
import { Selo, type Tom } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { useAdiado } from './Produtos'

export const ROTULO_MOVIMENTO: Record<TipoMovimento, { texto: string; tom: Tom }> = {
  entrada_manual: { texto: 'Entrada manual', tom: 'verde' },
  saida_manual: { texto: 'Saída manual', tom: 'laranja' },
  inventario: { texto: 'Inventário', tom: 'azul' },
  venda: { texto: 'Venda', tom: 'cinza' },
  estorno_venda: { texto: 'Estorno de venda', tom: 'verde' },
  entrada_xml: { texto: 'Entrada por XML', tom: 'verde' },
}

function useEstoque(eid: number, busca: string) {
  return useQuery({
    queryKey: ['estoque', eid, busca],
    queryFn: () => api<Produto[]>(rotaEmpresa(eid, `estoque${qs({ busca })}`)),
    placeholderData: keepPreviousData,
  })
}

function Saldos({ eid }: { eid: number }) {
  const [busca, setBusca] = useState('')
  const [soBaixo, setSoBaixo] = useState(false)
  const termo = useAdiado(busca.trim())
  const q = useEstoque(eid, termo)
  const lista = (q.data ?? []).filter((p) => !soBaixo || p.estoque <= p.estoque_minimo)
  const valorTotal = lista.reduce((s, p) => s + Math.max(p.estoque, 0) * p.custo_medio_cent, 0)
  return (
    <section className="estoque">
      <TituloPagina titulo="Estoque" destaque="saldos" migalhas={[{ rotulo: 'Estoque' }, { rotulo: 'Saldos' }]}
        acoes={<><Link to="/estoque/ajuste" className="botao">Ajuste / inventário</Link>
          <Link to="/estoque/entrada-xml" className="botao sec">Entrada por XML</Link></>} />
      <div className="ferramentas">
        <div className="busca" role="search">
          <input type="search" className="entrada" aria-label="Buscar produto" placeholder="Código ou descrição"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <label className="opcao"><input type="checkbox" checked={soBaixo} onChange={(e) => setSoBaixo(e.target.checked)} />Só estoque baixo</label>
      </div>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && lista.length === 0 && <p className="vazio mudo">Nenhum produto encontrado</p>}
      {lista.length > 0 && (
        <>
          <div className="cartao rolagem">
            <table className="tabela">
              <thead>
                <tr><th scope="col">Código</th><th scope="col">Descrição</th><th scope="col">Un.</th>
                  <th scope="col" className="num">Saldo</th><th scope="col" className="num">Mínimo</th>
                  <th scope="col" className="num">Custo médio</th><th scope="col" className="num">Valor em estoque</th>
                  <th scope="col">Ações</th></tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.codigo}</td>
                    <td className="produto">{p.descricao}</td>
                    <td>{p.unidade}</td>
                    <td className="num">{p.estoque <= p.estoque_minimo
                      ? <span className="selo selo-st st-laranja">{quantidade(p.estoque)}</span> : quantidade(p.estoque)}</td>
                    <td className="num">{quantidade(p.estoque_minimo)}</td>
                    <td className="num">{brl(p.custo_medio_cent)}</td>
                    <td className="num">{brl(Math.round(Math.max(p.estoque, 0) * p.custo_medio_cent))}</td>
                    <td><span className="acoes-linha">
                      <Link to={`/estoque/movimentos?produto=${p.id}`}>Movimentos</Link>
                      <Link to={`/estoque/ajuste?produto=${p.id}`}>Ajustar</Link>
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mudo dica">Valor do estoque listado (custo médio): {brl(Math.round(valorTotal))}</p>
        </>
      )}
    </section>
  )
}

function Ajuste({ eid }: { eid: number }) {
  const cliente = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const inicial = Number(sp.get('produto')) || null
  const todos = useEstoque(eid, '')
  const [produto, setProduto] = useState<Produto | null>(null)
  const escolhido = produto ?? (inicial ? todos.data?.find((p) => p.id === inicial) ?? null : null)
  const [tipo, setTipo] = useState<'entrada_manual' | 'saida_manual' | 'inventario'>('entrada_manual')
  const [qtd, setQtd] = useState('')
  const [custo, setCusto] = useState('')
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState<Movimento | null>(null)

  const ajustar = useMutation({
    mutationFn: (corpo: unknown) => api<Movimento>(rotaEmpresa(eid, 'estoque/ajuste'), json('POST', corpo)),
    onMutate: () => setFeito(null),
    onSuccess: (m) => {
      setFeito(m)
      setQtd(''); setCusto(''); setObs(''); setProduto(null)
      for (const k of ['estoque', 'produtos', 'movimentos', 'painel']) void cliente.invalidateQueries({ queryKey: [k, eid] })
    },
  })

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    setErro('')
    if (!escolhido) return setErro('Escolha o produto')
    const n = textoParaNumero(qtd)
    if (n == null || n < 0 || (tipo !== 'inventario' && n === 0)) return setErro('Quantidade inválida')
    const c = custo.trim() ? textoParaCentavos(custo) : undefined
    if (c === null) return setErro('Custo inválido')
    ajustar.mutate({ produto_id: escolhido.id, tipo, quantidade: n, custo_unitario_cent: tipo === 'entrada_manual' ? c : undefined,
      observacao: obs.trim() || undefined })
  }

  return (
    <section className="estoque-ajuste">
      <TituloPagina titulo="Ajuste /" destaque="inventário" migalhas={[{ rotulo: 'Estoque', para: '/estoque' }, { rotulo: 'Ajuste / inventário' }]}
        apoio="Entrada e saída somam ou tiram do saldo. No inventário, a quantidade informada vira o saldo." />
      <form className="cartao formulario formulario-estreito" onSubmit={enviar} noValidate>
        <div className="campo">
          <span className="campo-rotulo-forte">Produto</span>
          {escolhido ? (
            <p className="cliente-escolhido"><b className="mono">{escolhido.codigo}</b> {escolhido.descricao}
              <span className="mudo"> · saldo atual {quantidade(escolhido.estoque)} {escolhido.unidade}</span>
              <button type="button" className="botao-texto" onClick={() => { setProduto(null); setSp({}, { replace: true }) }}>Trocar</button></p>
          ) : <BuscaProduto eid={eid} aoEscolher={setProduto} rotulo="Buscar produto" />}
        </div>
        <fieldset className="opcoes">
          <legend>Tipo</legend>
          {([['entrada_manual', 'Entrada manual'], ['saida_manual', 'Saída manual'], ['inventario', 'Inventário (saldo contado)']] as const)
            .map(([v, r]) => (
              <label key={v} className="opcao"><input type="radio" name="tipo" checked={tipo === v} onChange={() => setTipo(v)} />{r}</label>
            ))}
        </fieldset>
        <div className="grade-campos">
          <Campo rotulo={tipo === 'inventario' ? 'Saldo contado' : 'Quantidade'}>
            {(p) => <input {...p} className="entrada mono" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} />}
          </Campo>
          {tipo === 'entrada_manual' && (
            <Campo rotulo="Custo unitário (R$)" dica="Entra no custo médio">
              {(p) => <input {...p} className="entrada mono" inputMode="decimal" value={custo} placeholder="0,00" onChange={(e) => setCusto(e.target.value)} />}
            </Campo>
          )}
          <Campo rotulo="Observação" largo>
            {(p) => <input {...p} className="entrada" value={obs} onChange={(e) => setObs(e.target.value)} />}
          </Campo>
        </div>
        {erro && <p className="erro" role="alert">{erro}</p>}
        {ajustar.isError && <p className="erro" role="alert">{mensagemErro(ajustar.error)}</p>}
        {feito && <p className="ok" role="status">Lançado: {feito.codigo} {ROTULO_MOVIMENTO[feito.tipo]?.texto.toLowerCase()} de {quantidade(feito.quantidade)}; saldo agora {quantidade(feito.saldo_apos)}.</p>}
        <button type="submit" className="botao" disabled={ajustar.isPending}>{ajustar.isPending ? 'Lançando…' : 'Lançar'}</button>
      </form>
    </section>
  )
}

function Movimentos({ eid }: { eid: number }) {
  const [sp, setSp] = useSearchParams()
  const produtoId = sp.get('produto') ?? ''
  const produtos = useEstoque(eid, '')
  const q = useQuery({
    queryKey: ['movimentos', eid, produtoId],
    queryFn: () => api<Movimento[]>(rotaEmpresa(eid, `estoque/movimentos${qs({ produto_id: produtoId })}`)),
  })
  return (
    <section className="movimentos">
      <TituloPagina titulo="Movimentos de" destaque="estoque" migalhas={[{ rotulo: 'Estoque', para: '/estoque' }, { rotulo: 'Movimentos' }]}
        apoio="Os 100 mais recentes" />
      <div className="ferramentas">
        <label className="campo-linha">Produto
          <select className="entrada" value={produtoId} onChange={(e) => setSp(e.target.value ? { produto: e.target.value } : {}, { replace: true })}>
            <option value="">Todos</option>
            {(produtos.data ?? []).map((p) => <option key={p.id} value={String(p.id)}>{p.codigo} — {p.descricao}</option>)}
          </select>
        </label>
      </div>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhum movimento</p>}
      {q.data && q.data.length > 0 && (
        <div className="cartao rolagem">
          <table className="tabela">
            <thead>
              <tr><th scope="col">Data</th><th scope="col">Produto</th><th scope="col">Tipo</th>
                <th scope="col" className="num">Quantidade</th><th scope="col" className="num">Custo unit.</th>
                <th scope="col" className="num">Saldo após</th><th scope="col">Nota</th><th scope="col">Observação</th>
                <th scope="col">Usuário</th></tr>
            </thead>
            <tbody>
              {q.data.map((m) => {
                const r = ROTULO_MOVIMENTO[m.tipo] ?? { texto: m.tipo, tom: 'cinza' as Tom }
                return (
                  <tr key={m.id}>
                    <td className="mono">{dataHoraBR(m.criado_em)}</td>
                    <td><b className="mono">{m.codigo}</b> {m.descricao}</td>
                    <td><Selo texto={r.texto} tom={r.tom} /></td>
                    <td className="num">{m.quantidade > 0 ? '+' : ''}{quantidade(m.quantidade)}</td>
                    <td className="num">{m.custo_unitario_cent != null ? brl(m.custo_unitario_cent) : '—'}</td>
                    <td className="num">{quantidade(m.saldo_apos)}</td>
                    <td>{m.nota_id ? <Link to={`/notas/${m.nota_id}`}>Ver nota</Link> : '—'}</td>
                    <td className="motivo">{m.observacao || '—'}</td>
                    <td>{m.usuario_nome ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function PaginaEstoque() {
  return <ComEmpresa>{(eid) => <Saldos key={eid} eid={eid} />}</ComEmpresa>
}
export function PaginaAjuste() {
  return <ComEmpresa>{(eid) => <Ajuste key={eid} eid={eid} />}</ComEmpresa>
}
export function PaginaMovimentos() {
  return <ComEmpresa>{(eid) => <Movimentos key={eid} eid={eid} />}</ComEmpresa>
}
