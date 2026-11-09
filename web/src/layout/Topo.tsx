import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useEmpresa } from '../empresa'
import { cnpjBR } from '../formato'
import { type Tema, useTema } from '../tema'
import { type Eu, ROTULO_PAPEL } from '../tipos'

/** Fecha um popover ao clicar fora dele ou ao apertar Escape (devolvendo o foco ao botão que o abriu). */
export function useFecharFora(aberto: boolean, fechar: () => void, caixa: RefObject<HTMLElement>,
  botao: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar()
    }
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        fechar()
        botao.current?.focus()
      }
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto, fechar, caixa, botao])
}

function IconeTema({ tema }: { tema: Tema }) {
  // Sol no tema escuro (vai para o claro), lua no claro (vai para o escuro).
  return tema === 'escuro' ? (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function BotaoTema() {
  const { efetivo, definir } = useTema()
  const novo: Tema = efetivo === 'escuro' ? 'claro' : 'escuro'
  return (
    <button type="button" className="botao-icone" aria-label={`Mudar para o tema ${novo}`}
      title={`Mudar para o tema ${novo}`} onClick={() => definir(novo)}>
      <IconeTema tema={efetivo} />
    </button>
  )
}

export function iniciais(nome: string) {
  const primeira = (w: string) => w.match(/\p{L}/u)?.[0] ?? ''
  const p = nome.split(/\s+/).filter((w) => primeira(w))
  return ((p[0] ? primeira(p[0]) : '') + (p.length > 1 ? primeira(p[p.length - 1]) : '')).toUpperCase()
}

/** Seletor da empresa da carteira: botão no topo que abre a lista com busca por nome ou CNPJ. */
export function SeletorEmpresa() {
  const { lista, atual, definir, carregando } = useEmpresa()
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const caixa = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const fechar = useRef(() => setAberto(false)).current
  useFecharFora(aberto, fechar, caixa, botao)
  const id = useId()
  const navegar = useNavigate()

  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const digitos = busca.replace(/\D/g, '')
  const filtradas = lista.filter((e) => !termo || e.razao_social.toLocaleLowerCase('pt-BR').includes(termo)
    || (e.nome_fantasia ?? '').toLocaleLowerCase('pt-BR').includes(termo) || (digitos !== '' && e.cnpj.includes(digitos)))

  useEffect(() => setAtivo(0), [busca, aberto])

  function escolher(eid: number) {
    definir(eid)
    setAberto(false)
    setBusca('')
    botao.current?.focus()
  }

  function teclas(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setAtivo((i) => Math.min(i + 1, filtradas.length - 1)) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)) }
    else if (ev.key === 'Enter') { ev.preventDefault(); const e = filtradas[ativo]; if (e) escolher(e.id) }
  }

  if (carregando) return <span className="campo-topo mudo">Carregando empresas…</span>
  if (lista.length === 0) {
    return (
      <button type="button" className="campo-topo" onClick={() => navegar('/empresas/nova')}>
        <span className="campo-rotulo">Empresa</span><span className="campo-valor">Nenhuma cadastrada</span>
      </button>
    )
  }
  return (
    <div className="seletor" ref={caixa}>
      <button ref={botao} type="button" className="campo-topo" aria-haspopup="listbox" aria-expanded={aberto}
        aria-label={`Empresa selecionada: ${atual?.razao_social ?? 'nenhuma'}. Trocar empresa`}
        onClick={() => setAberto((a) => !a)}>
        <span className="campo-rotulo">Empresa</span>
        <span className="campo-valor contexto-empresa">{atual?.nome_fantasia || atual?.razao_social}</span>
        <span aria-hidden="true" className="seta">▾</span>
      </button>
      {aberto && (
        <div className="popover popover-empresa">
          <input type="search" className="entrada" autoFocus placeholder="Nome ou CNPJ" aria-label="Buscar empresa"
            role="combobox" aria-expanded="true" aria-controls={`${id}-lista`} value={busca}
            aria-activedescendant={filtradas[ativo] ? `${id}-${filtradas[ativo].id}` : undefined}
            onChange={(e) => setBusca(e.target.value)} onKeyDown={teclas} />
          {filtradas.length === 0 && <p className="mudo" role="status">Nenhuma empresa encontrada</p>}
          <ul role="listbox" id={`${id}-lista`} aria-label="Empresas da carteira" className="lista-opcoes">
            {filtradas.map((e, i) => (
              <li key={e.id} id={`${id}-${e.id}`} role="option" aria-selected={e.id === atual?.id}
                className={i === ativo ? 'ativa' : undefined} onMouseEnter={() => setAtivo(i)}
                onMouseDown={(ev) => ev.preventDefault()} onClick={() => escolher(e.id)}>
                <span>{e.razao_social}</span>
                <small>{cnpjBR(e.cnpj)} · {e.uf} · {e.ambiente === 1 ? 'Produção' : 'Homologação'}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function MenuUsuario({ eu }: { eu: Eu }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const fechar = useRef(() => setAberto(false)).current
  useFecharFora(aberto, fechar, caixa, botao)
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const sair = useMutation({
    mutationFn: () => api<void>('/api/sessao', { method: 'DELETE' }),
    onSuccess: () => {
      navegar('/login', { replace: true })
      cliente.clear()
    },
  })
  return (
    <div className="seletor" ref={caixa}>
      <button ref={botao} type="button" className="usuario-botao" aria-haspopup="menu" aria-expanded={aberto}
        aria-label={`Menu do usuário ${eu.nome}`} onClick={() => setAberto((a) => !a)}>
        <span className="avatar" aria-hidden="true">{iniciais(eu.nome)}</span>
        <span className="usuario-texto" aria-hidden="true">
          <span className="usuario-ola">Olá, {eu.nome.split(' ')[0]}</span>
          <span className="usuario-funcao">{ROTULO_PAPEL[eu.papel] ?? eu.papel}</span>
        </span>
        <span aria-hidden="true" className="seta">▾</span>
      </button>
      {aberto && (
        <div className="popover popover-usuario">
          <p className="mudo">{eu.email} · {ROTULO_PAPEL[eu.papel] ?? eu.papel}</p>
          <div role="menu" aria-label="Usuário">
            <button type="button" role="menuitem" className="item-menu" autoFocus
              onClick={() => { setAberto(false); navegar('/configuracoes/senha') }}>Minha senha</button>
            <button type="button" role="menuitem" className="item-menu" disabled={sair.isPending}
              onClick={() => sair.mutate()}>Sair</button>
          </div>
          {sair.isError && <p className="erro" role="alert">{sair.error.message}</p>}
        </div>
      )}
    </div>
  )
}

export function Topo({ eu, gaveta, alternarGaveta, botaoMenu, recolhido, alternarRecolhido, controla }: {
  eu: Eu; gaveta: boolean; alternarGaveta: () => void; botaoMenu?: RefObject<HTMLButtonElement>; recolhido: boolean
  alternarRecolhido: () => void; controla: string
}) {
  return (
    <header className="topo">
      <button type="button" ref={botaoMenu} className="botao-icone so-estreito" aria-expanded={gaveta}
        aria-controls={controla} aria-label={gaveta ? 'Fechar menu' : 'Abrir menu'} onClick={alternarGaveta}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="botao-icone so-largo" aria-controls={controla} aria-expanded={!recolhido}
        aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'} onClick={alternarRecolhido}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 4h16v16H4zM9 4v16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </button>
      <SeletorEmpresa />
      <div className="topo-dir">
        <BotaoTema />
        <MenuUsuario eu={eu} />
      </div>
    </header>
  )
}
