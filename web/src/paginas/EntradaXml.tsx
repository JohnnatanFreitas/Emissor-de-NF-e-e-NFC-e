import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, json, lerTexto, mensagemErro, rotaEmpresa } from '../api'
import { classificacaoPadrao, problemaDataEntrada, problemasClassificacao } from '../classificacao'
import { CamposClassificacao } from '../componentes/CamposClassificacao'
import { brl, centavosParaTexto, chaveBR, cnpjBR, dataBR, hojeISO, numeroParaTexto, quantidade, textoParaCentavos,
  textoParaNumero } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import { type Classificacao, DESTINOS, type ItemLancar, type ItemLeitura, type LeituraXml } from '../tipos'
import { Selo } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { usePerfis } from './Perfis'
import { useProdutos } from './Produtos'

type Escolha = {
  acao: 'vincular' | 'criar' | 'ignorar'; produto_id: string; fator: string
  codigo: string; descricao: string; unidade: string; preco: string; perfil_id: string
}

function escolhaInicial(i: ItemLeitura): Escolha {
  return {
    acao: i.sugestao.acao, produto_id: i.sugestao.produto_id ? String(i.sugestao.produto_id) : '',
    fator: numeroParaTexto(i.sugestao.fator || 1), codigo: i.codigo, descricao: i.descricao, unidade: i.unidade || 'UN',
    preco: '', perfil_id: '',
  }
}

/**
 * Converte as escolhas da tela nos itens do `lancar`; devolve a lista de problemas se houver. Com `classifs`, cada item
 * (inclusive os ignorados no estoque, que continuam escriturados no SPED) leva a sua classificação fiscal.
 */
export function montarItens(itens: ItemLeitura[], escolhas: Record<number, Escolha>,
  classifs?: Record<number, Classificacao>): { itens: ItemLancar[]; problemas: string[] } {
  const problemas: string[] = []
  const estoque = montarEstoque(itens, escolhas, problemas)
  if (!classifs) return { itens: estoque, problemas }
  problemas.push(...problemasClassificacao(itens.map((i) => ({ rotulo: `Item ${i.indice}`, c: classifs[i.indice] }))))
  return { itens: estoque.map((it) => ({ ...it, classificacao: classifs[it.indice] })), problemas }
}

function montarEstoque(itens: ItemLeitura[], escolhas: Record<number, Escolha>, problemas: string[]): ItemLancar[] {
  return itens.map((i): ItemLancar => {
    const e = escolhas[i.indice]
    const fator = textoParaNumero(e.fator) ?? NaN
    const n = `Item ${i.indice}`
    if (e.acao === 'ignorar') return { indice: i.indice, acao: 'ignorar', fator: 1 }
    if (!(fator > 0)) problemas.push(`${n}: fator inválido`)
    if (e.acao === 'vincular') {
      if (!e.produto_id) problemas.push(`${n}: escolha o produto para vincular`)
      return { indice: i.indice, acao: 'vincular', produto_id: Number(e.produto_id), fator }
    }
    const preco = textoParaCentavos(e.preco)
    if (!e.codigo.trim() || !e.descricao.trim()) problemas.push(`${n}: código e descrição do produto novo`)
    if (preco == null || preco < 0) problemas.push(`${n}: preço de venda do produto novo`)
    if (!e.perfil_id) problemas.push(`${n}: perfil fiscal do produto novo`)
    return {
      indice: i.indice, acao: 'criar', fator,
      novo: { codigo: e.codigo.trim(), descricao: e.descricao.trim(), unidade: e.unidade.trim().toUpperCase() || 'UN',
        preco_cent: preco ?? 0, perfil_id: Number(e.perfil_id) },
    }
  })
}

function Entrada({ eid }: { eid: number }) {
  const cliente = useQueryClient()
  const produtos = useProdutos(eid, '', true)
  const perfis = usePerfis(eid)
  const [xml, setXml] = useState('')
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [leitura, setLeitura] = useState<LeituraXml | null>(null)
  const [escolhas, setEscolhas] = useState<Record<number, Escolha>>({})
  const [classifs, setClassifs] = useState<Record<number, Classificacao>>({})
  const [dataEntrada, setDataEntrada] = useState('')
  const [problemas, setProblemas] = useState<string[]>([])
  const [resultado, setResultado] = useState<{ movimentos: number; entrada_id: number; classificada: boolean } | null>(null)

  const ler = useMutation({
    mutationFn: (texto: string) => api<LeituraXml>(rotaEmpresa(eid, 'estoque/entrada-xml/ler'), json('POST', { xml: texto })),
    onMutate: () => { setLeitura(null); setResultado(null); setProblemas([]) },
    onSuccess: (l) => {
      setLeitura(l)
      setEscolhas(Object.fromEntries(l.itens.map((i) => [i.indice, escolhaInicial(i)])))
      setClassifs(Object.fromEntries(l.itens.map((i) => [i.indice, i.classificacao ?? classificacaoPadrao()])))
      setDataEntrada(l.data_entrada_sugerida ?? hojeISO())
    },
  })
  const lancar = useMutation({
    mutationFn: (itens: ItemLancar[]) => api<{ entrada_id: number; movimentos: number; fornecedor_id: number; classificada?: boolean }>(
      rotaEmpresa(eid, 'estoque/entrada-xml/lancar'), json('POST', { xml, itens, data_entrada: dataEntrada })),
    onSuccess: (r) => {
      setResultado({ movimentos: r.movimentos, entrada_id: r.entrada_id, classificada: r.classificada !== false })
      setLeitura(null)
      for (const k of ['estoque', 'produtos', 'movimentos', 'pessoas', 'painel', 'entradas']) {
        void cliente.invalidateQueries({ queryKey: [k, eid] })
      }
    },
  })

  async function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return
    setNomeArquivo(arquivo.name)
    const texto = await lerTexto(arquivo)
    setXml(texto)
    ler.mutate(texto)
  }

  const mudar = (indice: number, k: keyof Escolha, v: string) =>
    setEscolhas((a) => ({ ...a, [indice]: { ...a[indice], [k]: v } }))

  function confirmar() {
    if (!leitura) return
    const r = montarItens(leitura.itens, escolhas, classifs)
    const pData = problemaDataEntrada(dataEntrada, leitura.emitida_em)
    if (pData) r.problemas.unshift(pData)
    setProblemas(r.problemas)
    if (r.problemas.length === 0) lancar.mutate(r.itens)
  }

  return (
    <section className="entrada-xml">
      <TituloPagina titulo="Entrada por" destaque="XML" migalhas={[{ rotulo: 'Estoque', para: '/estoque' }, { rotulo: 'Entrada por XML' }]}
        apoio="O custo médio é recalculado com IPI, ST e frete. Na próxima nota do mesmo fornecedor, o vínculo e a classificação fiscal já vêm sugeridos." />
      <div className="cartao formulario-estreito">
        <label className="zona-arquivos" style={{ display: 'block' }}>
          <span className="campo-rotulo-forte">XML da nota do fornecedor</span><br />
          <input type="file" accept=".xml,text/xml,application/xml" onChange={(e) => void escolherArquivo(e.target.files?.[0])} />
          {nomeArquivo && <p className="mudo dica">{nomeArquivo}</p>}
        </label>
        {ler.isPending && <p className="mudo" role="status">Lendo o XML…</p>}
        {ler.isError && <p className="erro" role="alert">{mensagemErro(ler.error)}</p>}
      </div>

      {resultado && (
        <p className="ok espaco-acima" role="status">Entrada lançada: {resultado.movimentos} movimento(s) no estoque
          {resultado.classificada ? ' e classificação fiscal conferida.' : '.'}{' '}
          <Link to="/estoque/movimentos">Ver movimentos</Link>{' · '}
          <Link to={`/estoque/entradas/${resultado.entrada_id}`}>Ver a classificação</Link></p>
      )}

      {leitura && (
        <div className="blocos-largos espaco-acima">
          <section className="bloco" aria-labelledby="t-nota-forn">
            <h2 id="t-nota-forn">Nota {leitura.serie}-{leitura.numero}</h2>
            {leitura.ja_lancada && <p className="erro" role="alert">Esta nota já foi lançada no estoque.</p>}
            {leitura.destinatario_confere === false && (
              <p className="erro" role="alert">O destinatário desta nota não é a empresa selecionada. Confira se escolheu o XML certo.</p>
            )}
            <dl className="dados-cert">
              <div><dt>Fornecedor</dt><dd>{leitura.fornecedor.nome}</dd></div>
              <div><dt>CNPJ</dt><dd className="mono">{cnpjBR(leitura.fornecedor.cnpj)} · {leitura.fornecedor.uf}</dd></div>
              <div><dt>Cadastro</dt><dd>{leitura.fornecedor.pessoa_id
                ? <Selo texto="Fornecedor já cadastrado" tom="verde" /> : <Selo texto="Será cadastrado" tom="azul" />}</dd></div>
              <div><dt>Emissão</dt><dd>{dataBR(leitura.emitida_em)}</dd></div>
              <div><dt>Total da nota</dt><dd className="mono">{brl(leitura.total_cent)}</dd></div>
              <div><dt>Frete</dt><dd className="mono">{brl(leitura.frete_cent)}</dd></div>
              <div><dt>Chave</dt><dd className="mono">{chaveBR(leitura.chave)}</dd></div>
            </dl>
            <div className="grade-campos">
              <div className="campo">
                <label htmlFor="xml-data-entrada"><span>Data de entrada</span></label>
                <input id="xml-data-entrada" type="date" className="entrada" value={dataEntrada} min={leitura.emitida_em.slice(0, 10)}
                  max={hojeISO()} aria-describedby="xml-data-entrada-dica" onChange={(e) => setDataEntrada(e.target.value)} />
                <small id="xml-data-entrada-dica" className="mudo dica">Decide o mês do SPED em que a nota é escriturada.</small>
              </div>
            </div>
          </section>

          <section className="bloco" aria-labelledby="t-itens-xml">
            <h2 id="t-itens-xml">Itens</h2>
            <p className="mudo dica">Fator: quantas unidades suas vêm em 1 unidade do fornecedor (caixa com 12 = 12).
              Classificação fiscal: o destino define o CFOP de entrada, o CST e o crédito levados ao SPED.</p>
            <p className="aviso">Itens marcados como <b>Não lançar</b> ficam fora do estoque, mas continuam escriturados no SPED
              (ex.: material de uso e consumo). Classifique também esses itens.</p>
            <div className="rolagem">
              <table className="tabela tabela-itens">
                <thead>
                  <tr><th scope="col">Item do fornecedor</th><th scope="col" className="num">Qtd.</th>
                    <th scope="col" className="num">Custo total</th><th scope="col">O que fazer</th><th scope="col">Produto</th>
                    <th scope="col" className="num">Fator</th><th scope="col">Classificação fiscal (SPED)</th></tr>
                </thead>
                <tbody>
                  {leitura.itens.map((i) => {
                    const e = escolhas[i.indice]
                    if (!e) return null
                    return (
                      <tr key={i.indice}>
                        <td className="produto"><b className="mono">{i.codigo}</b> {i.descricao}
                          <div className="mudo dica">NCM {i.ncm}{i.ean ? ` · EAN ${i.ean}` : ''} · {brl(i.valor_unitario_cent)}/{i.unidade}</div></td>
                        <td className="num">{quantidade(i.quantidade)} {i.unidade}</td>
                        <td className="num" title="Produto + IPI + ST + frete − desconto">{brl(i.custo_total_cent)}</td>
                        <td>
                          <select className="entrada" aria-label={`O que fazer com o item ${i.indice}`} value={e.acao}
                            onChange={(ev) => mudar(i.indice, 'acao', ev.target.value)}>
                            <option value="vincular">Vincular a produto</option>
                            <option value="criar">Criar produto novo</option>
                            <option value="ignorar">Não lançar</option>
                          </select>
                        </td>
                        <td>
                          {e.acao === 'vincular' && (
                            <select className="entrada" aria-label={`Produto para o item ${i.indice}`} value={e.produto_id}
                              onChange={(ev) => mudar(i.indice, 'produto_id', ev.target.value)}>
                              <option value="">Selecione</option>
                              {(produtos.data ?? []).map((p) => <option key={p.id} value={String(p.id)}>{p.codigo} — {p.descricao}</option>)}
                            </select>
                          )}
                          {e.acao === 'criar' && (
                            <div className="novo-produto">
                              <input className="entrada mono" aria-label="Código" placeholder="Código" value={e.codigo}
                                onChange={(ev) => mudar(i.indice, 'codigo', ev.target.value)} />
                              <input className="entrada" aria-label="Descrição" placeholder="Descrição" value={e.descricao}
                                onChange={(ev) => mudar(i.indice, 'descricao', ev.target.value)} />
                              <input className="entrada mono" aria-label="Unidade" placeholder="UN" value={e.unidade}
                                onChange={(ev) => mudar(i.indice, 'unidade', ev.target.value)} />
                              <input className="entrada mono" aria-label="Preço de venda" inputMode="decimal"
                                placeholder={`Preço (custo ${centavosParaTexto(Math.round(i.custo_total_cent / Math.max(i.quantidade * (textoParaNumero(e.fator) || 1), 1)))})`}
                                value={e.preco} onChange={(ev) => mudar(i.indice, 'preco', ev.target.value)} />
                              <select className="entrada" aria-label="Perfil fiscal" value={e.perfil_id}
                                onChange={(ev) => mudar(i.indice, 'perfil_id', ev.target.value)}>
                                <option value="">Perfil fiscal</option>
                                {(perfis.data ?? []).filter((p) => p.ativo).map((p) => <option key={p.id} value={String(p.id)}>{p.nome}</option>)}
                              </select>
                            </div>
                          )}
                          {e.acao === 'ignorar' && <span className="mudo">Fica fora do estoque, mas é escriturado no SPED</span>}
                        </td>
                        <td className="num">
                          {e.acao !== 'ignorar' && (
                            <input className="entrada mono entrada-num" inputMode="decimal" aria-label={`Fator do item ${i.indice}`}
                              value={e.fator} onChange={(ev) => mudar(i.indice, 'fator', ev.target.value)} />
                          )}
                        </td>
                        <td>
                          {classifs[i.indice] && (
                            <CamposClassificacao item={`item ${i.indice}`} valor={classifs[i.indice]} destinos={DESTINOS}
                              comSt={i.icms_st_cent > 0} temIpi={i.ipi_cent > 0}
                              mudar={(c) => setClassifs((a) => ({ ...a, [i.indice]: c }))} />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {problemas.length > 0 && <ul className="erro lista-erros" role="alert">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
            {lancar.isError && <p className="erro" role="alert">{mensagemErro(lancar.error)}</p>}
            <div className="acoes-form">
              <button type="button" className="botao" disabled={lancar.isPending || leitura.ja_lancada} onClick={confirmar}>
                {lancar.isPending ? 'Lançando…' : 'Lançar no estoque'}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export function PaginaEntradaXml() {
  return <ComEmpresa>{(eid) => <Entrada key={eid} eid={eid} />}</ComEmpresa>
}
