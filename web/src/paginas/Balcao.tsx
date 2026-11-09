import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, json, mensagemErro, pode, rotaEmpresa, useEu } from '../api'
import { BuscaProduto } from '../componentes/Busca'
import { useEmpresaDetalhe } from '../empresa'
import { brl, centavosParaTexto, cpfValido, cnpjValido, mascaraDocumento, numeroParaTexto, quantidade, soDigitos,
  textoParaCentavos, textoParaNumero } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import { FORMAS_PAGAMENTO, type Nota, type Produto } from '../tipos'
import { Campo } from '../ui/Campo'
import { Icone } from '../ui/Icone'
import { SeloNota } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'

type Linha = { chave: number; produto: Produto; quantidade: string; valor: string }
type LinhaPag = { chave: number; tPag: string; valor: string }

let seq = 1
const PAGAMENTOS_BALCAO = FORMAS_PAGAMENTO.filter((f) => f.valor !== '90' && f.valor !== '15')

/** Totais da venda e troco (só o dinheiro dá troco). */
export function contasBalcao(itens: { quantidade: number; valor_cent: number }[], pagamentos: { tPag: string; valor_cent: number }[]) {
  const total = itens.reduce((s, i) => s + Math.round(i.quantidade * i.valor_cent), 0)
  const pago = pagamentos.reduce((s, p) => s + p.valor_cent, 0)
  const dinheiro = pagamentos.filter((p) => p.tPag === '01').reduce((s, p) => s + p.valor_cent, 0)
  const falta = Math.max(total - pago, 0)
  const troco = Math.min(Math.max(pago - total, 0), dinheiro)
  const excessoSemDinheiro = pago - total > dinheiro
  return { total, pago, falta, troco, excessoSemDinheiro }
}

function Venda({ eid }: { eid: number }) {
  const cliente = useQueryClient()
  const { data: eu } = useEu()
  const emp = useEmpresaDetalhe(eid)
  const busca = useRef<HTMLInputElement>(null)
  const [itens, setItens] = useState<Linha[]>([])
  const [pags, setPags] = useState<LinhaPag[]>([{ chave: seq++, tPag: '01', valor: '' }])
  const [cpf, setCpf] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [emitida, setEmitida] = useState<Nota | null>(null)

  const itensNum = itens.map((i) => ({
    produto_id: i.produto.id, quantidade: textoParaNumero(i.quantidade) ?? NaN, valor_cent: textoParaCentavos(i.valor) ?? NaN,
  }))
  const pagsNum = pags.map((p) => ({ tPag: p.tPag, valor_cent: textoParaCentavos(p.valor) ?? 0 }))
  const contas = contasBalcao(itensNum.filter((i) => Number.isFinite(i.quantidade) && Number.isFinite(i.valor_cent)), pagsNum)

  function adicionar(p: Produto) {
    setEmitida(null)
    setItens((a) => {
      const ex = a.find((i) => i.produto.id === p.id)
      if (ex) return a.map((i) => (i === ex ? { ...i, quantidade: numeroParaTexto((textoParaNumero(i.quantidade) ?? 0) + 1) } : i))
      return [...a, { chave: seq++, produto: p, quantidade: '1', valor: centavosParaTexto(p.preco_cent) }]
    })
  }

  const emitir = useMutation({
    mutationFn: (corpo: unknown) => api<Nota>(rotaEmpresa(eid, 'nfce'), json('POST', corpo)),
    onSuccess: (n) => {
      setEmitida(n)
      void cliente.invalidateQueries({ queryKey: ['notas', eid] })
      void cliente.invalidateQueries({ queryKey: ['produtos', eid] })
      void cliente.invalidateQueries({ queryKey: ['painel', eid] })
      if (n.status === 'autorizada') {
        window.open(rotaEmpresa(eid, `notas/${n.id}/danfe`), '_blank', 'noopener')
        setItens([]); setPags([{ chave: seq++, tPag: '01', valor: '' }]); setCpf(''); setNome('')
        busca.current?.focus()
      }
    },
  })

  function finalizar() {
    setErro('')
    if (itens.length === 0) return setErro('Adicione pelo menos um produto')
    if (itensNum.some((i) => !(i.quantidade > 0) || !(i.valor_cent >= 0))) return setErro('Confira quantidade e preço dos itens')
    const doc = soDigitos(cpf)
    if (doc && !(doc.length === 11 ? cpfValido(doc) : cnpjValido(doc))) return setErro('CPF/CNPJ do consumidor inválido')
    if (contas.falta > 0) return setErro(`Faltam ${brl(contas.falta)} no pagamento`)
    if (contas.excessoSemDinheiro) return setErro('Troco só em dinheiro: o valor pago em cartão ou PIX passa do total')
    // Vai o valor efetivamente pago; o servidor grava a diferença em vTroco (sai no DANFE).
    const pagamentos = pagsNum.filter((p) => p.valor_cent > 0)
    emitir.mutate({
      cpf: doc || undefined, nome: nome.trim() || undefined, pagamentos,
      itens: itensNum.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, valor_unitario_cent: i.valor_cent })),
    })
  }

  if (emp.data && !emp.data.tem_csc) {
    return (
      <section className="cartao">
        <h1>Venda balcão (NFC-e)</h1>
        <p>Para emitir NFC-e a empresa precisa do CSC (Código de Segurança do Contribuinte).</p>
        {pode(eu, 'gerir_empresas')
          ? <Link to="/configuracoes/empresa" className="botao">Cadastrar o CSC</Link>
          : <p className="mudo">Peça ao escritório para cadastrar o CSC em Configurações → Empresa.</p>}
      </section>
    )
  }

  return (
    <section className="balcao">
      <TituloPagina titulo="Venda" destaque="balcão" apoio="NFC-e: busque pelo código ou leia o código de barras e tecle Enter." />
      {emitida && (
        emitida.status === 'autorizada' ? (
          <p className="ok" role="status">
            NFC-e {emitida.numero} autorizada ({brl(emitida.total_cent)}).{' '}
            <a href={rotaEmpresa(eid, `notas/${emitida.id}/danfe`)} target="_blank" rel="noreferrer">Abrir o DANFE</a>
            {' · '}<Link to={`/notas/${emitida.id}`}>Ver a nota</Link>
          </p>
        ) : (
          <div className="erro" role="alert">
            NFC-e {emitida.numero}: <SeloNota status={emitida.status} /> {emitida.c_stat} {emitida.x_motivo}
            {' · '}<Link to={`/notas/${emitida.id}`}>Ver a nota</Link>
          </div>
        )
      )}
      <div className="pedido-grade">
        <div className="pedido-principal">
          <section className="cartao" aria-labelledby="t-bitens">
            <h2 id="t-bitens">Itens</h2>
            <BuscaProduto eid={eid} aoEscolher={adicionar} entradaRef={busca} autoFocus codigoExato rotulo="Buscar produto ou código de barras" />
            {itens.length === 0 ? <p className="mudo vazio">Nenhum item na venda.</p> : (
              <div className="rolagem espaco-acima">
                <table className="tabela tabela-itens">
                  <thead>
                    <tr><th scope="col">Produto</th><th scope="col" className="num">Qtd.</th><th scope="col" className="num">Preço (R$)</th>
                      <th scope="col" className="num">Total</th><th scope="col"><span className="so-leitor">Remover</span></th></tr>
                  </thead>
                  <tbody>
                    {itens.map((i, n) => (
                      <tr key={i.chave}>
                        <td className="produto"><b className="mono">{i.produto.codigo}</b> {i.produto.descricao}
                          <div className="mudo dica">estoque {quantidade(i.produto.estoque)} {i.produto.unidade}</div></td>
                        <td className="num"><input className="entrada mono entrada-num" inputMode="decimal" value={i.quantidade}
                          aria-label={`Quantidade de ${i.produto.descricao}`}
                          onChange={(e) => setItens((a) => a.map((x) => (x.chave === i.chave ? { ...x, quantidade: e.target.value } : x)))} /></td>
                        <td className="num"><input className="entrada mono entrada-num" inputMode="decimal" value={i.valor}
                          aria-label={`Preço de ${i.produto.descricao}`}
                          onChange={(e) => setItens((a) => a.map((x) => (x.chave === i.chave ? { ...x, valor: e.target.value } : x)))} /></td>
                        <td className="num">{Number.isFinite(itensNum[n].quantidade * itensNum[n].valor_cent)
                          ? brl(Math.round(itensNum[n].quantidade * itensNum[n].valor_cent)) : '—'}</td>
                        <td><button type="button" className="botao-icone" aria-label={`Remover ${i.produto.descricao}`}
                          onClick={() => setItens((a) => a.filter((x) => x.chave !== i.chave))}><Icone nome="lixo" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="cartao" aria-labelledby="t-cons">
            <h2 id="t-cons">Consumidor (opcional)</h2>
            <div className="grade-campos">
              <Campo rotulo="CPF ou CNPJ na nota">
                {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={cpf}
                  onChange={(e) => setCpf(mascaraDocumento(e.target.value))} />}
              </Campo>
              <Campo rotulo="Nome">
                {(p) => <input {...p} className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} />}
              </Campo>
            </div>
          </section>
        </div>
        <aside className="pedido-lateral">
          <section className="cartao resumo" aria-labelledby="t-pagb">
            <h2 id="t-pagb">Pagamento</h2>
            <p className="total-grande"><span className="mudo">Total</span> <b className="mono">{brl(contas.total)}</b></p>
            {pags.map((p) => (
              <div key={p.chave} className="linha-pagamento">
                <select className="entrada" aria-label="Forma de pagamento" value={p.tPag}
                  onChange={(e) => setPags((a) => a.map((x) => (x.chave === p.chave ? { ...x, tPag: e.target.value } : x)))}>
                  {PAGAMENTOS_BALCAO.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
                </select>
                <input className="entrada mono entrada-num" inputMode="decimal" aria-label="Valor pago" placeholder="0,00" value={p.valor}
                  onChange={(e) => setPags((a) => a.map((x) => (x.chave === p.chave ? { ...x, valor: e.target.value } : x)))} />
                {pags.length > 1 && (
                  <button type="button" className="botao-icone" aria-label="Remover pagamento"
                    onClick={() => setPags((a) => a.filter((x) => x.chave !== p.chave))}><Icone nome="lixo" /></button>
                )}
              </div>
            ))}
            <div className="acoes-form">
              <button type="button" className="botao-texto" onClick={() => setPags((a) => [...a, { chave: seq++, tPag: '17', valor: '' }])}>
                Adicionar forma de pagamento</button>
              {contas.falta > 0 && (
                <button type="button" className="botao-texto" onClick={() => setPags((a) => a.map((x, n) => (n === a.length - 1
                  ? { ...x, valor: centavosParaTexto((textoParaCentavos(x.valor) ?? 0) + contas.falta) } : x)))}>
                  Completar o valor</button>
              )}
            </div>
            <dl className="resumo-linhas">
              <div><dt>Pago</dt><dd className="mono">{brl(contas.pago)}</dd></div>
              <div><dt>Falta</dt><dd className="mono">{brl(contas.falta)}</dd></div>
              <div className="resumo-total"><dt>Troco</dt><dd className="mono">{brl(contas.troco)}</dd></div>
            </dl>
          </section>
          {erro && <p className="erro" role="alert">{erro}</p>}
          {emitir.isError && <p className="erro" role="alert">{mensagemErro(emitir.error)}</p>}
          <button type="button" className="botao largo" disabled={emitir.isPending} onClick={finalizar}>
            {emitir.isPending ? 'Emitindo NFC-e…' : 'Emitir NFC-e'}
          </button>
        </aside>
      </div>
    </section>
  )
}

export function PaginaBalcao() {
  return <ComEmpresa>{(eid) => <Venda key={eid} eid={eid} />}</ComEmpresa>
}
