import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, json, mensagemErro, pode, rotaEmpresa, useEu } from '../api'
import { BuscaCliente, BuscaProduto } from '../componentes/Busca'
import { QuadroResumo } from '../componentes/Resumo'
import { cardHabilitado, formasEmissao, itensValidos, montarCorpoEmissao, operacaoValida, validarEmissao } from '../emissaoRapida'
import { useEmpresaDetalhe } from '../empresa'
import { brl, centavosParaTexto, documentoBR, mascaraDocumento, numeroParaTexto, pct, textoParaCentavos,
  textoParaNumero } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { Calculo, Modelo, Nota, Operacao, Pessoa, Produto } from '../tipos'
import { Campo } from '../ui/Campo'
import { Icone } from '../ui/Icone'
import { Selo, SeloNota } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { useAdiado } from './Produtos'

type Linha = { chave: number; produto: Produto; quantidade: string; valor: string }
let seq = 1

export function useOperacoes() {
  return useQuery({ queryKey: ['operacoes'], queryFn: () => api<Operacao[]>('/api/operacoes'), staleTime: Infinity })
}

const MODELOS: { valor: Modelo; rotulo: string; texto: string }[] = [
  { valor: '55', rotulo: 'NF-e (modelo 55)', texto: 'Para cliente cadastrado: empresa ou pessoa física identificada.' },
  { valor: '65', rotulo: 'NFC-e (modelo 65)', texto: 'Venda ao consumidor final; CPF opcional.' },
]

function Emissao({ eid }: { eid: number }) {
  const cliente = useQueryClient()
  const { data: eu } = useEu()
  const emp = useEmpresaDetalhe(eid)
  const ops = useOperacoes()
  const [modelo, setModelo] = useState<Modelo>('55')
  const [operacao, setOperacao] = useState('venda')
  const [pessoa, setPessoa] = useState<Pessoa | null>(null)
  const [cpf, setCpf] = useState('')
  const [nome, setNome] = useState('')
  const [itens, setItens] = useState<Linha[]>([])
  const [tPag, setTPag] = useState('01')
  const [observacao, setObservacao] = useState('')
  const [erros, setErros] = useState<string[]>([])
  const [emitida, setEmitida] = useState<Nota | null>(null)

  const lista = ops.data ?? []
  const op = lista.find((o) => o.valor === operacao)
  const semCsc = modelo === '65' && emp.data != null && !emp.data.tem_csc

  function trocarModelo(m: Modelo) {
    setModelo(m)
    setOperacao((atual) => operacaoValida(lista, atual, m))
    if (!formasEmissao(m).some((f) => f.valor === tPag)) setTPag('01')
  }

  const linhas = itens.map((i) => ({
    produto_id: i.produto.id, quantidade: textoParaNumero(i.quantidade) ?? NaN, valor_unitario_cent: textoParaCentavos(i.valor) ?? NaN,
  }))

  // Prévia: POST /calculo com a operação (CFOP, CST e alíquotas prontos), com espera de 400 ms.
  const pedidoCalculo = useMemo(() => ({
    modelo, operacao, cliente_id: modelo === '55' ? pessoa?.id : undefined, itens: itensValidos(linhas),
  }), [modelo, operacao, pessoa, JSON.stringify(linhas)]) // eslint-disable-line react-hooks/exhaustive-deps
  const adiado = useAdiado(pedidoCalculo, 400)
  const prontoParaCalcular = adiado.itens.length > 0 && (adiado.modelo === '65' || adiado.cliente_id != null)
  const calculo = useQuery({
    queryKey: ['calculo', eid, adiado], enabled: prontoParaCalcular,
    queryFn: () => api<Calculo>(rotaEmpresa(eid, 'calculo'), json('POST', adiado)),
    placeholderData: keepPreviousData, retry: false,
  })
  const atualizado = adiado === pedidoCalculo && !calculo.isPlaceholderData && !calculo.isFetching
  const calc = prontoParaCalcular ? calculo.data : undefined
  const itemCalc = (produto_id: number) => calc?.itens.find((x) => x.produto_id === produto_id)
  const total = atualizado ? calc?.totais.total_cent : undefined

  function adicionar(p: Produto) {
    setEmitida(null)
    setItens((a) => {
      const ex = a.find((i) => i.produto.id === p.id)
      if (ex) return a.map((i) => (i === ex ? { ...i, quantidade: numeroParaTexto((textoParaNumero(i.quantidade) ?? 0) + 1) } : i))
      return [...a, { chave: seq++, produto: p, quantidade: '1', valor: centavosParaTexto(p.preco_cent) }]
    })
  }
  const mudar = (chave: number, k: 'quantidade' | 'valor', v: string) =>
    setItens((a) => a.map((x) => (x.chave === chave ? { ...x, [k]: v } : x)))

  const emitir = useMutation({
    mutationFn: (corpo: unknown) => api<Nota>(rotaEmpresa(eid, 'emissao-rapida'), json('POST', corpo)),
    onMutate: () => setEmitida(null),
    onSuccess: (n) => {
      setEmitida(n)
      void cliente.invalidateQueries({ queryKey: ['notas', eid] })
      void cliente.invalidateQueries({ queryKey: ['produtos', eid] })
      void cliente.invalidateQueries({ queryKey: ['painel', eid] })
      void cliente.invalidateQueries({ queryKey: ['receber', eid] })
      if (n.status === 'autorizada') { setItens([]); setObservacao('') }
    },
  })

  function enviar() {
    const dados = {
      operacao: op, modelo, cliente_id: pessoa?.id, cpf, nome, itens: linhas, tPag, total_cent: total, observacao,
    }
    const v = validarEmissao(dados)
    if (semCsc) v.push('A empresa ainda não tem o CSC cadastrado para emitir NFC-e')
    setErros(v)
    if (v.length === 0) emitir.mutate(montarCorpoEmissao(dados))
  }

  const rotuloNota = modelo === '65' ? 'NFC-e' : 'NF-e'

  return (
    <section className="emissao-rapida">
      <TituloPagina titulo="Emissão" destaque="rápida"
        apoio="Escolha os produtos e o tipo de operação: CFOP, CST e alíquotas vêm prontos do perfil fiscal do produto." />

      {emitida && (emitida.status === 'autorizada' ? (
        <p className="ok" role="status">
          {emitida.modelo === '65' ? 'NFC-e' : 'NF-e'} {emitida.numero} autorizada ({brl(emitida.total_cent)}).{' '}
          <a href={rotaEmpresa(eid, `notas/${emitida.id}/danfe`)} target="_blank" rel="noreferrer">Abrir o DANFE</a>
          {' · '}<a href={rotaEmpresa(eid, `notas/${emitida.id}/xml`)} download>Baixar o XML</a>
          {' · '}<Link to={`/notas/${emitida.id}`}>Ver a nota</Link>
        </p>
      ) : (
        <div className="erro" role="alert">
          {emitida.modelo === '65' ? 'NFC-e' : 'NF-e'} {emitida.numero}: <SeloNota status={emitida.status} />{' '}
          {emitida.c_stat} {emitida.x_motivo}{' · '}<Link to={`/notas/${emitida.id}`}>Ver a nota</Link>
        </div>
      ))}

      <div className="pedido-grade">
        <div className="pedido-principal">
          <section className="cartao" aria-labelledby="t-modelo">
            <h2 id="t-modelo">Modelo</h2>
            <fieldset className="cartoes-modelo sem-borda">
              <legend className="so-leitor">Modelo da nota</legend>
              {MODELOS.map((m) => (
                <label key={m.valor} className={`cartao cartao-tributo cartao-opcao${modelo === m.valor ? ' on' : ''}`}>
                  <input type="radio" name="modelo" value={m.valor} checked={modelo === m.valor} onChange={() => trocarModelo(m.valor)} />
                  <span className="cartao-opcao-texto"><b>{m.rotulo}</b><small>{m.texto}</small></span>
                </label>
              ))}
            </fieldset>
            {semCsc && (
              <p className="erro" role="alert">
                Para emitir NFC-e a empresa precisa do CSC.{' '}
                {pode(eu, 'gerir_empresas') ? <Link to="/configuracoes/empresa">Cadastrar o CSC</Link>
                  : 'Peça ao escritório para cadastrar o CSC em Configurações, Empresa.'}
              </p>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-dest">
            <h2 id="t-dest">{modelo === '55' ? 'Cliente' : 'Consumidor (opcional)'}</h2>
            {modelo === '55' ? (pessoa ? (
              <p className="cliente-escolhido">
                <b>{pessoa.nome}</b><span className="mudo mono"> · {documentoBR(pessoa.cpf_cnpj)} · {pessoa.municipio}/{pessoa.uf}</span>
                <button type="button" className="botao-texto" onClick={() => setPessoa(null)}>Trocar</button>
              </p>
            ) : <BuscaCliente eid={eid} aoEscolher={(p) => { setPessoa(p); setEmitida(null) }} />) : (
              <div className="grade-campos">
                <Campo rotulo="CPF ou CNPJ na nota">
                  {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={cpf}
                    onChange={(e) => setCpf(mascaraDocumento(e.target.value))} />}
                </Campo>
                <Campo rotulo="Nome">
                  {(p) => <input {...p} className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} />}
                </Campo>
              </div>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-oper">
            <h2 id="t-oper">Operação</h2>
            {ops.isPending && <p className="mudo" role="status">Carregando operações…</p>}
            {ops.isError && <p className="erro" role="alert">{mensagemErro(ops.error)}</p>}
            {lista.length > 0 && (
              <fieldset className="cartoes-operacao sem-borda">
                <legend className="so-leitor">Tipo de operação</legend>
                {lista.map((o) => {
                  const ok = cardHabilitado(o, modelo)
                  return (
                    <label key={o.valor} title={ok ? undefined : `Só em ${o.modelos.map((x) => (x === '65' ? 'NFC-e' : 'NF-e')).join(' e ')}`}
                      className={`cartao cartao-tributo cartao-opcao${operacao === o.valor ? ' on' : ''}${ok ? '' : ' desabilitada'}`}>
                      <input type="radio" name="operacao" value={o.valor} checked={operacao === o.valor} disabled={!ok}
                        onChange={() => setOperacao(o.valor)} />
                      <span className="cartao-opcao-texto">
                        <b>{o.rotulo}</b>
                        <small>{o.descricao}</small>
                        <span>{o.cobranca ? <Selo texto="Com cobrança" tom="verde" /> : <Selo texto="Sem cobrança" tom="azul" />}
                          {!ok && <> <Selo texto="Só NF-e" tom="cinza" /></>}</span>
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-prod">
            <h2 id="t-prod">Produtos</h2>
            <BuscaProduto eid={eid} aoEscolher={adicionar} codigoExato rotulo="Buscar produto cadastrado" />
            {itens.length === 0 ? <p className="mudo vazio">Nenhum produto escolhido.</p> : (
              <div className="rolagem espaco-acima">
                <table className="tabela tabela-itens">
                  <thead>
                    <tr>
                      <th scope="col">Produto</th><th scope="col" className="num">Qtd.</th><th scope="col" className="num">Preço (R$)</th>
                      <th scope="col">CFOP</th><th scope="col">CST/CSOSN</th><th scope="col" className="num">Alíq. ICMS</th>
                      <th scope="col" className="num">ICMS</th><th scope="col" className="num">ST</th><th scope="col" className="num">IPI</th>
                      <th scope="col" className="num">Total</th><th scope="col"><span className="so-leitor">Remover</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((i) => {
                      const c = itemCalc(i.produto.id)
                      return (
                        <tr key={i.chave}>
                          <td className="produto"><b className="mono">{i.produto.codigo}</b> {i.produto.descricao}
                            <div className="mudo dica">{i.produto.perfil_nome}</div></td>
                          <td className="num"><input className="entrada mono entrada-num" inputMode="decimal" value={i.quantidade}
                            aria-label={`Quantidade de ${i.produto.descricao}`} onChange={(e) => mudar(i.chave, 'quantidade', e.target.value)} /></td>
                          <td className="num"><input className="entrada mono entrada-num" inputMode="decimal" value={i.valor}
                            aria-label={`Preço de ${i.produto.descricao}`} onChange={(e) => mudar(i.chave, 'valor', e.target.value)} /></td>
                          <td className="mono celula-leitura">{c?.cfop ?? '—'}</td>
                          <td className="mono celula-leitura">{c?.cst_icms ?? '—'}</td>
                          <td className="num celula-leitura">{c ? pct(c.aliq_icms) : '—'}</td>
                          <td className="num celula-leitura">{c ? brl(c.icms_cent) : '—'}</td>
                          <td className="num celula-leitura">{c ? brl(c.icms_st_cent) : '—'}</td>
                          <td className="num celula-leitura">{c ? brl(c.ipi_cent) : '—'}</td>
                          <td className="num">{c ? brl(c.valor_cent) : '—'}</td>
                          <td><button type="button" className="botao-icone" aria-label={`Remover ${i.produto.descricao}`}
                            onClick={() => setItens((a) => a.filter((x) => x.chave !== i.chave))}><Icone nome="lixo" /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {itens.length > 0 && modelo === '55' && !pessoa && (
              <p className="mudo dica">Escolha o cliente para ver CFOP e tributos (o CFOP depende da UF dele).</p>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-obs">
            <h2 id="t-obs">Observação</h2>
            <Campo rotulo="Informações complementares (opcional)">
              {(p) => <textarea {...p} className="entrada" rows={2} maxLength={2000} value={observacao}
                onChange={(e) => setObservacao(e.target.value)} />}
            </Campo>
          </section>
        </div>

        <aside className="pedido-lateral">
          <QuadroResumo totais={calc?.totais} carregando={calculo.isFetching}
            erro={calculo.isError ? mensagemErro(calculo.error) : undefined}
            aviso={op ? `Operação: ${op.rotulo}. Natureza: ${op.natureza}.` : undefined} />
          {op?.cobranca ? (
            <section className="cartao resumo" aria-labelledby="t-pag">
              <h2 id="t-pag">Pagamento</h2>
              <Campo rotulo="Forma de pagamento" dica={total != null ? `Valor: ${brl(total)} (total da nota)` : undefined}>
                {(p) => (
                  <select {...p} className="entrada" value={tPag} onChange={(e) => setTPag(e.target.value)}>
                    {formasEmissao(modelo).map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
                  </select>
                )}
              </Campo>
            </section>
          ) : op ? (
            <p className="mudo dica">Operação sem cobrança: a nota sai sem pagamento (90) e não gera contas a receber.</p>
          ) : null}
          {erros.length > 0 && (
            <div className="erro" role="alert">
              {erros.length === 1 ? erros[0] : <ul className="lista-erros">{erros.map((e) => <li key={e}>{e}</li>)}</ul>}
            </div>
          )}
          {emitir.isError && <p className="erro" role="alert">{mensagemErro(emitir.error)}</p>}
          <button type="button" className="botao largo" disabled={emitir.isPending} onClick={enviar}>
            {emitir.isPending ? `Emitindo ${rotuloNota}…` : 'Emitir'}
          </button>
        </aside>
      </div>
    </section>
  )
}

export function PaginaEmissaoRapida() {
  return <ComEmpresa>{(eid) => <Emissao key={eid} eid={eid} />}</ComEmpresa>
}
