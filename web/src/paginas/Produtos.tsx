import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, json, mensagemErro, pode, qs, rotaEmpresa, useEu } from '../api'
import { brl, centavosParaTexto, numeroParaTexto, quantidade, soDigitos, textoParaCentavos, textoParaNumero } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { Produto, ProdutoEntrada } from '../tipos'
import { Campo, Marcar } from '../ui/Campo'
import { Icone } from '../ui/Icone'
import { Selo } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'
import { usePerfis } from './Perfis'

/** Texto digitado com espera (para não consultar a cada tecla). */
export function useAdiado<T>(valor: T, ms = 300) {
  const [v, setV] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return v
}

export function useProdutos(eid: number, busca = '', ativos = false) {
  return useQuery({
    queryKey: ['produtos', eid, busca, ativos],
    queryFn: () => api<Produto[]>(rotaEmpresa(eid, `produtos${qs({ busca, ativos })}`)),
    placeholderData: keepPreviousData,
  })
}

function Lista({ eid }: { eid: number }) {
  const { data: eu } = useEu()
  const editar = pode(eu, 'editar_produtos')
  const [busca, setBusca] = useState('')
  const [soAtivos, setSoAtivos] = useState(true)
  const termo = useAdiado(busca.trim())
  const q = useProdutos(eid, termo, soAtivos)
  return (
    <section className="produtos">
      <TituloPagina titulo="Produtos" acoes={editar && <Link to="/produtos/novo" className="botao"><Icone nome="mais" />Novo produto</Link>} />
      <div className="ferramentas">
        <div className="busca" role="search">
          <input type="search" className="entrada" aria-label="Buscar produto" placeholder="Código, descrição, NCM ou EAN"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Marcar rotulo="Só ativos" marcado={soAtivos} mudar={setSoAtivos} />
      </div>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhum produto encontrado</p>}
      {q.data && q.data.length > 0 && (
        <div className="cartao rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Código</th><th scope="col">Descrição</th><th scope="col">NCM</th><th scope="col">Un.</th>
                <th scope="col" className="num">Preço</th><th scope="col" className="num">Estoque</th>
                <th scope="col" className="num">Custo médio</th><th scope="col">Perfil fiscal</th><th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{editar ? <Link to={`/produtos/${p.id}`}>{p.codigo}</Link> : p.codigo}</td>
                  <td className="produto">{p.descricao}</td>
                  <td className="mono">{p.ncm}</td>
                  <td>{p.unidade}</td>
                  <td className="num">{brl(p.preco_cent)}</td>
                  <td className="num">
                    {p.estoque <= p.estoque_minimo
                      ? <span className="selo selo-st st-laranja" title="No estoque mínimo ou abaixo">{quantidade(p.estoque)}</span>
                      : quantidade(p.estoque)}
                  </td>
                  <td className="num">{brl(p.custo_medio_cent)}</td>
                  <td>{p.perfil_nome}</td>
                  <td>{p.ativo ? <Selo texto="Ativo" tom="verde" /> : <Selo texto="Inativo" tom="cinza" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type FormProduto = {
  codigo: string; descricao: string; ncm: string; cest: string; ean: string; unidade: string; preco: string
  perfil_id: string; estoque_minimo: string; ativo: boolean
}

function formDoProduto(p?: Produto): FormProduto {
  return {
    codigo: p?.codigo ?? '', descricao: p?.descricao ?? '', ncm: p?.ncm ?? '', cest: p?.cest ?? '', ean: p?.ean ?? '',
    unidade: p?.unidade ?? 'UN', preco: p ? centavosParaTexto(p.preco_cent) : '', perfil_id: p ? String(p.perfil_id) : '',
    estoque_minimo: p ? numeroParaTexto(p.estoque_minimo) : '0', ativo: p?.ativo ?? true,
  }
}

export function validarProduto(f: FormProduto) {
  const e: Partial<Record<keyof FormProduto, string>> = {}
  if (!f.codigo.trim()) e.codigo = 'Informe o código'
  if (!f.descricao.trim()) e.descricao = 'Informe a descrição'
  if (!/^\d{8}$/.test(soDigitos(f.ncm))) e.ncm = 'NCM com 8 dígitos'
  if (f.cest.trim() && !/^\d{7}$/.test(soDigitos(f.cest))) e.cest = 'CEST com 7 dígitos'
  if (!f.unidade.trim()) e.unidade = 'Informe a unidade'
  const preco = textoParaCentavos(f.preco)
  if (preco == null || preco < 0) e.preco = 'Preço inválido'
  if (!f.perfil_id) e.perfil_id = 'Escolha o perfil fiscal'
  const min = textoParaNumero(f.estoque_minimo || '0')
  if (min == null || min < 0) e.estoque_minimo = 'Número inválido'
  return e
}

function Formulario({ eid, id }: { eid: number; id: number | null }) {
  const lista = useProdutos(eid)
  const existente = id != null ? lista.data?.find((p) => p.id === id) : undefined
  if (id != null && lista.isPending) return <p className="mudo" role="status">Carregando…</p>
  if (id != null && lista.isError) return <p className="erro" role="alert">{mensagemErro(lista.error)}</p>
  if (id != null && !existente) return <p className="erro" role="alert">Produto não encontrado nesta empresa.</p>
  return <FormProdutoEdicao eid={eid} id={id} inicial={formDoProduto(existente)} />
}

function FormProdutoEdicao({ eid, id, inicial }: { eid: number; id: number | null; inicial: FormProduto }) {
  const navegar = useNavigate()
  const cliente = useQueryClient()
  const perfis = usePerfis(eid)
  const [f, setF] = useState(inicial)
  const [erros, setErros] = useState<Partial<Record<keyof FormProduto, string>>>({})
  const m = (k: keyof FormProduto) => (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value }))

  const salvar = useMutation({
    mutationFn: (corpo: ProdutoEntrada) => id == null
      ? api<Produto>(rotaEmpresa(eid, 'produtos'), json('POST', corpo))
      : api<Produto>(rotaEmpresa(eid, `produtos/${id}`), json('PUT', corpo)),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['produtos', eid] })
      navegar('/produtos')
    },
  })

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    const v = validarProduto(f)
    setErros(v)
    if (Object.keys(v).length) return
    salvar.mutate({
      codigo: f.codigo.trim(), descricao: f.descricao.trim(), ncm: soDigitos(f.ncm), cest: soDigitos(f.cest) || undefined,
      ean: f.ean.trim() || undefined, unidade: f.unidade.trim().toUpperCase(), preco_cent: textoParaCentavos(f.preco)!,
      perfil_id: Number(f.perfil_id), estoque_minimo: textoParaNumero(f.estoque_minimo || '0')!, ativo: f.ativo,
    })
  }

  return (
    <section className="produto-form">
      <TituloPagina titulo={id == null ? 'Novo' : 'Produto'} destaque={id == null ? 'produto' : inicial.codigo}
        migalhas={[{ rotulo: 'Produtos', para: '/produtos' }, { rotulo: id == null ? 'Novo produto' : inicial.descricao }]} />
      <form className="cartao formulario" onSubmit={enviar} noValidate>
        <div className="grade-campos">
          <Campo rotulo="Código" erro={erros.codigo}>
            {(p) => <input {...p} className="entrada mono" value={f.codigo} onChange={m('codigo')} />}
          </Campo>
          <Campo rotulo="Descrição" erro={erros.descricao} largo>
            {(p) => <input {...p} className="entrada" maxLength={120} value={f.descricao} onChange={m('descricao')} />}
          </Campo>
          <Campo rotulo="NCM" erro={erros.ncm} dica="8 dígitos">
            {(p) => <input {...p} className="entrada mono" inputMode="numeric" maxLength={10} value={f.ncm} onChange={m('ncm')} />}
          </Campo>
          <Campo rotulo="CEST" erro={erros.cest} dica="Obrigatório em produtos com ST">
            {(p) => <input {...p} className="entrada mono" inputMode="numeric" maxLength={9} value={f.cest} onChange={m('cest')} />}
          </Campo>
          <Campo rotulo="EAN (código de barras)">
            {(p) => <input {...p} className="entrada mono" inputMode="numeric" value={f.ean} onChange={m('ean')} />}
          </Campo>
          <Campo rotulo="Unidade" erro={erros.unidade}>
            {(p) => <input {...p} className="entrada mono" maxLength={6} value={f.unidade} onChange={m('unidade')} list="unidades" />}
          </Campo>
          <Campo rotulo="Preço de venda (R$)" erro={erros.preco}>
            {(p) => <input {...p} className="entrada mono" inputMode="decimal" value={f.preco} placeholder="0,00" onChange={m('preco')} />}
          </Campo>
          <Campo rotulo="Perfil fiscal" erro={erros.perfil_id ?? (perfis.isError ? mensagemErro(perfis.error) : undefined)}>
            {(p) => (
              <select {...p} className="entrada" value={f.perfil_id} onChange={m('perfil_id')}>
                <option value="">Selecione</option>
                {(perfis.data ?? []).filter((x) => x.ativo || String(x.id) === f.perfil_id)
                  .map((x) => <option key={x.id} value={String(x.id)}>{x.nome}</option>)}
              </select>
            )}
          </Campo>
          <Campo rotulo="Estoque mínimo" erro={erros.estoque_minimo}>
            {(p) => <input {...p} className="entrada mono" inputMode="decimal" value={f.estoque_minimo} onChange={m('estoque_minimo')} />}
          </Campo>
          <div className="campo campo-caixa"><Marcar rotulo="Ativo" marcado={f.ativo} mudar={(v) => setF((a) => ({ ...a, ativo: v }))} /></div>
        </div>
        <datalist id="unidades">{['UN', 'CX', 'KG', 'LT', 'MT', 'PC', 'PCT', 'M2', 'M3', 'DZ'].map((u) => <option key={u} value={u} />)}</datalist>
        {Object.keys(erros).length > 0 && <p className="erro" role="alert">Confira os campos destacados.</p>}
        {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
        <div className="acoes-form">
          <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar produto'}</button>
          <Link to="/produtos" className="botao sec">Cancelar</Link>
        </div>
      </form>
    </section>
  )
}

export function PaginaProdutos() {
  return <ComEmpresa>{(eid) => <Lista key={eid} eid={eid} />}</ComEmpresa>
}

export function PaginaProduto() {
  const { id } = useParams()
  const n = id && id !== 'novo' ? Number(id) : null
  return <ComEmpresa>{(eid) => <Formulario key={`${eid}-${id}`} eid={eid} id={n} />}</ComEmpresa>
}
