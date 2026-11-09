import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, json, mensagemErro, pode, qs, rotaEmpresa, useEu } from '../api'
import { BuscaCliente, BuscaProduto } from '../componentes/Busca'
import { QuadroResumo } from '../componentes/Resumo'
import { brl, centavosParaTexto, dataBR, dataHoraBR, documentoBR, hojeISO, numeroParaTexto, somarDias,
  textoParaCentavos, textoParaNumero } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import { FORMAS_PAGAMENTO, type Calculo, type Pedido, type PedidoEntrada, type PedidoResumo, type Pessoa, type Produto,
  type RespostaPedido } from '../tipos'
import { Campo } from '../ui/Campo'
import { Icone } from '../ui/Icone'
import { SeloNota, SeloPedido } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { useAdiado } from './Produtos'

function Lista({ eid }: { eid: number }) {
  const { search } = useLocation()
  const inicial = new URLSearchParams(search)
  const [status, setStatus] = useState(inicial.get('status') ?? '')
  const [tipo, setTipo] = useState('')
  const [busca, setBusca] = useState('')
  const termo = useAdiado(busca.trim())
  const q = useQuery({
    queryKey: ['pedidos', eid, status, tipo, termo],
    queryFn: () => api<PedidoResumo[]>(rotaEmpresa(eid, `pedidos${qs({ status, tipo, busca: termo })}`)),
    placeholderData: keepPreviousData,
  })
  return (
    <section className="pedidos">
      <TituloPagina titulo="Pedidos e" destaque="orçamentos"
        acoes={<Link to="/pedidos/novo" className="botao"><Icone nome="mais" />Novo pedido</Link>} />
      <div className="ferramentas">
        <div className="busca" role="search">
          <input type="search" className="entrada" aria-label="Buscar pedido" placeholder="Número ou cliente"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <label className="campo-linha">Situação
          <select className="entrada" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option><option value="aberto">Aberto</option>
            <option value="faturado">Faturado</option><option value="cancelado">Cancelado</option>
          </select>
        </label>
        <label className="campo-linha">Tipo
          <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option><option value="pedido">Pedido</option><option value="orcamento">Orçamento</option>
          </select>
        </label>
      </div>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhum pedido encontrado</p>}
      {q.data && q.data.length > 0 && (
        <div className="cartao rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Número</th><th scope="col">Tipo</th><th scope="col">Cliente</th>
                <th scope="col" className="num">Total</th><th scope="col">Criado em</th><th scope="col">Situação</th>
                <th scope="col">NF-e</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td className="mono"><Link to={`/pedidos/${p.id}`}>{p.numero}</Link></td>
                  <td>{p.tipo === 'orcamento' ? 'Orçamento' : 'Pedido'}</td>
                  <td>{p.cliente_nome}</td>
                  <td className="num">{brl(p.total_cent)}</td>
                  <td className="mono">{dataHoraBR(p.criado_em)}</td>
                  <td><SeloPedido status={p.status} /></td>
                  <td className="mono">{p.nota_id ? <Link to={`/notas/${p.nota_id}`}>{p.nota_numero}</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type LinhaItem = {
  chave: number; produto_id: number; codigo: string; descricao: string; unidade: string
  quantidade: string; valor: string; desconto: string
}
type FormPedido = {
  tipo: 'orcamento' | 'pedido'; cliente: { id: number; nome: string; doc: string } | null; itens: LinhaItem[]
  forma_pagamento: string; parcelas: string; primeiro_vencimento: string; intervalo_dias: string; observacoes: string
}

let seq = 1
function linhaDoProduto(p: Produto): LinhaItem {
  return {
    chave: seq++, produto_id: p.id, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, quantidade: '1',
    valor: centavosParaTexto(p.preco_cent), desconto: '',
  }
}

function formDoPedido(p?: Pedido): FormPedido {
  if (!p) {
    return { tipo: 'pedido', cliente: null, itens: [], forma_pagamento: '17', parcelas: '1',
      primeiro_vencimento: somarDias(hojeISO(), 30), intervalo_dias: '30', observacoes: '' }
  }
  return {
    tipo: p.tipo, cliente: { id: p.cliente_id, nome: p.cliente_nome, doc: '' },
    itens: p.itens.map((i) => ({
      chave: seq++, produto_id: i.produto_id, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade,
      quantidade: numeroParaTexto(i.quantidade), valor: centavosParaTexto(i.valor_unitario_cent),
      desconto: i.desconto_cent ? centavosParaTexto(i.desconto_cent) : '',
    })),
    forma_pagamento: p.forma_pagamento, parcelas: String(p.parcelas || 1),
    primeiro_vencimento: p.primeiro_vencimento ?? somarDias(hojeISO(), 30), intervalo_dias: String(p.intervalo_dias || 30),
    observacoes: p.observacoes ?? '',
  }
}

/** Itens válidos para o cálculo e para salvar; os inválidos ficam de fora (e são apontados na validação). */
export function itensValidos(itens: LinhaItem[]) {
  return itens.flatMap((i) => {
    const quantidade = textoParaNumero(i.quantidade)
    const valor_unitario_cent = textoParaCentavos(i.valor)
    const desconto_cent = i.desconto.trim() ? textoParaCentavos(i.desconto) : 0
    if (quantidade == null || quantidade <= 0 || valor_unitario_cent == null || valor_unitario_cent < 0
      || desconto_cent == null || desconto_cent < 0) return []
    return [{ produto_id: i.produto_id, quantidade, valor_unitario_cent, desconto_cent }]
  })
}

function validarPedido(f: FormPedido) {
  const e: string[] = []
  if (!f.cliente) e.push('Escolha o cliente')
  if (f.itens.length === 0) e.push('Adicione pelo menos um produto')
  if (itensValidos(f.itens).length !== f.itens.length) e.push('Confira quantidade, preço e desconto dos itens')
  if (f.forma_pagamento === '15') {
    const n = Number(f.parcelas)
    if (!Number.isInteger(n) || n < 1 || n > 48) e.push('Parcelas entre 1 e 48')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.primeiro_vencimento)) e.push('Informe o 1º vencimento')
    if (!/^\d+$/.test(f.intervalo_dias) || Number(f.intervalo_dias) < 1) e.push('Intervalo entre parcelas inválido')
  }
  return e
}

function corpoPedido(f: FormPedido): PedidoEntrada {
  const boleto = f.forma_pagamento === '15'
  return {
    tipo: f.tipo, cliente_id: f.cliente!.id, itens: itensValidos(f.itens), forma_pagamento: f.forma_pagamento,
    parcelas: boleto ? Number(f.parcelas) : 1, primeiro_vencimento: boleto ? f.primeiro_vencimento : undefined,
    intervalo_dias: boleto ? Number(f.intervalo_dias) : 30, observacoes: f.observacoes.trim() || undefined,
  }
}

/** Resultado da emissão para mostrar na página do pedido depois de salvar. */
type Retorno = { mensagem?: string; erro_emissao?: string; nota?: { id: number; numero: number; status: string } }

function Formulario({ eid, id }: { eid: number; id: number | null }) {
  const q = useQuery({
    queryKey: ['pedido', eid, id], enabled: id != null,
    queryFn: () => api<Pedido>(rotaEmpresa(eid, `pedidos/${id}`)),
  })
  if (id != null && q.isPending) return <p className="mudo" role="status">Carregando…</p>
  if (id != null && q.isError) return <p className="erro" role="alert">{mensagemErro(q.error)}</p>
  return <FormPedidoEdicao key={q.dataUpdatedAt} eid={eid} pedido={q.data} />
}

function FormPedidoEdicao({ eid, pedido }: { eid: number; pedido?: Pedido }) {
  const navegar = useNavigate()
  const cliente = useQueryClient()
  const { data: eu } = useEu()
  const { state } = useLocation()
  const retorno = (state as Retorno | null) ?? null
  const [f, setF] = useState(() => formDoPedido(pedido))
  const [erros, setErros] = useState<string[]>([])
  const editavel = !pedido || pedido.status === 'aberto'
  const podeEmitir = pode(eu, 'emitir')

  const mudarItem = (chave: number, k: keyof LinhaItem, v: string) =>
    setF((a) => ({ ...a, itens: a.itens.map((i) => (i.chave === chave ? { ...i, [k]: v } : i)) }))

  // Resumo: POST /calculo a cada mudança (com espera de 400 ms).
  const pedidoCalculo = useMemo(() => ({
    modelo: '55' as const, cliente_id: f.cliente?.id, itens: itensValidos(f.itens),
  }), [f.cliente, f.itens])
  const adiado = useAdiado(pedidoCalculo, 400)
  const calculo = useQuery({
    queryKey: ['calculo', eid, adiado], enabled: editavel && adiado.itens.length > 0,
    queryFn: () => api<Calculo>(rotaEmpresa(eid, 'calculo'), json('POST', adiado)),
    placeholderData: keepPreviousData, retry: false,
  })
  const calc = editavel ? (adiado.itens.length ? calculo.data : undefined) : pedido?.calculo

  const salvar = useMutation({
    mutationFn: (emitir: boolean) => pedido
      ? api<RespostaPedido>(rotaEmpresa(eid, `pedidos/${pedido.id}`), json('PUT', { ...corpoPedido(f), emitir }))
      : api<RespostaPedido>(rotaEmpresa(eid, 'pedidos'), json('POST', { ...corpoPedido(f), emitir })),
    onSuccess: (r, emitir) => aposSalvar(r, emitir),
  })
  const emitirSalvo = useMutation({
    mutationFn: () => api<RespostaPedido>(rotaEmpresa(eid, `pedidos/${pedido!.id}/emitir`), json('POST')),
    onSuccess: (r) => aposSalvar(r, true),
  })
  const cancelar = useMutation({
    mutationFn: () => api<Pedido>(rotaEmpresa(eid, `pedidos/${pedido!.id}/cancelar`), json('POST')),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['pedidos', eid] })
      await cliente.invalidateQueries({ queryKey: ['pedido', eid, pedido!.id] })
    },
  })
  const [confirmaCancelar, setConfirmaCancelar] = useState(false)

  async function aposSalvar(r: RespostaPedido, emitir: boolean) {
    await Promise.all([
      cliente.invalidateQueries({ queryKey: ['pedidos', eid] }),
      cliente.invalidateQueries({ queryKey: ['pedido', eid, r.pedido.id] }),
      cliente.invalidateQueries({ queryKey: ['notas', eid] }),
      cliente.invalidateQueries({ queryKey: ['painel', eid] }),
      cliente.invalidateQueries({ queryKey: ['produtos', eid] }),
    ])
    const st: Retorno = {
      mensagem: r.nota?.status === 'autorizada' ? `NF-e ${r.nota.numero} autorizada.`
        : emitir && !r.erro_emissao && r.nota ? `NF-e ${r.nota.numero}: ${r.nota.x_motivo ?? r.nota.status}` : 'Pedido salvo.',
      erro_emissao: r.erro_emissao,
      nota: r.nota ? { id: r.nota.id, numero: r.nota.numero, status: r.nota.status } : undefined,
    }
    navegar(`/pedidos/${r.pedido.id}`, { replace: true, state: st })
  }

  function enviar(emitir: boolean) {
    const v = validarPedido(f)
    setErros(v)
    if (v.length === 0) salvar.mutate(emitir)
  }

  function adicionar(p: Produto) {
    setF((a) => {
      const existente = a.itens.find((i) => i.produto_id === p.id)
      if (existente) {
        const q = (textoParaNumero(existente.quantidade) ?? 0) + 1
        return { ...a, itens: a.itens.map((i) => (i === existente ? { ...i, quantidade: numeroParaTexto(q) } : i)) }
      }
      return { ...a, itens: [...a.itens, linhaDoProduto(p)] }
    })
  }

  const itemCalc = (produto_id: number, n: number) => calc?.itens.filter((x) => x.produto_id === produto_id)[0]
    ?? calc?.itens[n]
  const ocupado = salvar.isPending || emitirSalvo.isPending
  const titulo = pedido ? `${pedido.tipo === 'orcamento' ? 'Orçamento' : 'Pedido'} ${pedido.numero}` : 'Novo pedido'

  return (
    <section className="pedido-form">
      <TituloPagina titulo={pedido ? (pedido.tipo === 'orcamento' ? 'Orçamento' : 'Pedido') : 'Novo'}
        destaque={pedido ? String(pedido.numero) : 'pedido'}
        migalhas={[{ rotulo: 'Pedidos e orçamentos', para: '/pedidos' }, { rotulo: titulo }]}
        apoio={pedido ? <><SeloPedido status={pedido.status} /> criado em {dataHoraBR(pedido.criado_em)}</> : undefined}
        acoes={pedido?.nota_id ? <Link to={`/notas/${pedido.nota_id}`} className="botao sec">Ver NF-e {pedido.nota_numero}</Link> : undefined} />

      {retorno?.mensagem && !retorno.erro_emissao && (
        <p className="ok" role="status">
          {retorno.mensagem}{' '}
          {retorno.nota && <Link to={`/notas/${retorno.nota.id}`}>Abrir a nota</Link>}
          {retorno.nota?.status === 'autorizada' && <> · <a href={rotaEmpresa(eid, `notas/${retorno.nota.id}/danfe`)}
            target="_blank" rel="noreferrer">DANFE</a></>}
        </p>
      )}
      {retorno?.erro_emissao && (
        <div className="erro" role="alert">
          <b>A NF-e não foi autorizada.</b> O pedido continua salvo. Motivo: {retorno.erro_emissao}
          {retorno.nota && <> · <Link to={`/notas/${retorno.nota.id}`}>Ver a nota</Link></>}
        </div>
      )}

      <form className="pedido-grade" onSubmit={(e: FormEvent) => { e.preventDefault(); enviar(false) }} noValidate>
        <div className="pedido-principal">
          <section className="cartao" aria-labelledby="t-cli">
            <h2 id="t-cli">Cliente</h2>
            <div className="grade-campos">
              <Campo rotulo="Tipo">
                {(p) => (
                  <select {...p} className="entrada" disabled={!editavel} value={f.tipo}
                    onChange={(e) => setF((a) => ({ ...a, tipo: e.target.value as FormPedido['tipo'] }))}>
                    <option value="pedido">Pedido</option><option value="orcamento">Orçamento</option>
                  </select>
                )}
              </Campo>
            </div>
            {f.cliente ? (
              <p className="cliente-escolhido">
                <b>{f.cliente.nome}</b>{f.cliente.doc && <span className="mudo mono"> · {documentoBR(f.cliente.doc)}</span>}
                {editavel && <button type="button" className="botao-texto" onClick={() => setF((a) => ({ ...a, cliente: null }))}>Trocar</button>}
              </p>
            ) : (
              <BuscaCliente eid={eid} aoEscolher={(p: Pessoa) => setF((a) => ({ ...a, cliente: { id: p.id, nome: p.nome, doc: p.cpf_cnpj } }))} />
            )}
          </section>

          <section className="cartao" aria-labelledby="t-itens">
            <h2 id="t-itens">Itens</h2>
            {editavel && <BuscaProduto eid={eid} aoEscolher={adicionar} />}
            {f.itens.length === 0 ? <p className="mudo vazio">Nenhum item. Busque um produto acima.</p> : (
              <div className="rolagem espaco-acima">
                <table className="tabela tabela-itens">
                  <thead>
                    <tr>
                      <th scope="col">Produto</th><th scope="col" className="num">Qtd.</th>
                      <th scope="col" className="num">Valor unit. (R$)</th><th scope="col" className="num">Desconto (R$)</th>
                      <th scope="col" className="num">Total</th><th scope="col">CFOP / CST</th>
                      {editavel && <th scope="col"><span className="so-leitor">Remover</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {f.itens.map((i, n) => {
                      const c = itemCalc(i.produto_id, n)
                      return (
                        <tr key={i.chave}>
                          <td className="produto"><b className="mono">{i.codigo}</b> {i.descricao}</td>
                          <td className="num">
                            <input className="entrada mono entrada-num" inputMode="decimal" aria-label={`Quantidade de ${i.descricao}`}
                              disabled={!editavel} value={i.quantidade} onChange={(e) => mudarItem(i.chave, 'quantidade', e.target.value)} />
                            <span className="mudo"> {i.unidade}</span>
                          </td>
                          <td className="num">
                            <input className="entrada mono entrada-num" inputMode="decimal" aria-label={`Valor unitário de ${i.descricao}`}
                              disabled={!editavel} value={i.valor} onChange={(e) => mudarItem(i.chave, 'valor', e.target.value)} />
                          </td>
                          <td className="num">
                            <input className="entrada mono entrada-num" inputMode="decimal" aria-label={`Desconto de ${i.descricao}`}
                              disabled={!editavel} value={i.desconto} placeholder="0,00"
                              onChange={(e) => mudarItem(i.chave, 'desconto', e.target.value)} />
                          </td>
                          <td className="num">{c ? brl(c.valor_cent) : '—'}</td>
                          <td className="mono">{c ? `${c.cfop} / ${c.cst_icms}` : '—'}</td>
                          {editavel && (
                            <td>
                              <button type="button" className="botao-icone" aria-label={`Remover ${i.descricao}`} title="Remover"
                                onClick={() => setF((a) => ({ ...a, itens: a.itens.filter((x) => x.chave !== i.chave) }))}>
                                <Icone nome="lixo" />
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-pag">
            <h2 id="t-pag">Pagamento</h2>
            <div className="grade-campos">
              <Campo rotulo="Forma de pagamento">
                {(p) => (
                  <select {...p} className="entrada" disabled={!editavel} value={f.forma_pagamento}
                    onChange={(e) => setF((a) => ({ ...a, forma_pagamento: e.target.value }))}>
                    {FORMAS_PAGAMENTO.map((x) => <option key={x.valor} value={x.valor}>{x.rotulo}</option>)}
                  </select>
                )}
              </Campo>
              {f.forma_pagamento === '15' && (
                <>
                  <Campo rotulo="Parcelas">
                    {(p) => <input {...p} className="entrada mono" inputMode="numeric" disabled={!editavel} value={f.parcelas}
                      onChange={(e) => setF((a) => ({ ...a, parcelas: e.target.value }))} />}
                  </Campo>
                  <Campo rotulo="1º vencimento">
                    {(p) => <input {...p} className="entrada" type="date" disabled={!editavel} value={f.primeiro_vencimento}
                      onChange={(e) => setF((a) => ({ ...a, primeiro_vencimento: e.target.value }))} />}
                  </Campo>
                  <Campo rotulo="Dias entre parcelas">
                    {(p) => <input {...p} className="entrada mono" inputMode="numeric" disabled={!editavel} value={f.intervalo_dias}
                      onChange={(e) => setF((a) => ({ ...a, intervalo_dias: e.target.value }))} />}
                  </Campo>
                </>
              )}
              <Campo rotulo="Observações (vão para a nota)" largo>
                {(p) => <textarea {...p} className="entrada" rows={2} disabled={!editavel} value={f.observacoes}
                  onChange={(e) => setF((a) => ({ ...a, observacoes: e.target.value }))} />}
              </Campo>
            </div>
            {f.forma_pagamento === '15' && pedido && pedido.status !== 'aberto' && pedido.primeiro_vencimento && (
              <p className="mudo">1º vencimento em {dataBR(pedido.primeiro_vencimento)}</p>
            )}
          </section>
        </div>

        <aside className="pedido-lateral">
          <QuadroResumo totais={calc?.totais} carregando={calculo.isFetching}
            erro={calculo.isError ? mensagemErro(calculo.error) : undefined}
            aviso={calc ? `${calc.interestadual ? 'Operação interestadual' : 'Operação interna'}${calc.consumidor_final ? ' · consumidor final' : ''}`
              : !f.cliente ? 'Escolha o cliente e adicione itens para calcular.' : undefined} />
          {erros.length > 0 && <ul className="erro lista-erros" role="alert">{erros.map((e) => <li key={e}>{e}</li>)}</ul>}
          {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
          {emitirSalvo.isError && <p className="erro" role="alert">{mensagemErro(emitirSalvo.error)}</p>}
          {cancelar.isError && <p className="erro" role="alert">{mensagemErro(cancelar.error)}</p>}
          {editavel && (
            <div className="acoes-coluna">
              <button type="submit" className="botao sec" disabled={ocupado}>{salvar.isPending && !salvar.variables ? 'Salvando…' : 'Salvar'}</button>
              {podeEmitir && (
                <button type="button" className="botao" disabled={ocupado} onClick={() => enviar(true)}>
                  {salvar.isPending && salvar.variables ? 'Emitindo…' : 'Salvar e emitir NF-e'}
                </button>
              )}
              {pedido && podeEmitir && (
                <button type="button" className="botao-texto" disabled={ocupado} onClick={() => emitirSalvo.mutate()}
                  title="Emite com os dados já salvos, sem as alterações desta tela">Emitir a versão salva</button>
              )}
              {pedido && !confirmaCancelar && (
                <button type="button" className="botao-texto" onClick={() => setConfirmaCancelar(true)}>Cancelar pedido</button>
              )}
              {pedido && confirmaCancelar && (
                <div className="confirmacao">
                  <p>Cancelar o pedido {pedido.numero}?</p>
                  <button type="button" className="botao perigo" disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>
                    {cancelar.isPending ? 'Cancelando…' : 'Cancelar pedido'}</button>
                  <button type="button" className="botao sec" onClick={() => setConfirmaCancelar(false)}>Voltar</button>
                </div>
              )}
            </div>
          )}
          {pedido && pedido.status !== 'aberto' && pedido.nota_id && (
            <p className="mudo">Pedido faturado na NF-e {pedido.nota_numero}. <Link to={`/notas/${pedido.nota_id}`}>Abrir a nota</Link></p>
          )}
          {retorno?.nota && <p className="mudo">Última nota: <SeloNota status={retorno.nota.status as never} /></p>}
        </aside>
      </form>
    </section>
  )
}

export function PaginaPedidos() {
  return <ComEmpresa>{(eid) => <Lista key={eid} eid={eid} />}</ComEmpresa>
}

export function PaginaPedido() {
  const { id } = useParams()
  const n = id && id !== 'novo' ? Number(id) : null
  return <ComEmpresa>{(eid) => <Formulario key={`${eid}-${id}`} eid={eid} id={n} />}</ComEmpresa>
}
