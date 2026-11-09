import type { ReactNode } from 'react'
import { MSG_RESTRITO, podeAlguma, useEu } from '../api'
import type { Acao } from '../tipos'

export function NaoEncontrada() {
  return (
    <section className="cartao">
      <h1>Página não encontrada</h1>
      <p className="mudo">Confira o endereço ou escolha uma opção no menu.</p>
    </section>
  )
}

export function Restrito() {
  return (
    <section className="cartao" role="alert">
      <h1>{MSG_RESTRITO}</h1>
      <p className="mudo">Peça a um administrador do escritório se precisar desta página.</p>
    </section>
  )
}

/** Só quem tem uma das ações (lista `acoes` do /api/eu); os outros veem o aviso. O menu já esconde esses itens. */
export function Exige({ acoes, children }: { acoes: Acao[]; children: ReactNode }) {
  const { data: eu } = useEu()
  return podeAlguma(eu, acoes) ? <>{children}</> : <Restrito />
}
