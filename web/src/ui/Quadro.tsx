import { type ReactNode, useId } from 'react'

export type EstadoQuadro = 'pronto' | 'carregando' | 'vazio' | 'erro'

/** Quadro branco-gelo (claro) ou marinho (escuro) com título, subtítulo, ações e estados. */
export function Quadro({ titulo, subtitulo, acoes, estado = 'pronto', mensagem, children, className }: {
  titulo?: string; subtitulo?: string; acoes?: ReactNode; estado?: EstadoQuadro; mensagem?: string
  children?: ReactNode; className?: string
}) {
  const id = useId()
  return (
    <section className={`quadro${estado === 'carregando' ? ' quadro-carregando' : ''}${className ? ` ${className}` : ''}`}
      aria-labelledby={titulo ? id : undefined}>
      {(titulo || acoes) && (
        <div className="quadro-cab">
          {titulo && <h2 id={id} className="quadro-titulo">{titulo}</h2>}
          {acoes && <div className="quadro-acoes">{acoes}</div>}
        </div>
      )}
      {subtitulo && <p className="quadro-sub">{subtitulo}</p>}
      {estado === 'carregando' && <p className="mudo" role="status">Carregando…</p>}
      {estado === 'vazio' && <p className="quadro-vazio mudo">{mensagem ?? 'Nada para mostrar'}</p>}
      {estado === 'erro' && <p className="erro" role="alert">{mensagem}</p>}
      {estado === 'pronto' && children}
    </section>
  )
}
