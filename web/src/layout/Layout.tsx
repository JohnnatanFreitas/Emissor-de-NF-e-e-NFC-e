import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { ErroApi, pode, useEu } from '../api'
import { EmpresaProvider, useEmpresa } from '../empresa'
import { TrocarSenha } from '../paginas/TrocarSenha'
import { Icone } from '../ui/Icone'
import { Menu } from './Menu'
import { Topo } from './Topo'
import { useMedia } from './useMedia'

const ID_MENU = 'menu-lateral'
const CHAVE_MENU = 'argus-emissor.menu'
const LARGO = '(min-width: 900px)'
const TABLET = '(min-width: 900px) and (max-width: 1199.98px)'

function lerRecolhido() {
  try { return localStorage.getItem(CHAVE_MENU) === 'recolhido' } catch { return false }
}

/** Faixa amarela: a empresa selecionada está em homologação (ambiente 2), nada emitido tem valor fiscal. */
export function FaixaHomologacao() {
  const { atual } = useEmpresa()
  if (!atual || atual.ambiente !== 2) return null
  return (
    <div className="faixa-homologacao" role="status">
      <Icone nome="alerta" tamanho={16} />
      <span><b>HOMOLOGAÇÃO</b> — {atual.razao_social} está em ambiente de testes. As notas emitidas aqui não têm valor fiscal.</span>
    </div>
  )
}

/** Casca das páginas logadas: menu lateral (gaveta abaixo de 900 px), barra do topo, faixa de homologação e conteúdo. */
export function Layout() {
  const eu = useEu()
  const [gaveta, setGaveta] = useState(false)
  const [recolhido, setRecolhido] = useState(lerRecolhido)
  const tablet = useMedia(TABLET)
  const largo = useMedia(LARGO)
  const botaoMenu = useRef<HTMLButtonElement>(null)
  const principal = useRef<HTMLDivElement>(null)
  const [expandidoNoTablet, setExpandidoNoTablet] = useState(false)
  const recolhidoEfetivo = tablet ? !expandidoNoTablet : recolhido
  const { pathname } = useLocation()

  useEffect(() => setGaveta(false), [pathname])

  function alternarRecolhido() {
    if (tablet) { setExpandidoNoTablet((e) => !e); return }
    const novo = !recolhido
    setRecolhido(novo)
    try { localStorage.setItem(CHAVE_MENU, novo ? 'recolhido' : 'aberto') } catch { /* só nesta visita */ }
  }

  const fecharGaveta = useCallback((devolverFoco: boolean) => {
    setGaveta(false)
    if (devolverFoco) botaoMenu.current?.focus()
  }, [])

  useEffect(() => {
    if (!gaveta) return
    document.querySelector<HTMLElement>(`#${ID_MENU} a`)?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharGaveta(true)
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [gaveta, fecharGaveta])

  useEffect(() => {
    const el = principal.current
    if (!el) return
    if (gaveta) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
    return () => el.removeAttribute('inert')
  }, [gaveta])

  useEffect(() => {
    if (largo) setGaveta(false)
  }, [largo])

  if (eu.isPending) return <p className="carregando" role="status">Carregando…</p>
  if (eu.isError) {
    if (eu.error instanceof ErroApi && eu.error.status === 401) {
      return <p className="carregando" role="status">Indo para a tela de entrada…</p>
    }
    return (
      <div className="carregando">
        <section className="cartao" role="alert">
          <h1>Não foi possível carregar o Argus Emissor</h1>
          <p>{eu.error.message}</p>
          <button type="button" className="botao" onClick={() => eu.refetch()}>Tentar de novo</button>
        </section>
      </div>
    )
  }

  // Senha provisória: só a tela de troca, até o servidor dizer trocar_senha = false.
  if (eu.data.trocar_senha) return <TrocarSenha eu={eu.data} />

  return (
    <EmpresaProvider>
      <div className={`casca${recolhidoEfetivo ? ' menu-recolhido' : ''}`}>
        <a href="#conteudo" className="pular">Pular para o conteúdo</a>
        <Menu acoes={eu.data.acoes ?? []} aberto={gaveta} recolhido={recolhidoEfetivo} id={ID_MENU} />
        {gaveta && <div className="veu" aria-hidden="true" onClick={() => fecharGaveta(true)} />}
        <div className="principal" ref={principal}>
          <Topo eu={eu.data} gaveta={gaveta} alternarGaveta={() => setGaveta((g) => !g)} botaoMenu={botaoMenu}
            recolhido={recolhidoEfetivo} alternarRecolhido={alternarRecolhido} controla={ID_MENU} />
          <FaixaHomologacao />
          <main id="conteudo" className="conteudo" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </EmpresaProvider>
  )
}

/** Páginas da empresa: só renderizam com uma empresa selecionada (o `eid` vai para as rotas /api/empresas/:eid). */
export function ComEmpresa({ children }: { children: (eid: number) => JSX.Element }) {
  const { eid, carregando, erro } = useEmpresa()
  const { data: eu } = useEu()
  if (carregando) return <p className="mudo" role="status">Carregando empresas…</p>
  if (erro) return <p className="erro" role="alert">{erro.message}</p>
  if (eid == null) {
    return (
      <section className="cartao">
        <h1>Nenhuma empresa na carteira</h1>
        <p className="mudo">Cadastre uma empresa para começar a emitir notas.</p>
        {pode(eu, 'gerir_empresas')
          ? <Link className="botao" to="/empresas/nova">Cadastrar empresa</Link>
          : <p className="mudo">Peça a um administrador do escritório para liberar uma empresa para você.</p>}
      </section>
    )
  }
  return children(eid)
}
