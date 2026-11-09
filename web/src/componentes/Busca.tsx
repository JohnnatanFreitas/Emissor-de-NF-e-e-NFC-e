import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react'
import { brl, documentoBR, quantidade } from '../formato'
import type { Pessoa, Produto } from '../tipos'
import { useAdiado, useProdutos } from '../paginas/Produtos'
import { usePessoas } from '../paginas/Pessoas'

/** Caixa de busca com lista de resultados (combobox ARIA): setas, Enter escolhe, Escape fecha. */
export function Combobox<T>({ rotulo, placeholder, texto, setTexto, itens, carregando, erro, chave, conteudo, aoEscolher,
  aoEnterSemLista, entradaRef, autoFocus }: {
  rotulo: string; placeholder?: string; texto: string; setTexto: (t: string) => void; itens: T[]; carregando?: boolean
  erro?: string; chave: (i: T) => string | number; conteudo: (i: T) => ReactNode; aoEscolher: (i: T) => void
  aoEnterSemLista?: () => void; entradaRef?: Ref<HTMLInputElement>; autoFocus?: boolean
}) {
  const [aberta, setAberta] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const caixa = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => setAtivo(0), [itens])
  useEffect(() => {
    if (!aberta) return
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberta(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberta])

  const mostrar = aberta && texto.trim().length > 0

  function escolher(i: T) {
    aoEscolher(i)
    setAberta(false)
  }

  function teclas(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setAberta(true); setAtivo((i) => Math.min(i + 1, itens.length - 1)) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)) }
    else if (ev.key === 'Enter') {
      ev.preventDefault()
      const i = itens[ativo]
      if (mostrar && i) escolher(i)
      else aoEnterSemLista?.()
    } else if (ev.key === 'Escape') {
      if (aberta) ev.stopPropagation()
      setAberta(false)
    }
  }

  return (
    <div className="seletor busca-combo" ref={caixa}>
      <input ref={entradaRef} type="search" className="entrada" role="combobox" autoComplete="off" spellCheck={false}
        aria-label={rotulo} placeholder={placeholder} aria-autocomplete="list" aria-expanded={mostrar}
        aria-controls={`${id}-lista`} autoFocus={autoFocus}
        aria-activedescendant={mostrar && itens[ativo] ? `${id}-${chave(itens[ativo])}` : undefined}
        value={texto} onKeyDown={teclas} onChange={(e) => { setTexto(e.target.value); setAberta(true) }}
        onFocus={() => setAberta(true)} />
      {mostrar && (
        <div className="popover popover-busca">
          {erro && <p className="erro" role="alert">{erro}</p>}
          {!erro && carregando && itens.length === 0 && <p className="mudo" role="status">Buscando…</p>}
          {!erro && !carregando && itens.length === 0 && <p className="mudo" role="status">Nada encontrado</p>}
          <ul role="listbox" id={`${id}-lista`} aria-label={rotulo} className="lista-opcoes">
            {itens.map((i, n) => (
              <li key={chave(i)} id={`${id}-${chave(i)}`} role="option" aria-selected={n === ativo}
                className={n === ativo ? 'ativa' : undefined} onMouseEnter={() => setAtivo(n)}
                onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(i)}>
                {conteudo(i)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Busca de produto ativo por código, descrição ou EAN. `aoEscolher` recebe o produto; o campo se limpa. */
export function BuscaProduto({ eid, aoEscolher, rotulo = 'Adicionar produto', entradaRef, autoFocus, codigoExato }: {
  eid: number; aoEscolher: (p: Produto) => void; rotulo?: string; entradaRef?: Ref<HTMLInputElement>; autoFocus?: boolean
  /** Enter com o código ou EAN exato adiciona direto (leitor de código de barras). */
  codigoExato?: boolean
}) {
  const [texto, setTexto] = useState('')
  const termo = useAdiado(texto.trim(), 250)
  const q = useProdutos(eid, termo, true)
  const itens = termo ? (q.data ?? []).slice(0, 12) : []
  function escolher(p: Produto) {
    aoEscolher(p)
    setTexto('')
  }
  function enterDireto() {
    if (!codigoExato) return
    const t = texto.trim()
    const p = (q.data ?? []).find((x) => x.codigo === t || x.ean === t)
    if (p && termo === t) escolher(p)
  }
  return (
    <Combobox rotulo={rotulo} placeholder="Código, descrição ou código de barras" texto={texto} setTexto={setTexto}
      itens={itens} carregando={q.isFetching} erro={q.isError ? q.error.message : undefined} chave={(p) => p.id}
      aoEscolher={escolher} aoEnterSemLista={enterDireto} entradaRef={entradaRef} autoFocus={autoFocus}
      conteudo={(p) => (
        <>
          <span><b className="mono">{p.codigo}</b> {p.descricao}</span>
          <small>{brl(p.preco_cent)} · estoque {quantidade(p.estoque)} {p.unidade}</small>
        </>
      )} />
  )
}

/** Busca de cliente (tipo cliente) por nome ou CPF/CNPJ. */
export function BuscaCliente({ eid, aoEscolher }: { eid: number; aoEscolher: (p: Pessoa) => void }) {
  const [texto, setTexto] = useState('')
  const termo = useAdiado(texto.trim(), 250)
  const q = usePessoas(eid, 'cliente', termo)
  const itens = termo ? (q.data ?? []).filter((p) => p.ativo).slice(0, 12) : []
  return (
    <Combobox rotulo="Buscar cliente" placeholder="Nome ou CPF/CNPJ do cliente" texto={texto} setTexto={setTexto}
      itens={itens} carregando={q.isFetching} erro={q.isError ? q.error.message : undefined} chave={(p) => p.id}
      aoEscolher={(p) => { aoEscolher(p); setTexto('') }}
      conteudo={(p) => (
        <>
          <span>{p.nome}</span>
          <small>{documentoBR(p.cpf_cnpj)} · {p.municipio}/{p.uf}</small>
        </>
      )} />
  )
}
