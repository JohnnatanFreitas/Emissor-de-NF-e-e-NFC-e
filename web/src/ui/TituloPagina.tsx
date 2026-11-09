import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type Migalha = { rotulo: string; para?: string }

/** Título da página em Sora (fino) com o destaque em negrito, como o SECRAN Control. */
export function TituloPagina({ titulo, destaque, apoio, migalhas, acoes }: {
  titulo: string; destaque?: string; apoio?: ReactNode; migalhas?: Migalha[]; acoes?: ReactNode
}) {
  return (
    <header className="titulo-pagina">
      {migalhas && migalhas.length > 0 && (
        <nav aria-label="Você está em" className="migalhas">
          {migalhas.map((m, i) => (
            <span key={`${m.rotulo}-${i}`}>
              {i > 0 && <span aria-hidden="true" className="migalha-sep">›</span>}
              {m.para ? <Link to={m.para}>{m.rotulo}</Link> : <span aria-current="page">{m.rotulo}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="titulo-linha">
        <h1>{titulo}{destaque && <> <b>{destaque}</b></>}</h1>
        {acoes && <div className="titulo-acoes">{acoes}</div>}
      </div>
      {apoio && <p className="titulo-apoio">{apoio}</p>}
    </header>
  )
}
