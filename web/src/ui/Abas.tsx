import { type KeyboardEvent, useRef } from 'react'
import { Link, type To, useLocation, useNavigate } from 'react-router-dom'

export type AbaSimples = { slug: string; rotulo: string }

/** Abas ligadas à URL no padrão ARIA (tablist/tab): setas, Home e End trocam de aba. */
export function Abas({ rotulo, abas, atual, para }: {
  rotulo: string; abas: AbaSimples[]; atual: string; para: (slug: string) => To
}) {
  const navegar = useNavigate()
  const { state } = useLocation()
  const refs = useRef<(HTMLAnchorElement | null)[]>([])
  function tecla(e: KeyboardEvent, i: number) {
    const n = abas.length
    const alvo = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key]
    if (alvo === undefined) return
    e.preventDefault()
    navegar(para(abas[alvo].slug), { state })
    refs.current[alvo]?.focus()
  }
  return (
    <div role="tablist" aria-label={rotulo} className="abas abas-ui">
      {abas.map((a, i) => {
        const on = a.slug === atual
        return (
          <Link key={a.slug} ref={(el) => { refs.current[i] = el }} to={para(a.slug)} state={state} role="tab"
            aria-selected={on} tabIndex={on ? 0 : -1} className={`aba${on ? ' on' : ''}`}
            onKeyDown={(e) => tecla(e, i)}>
            {a.rotulo}
          </Link>
        )
      })}
    </div>
  )
}
