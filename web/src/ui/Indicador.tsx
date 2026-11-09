import { Link, type To } from 'react-router-dom'

export type TomIndicador = 'neutro' | 'ok' | 'atencao' | 'critico' | 'cinza'

/** Número grande (20px 600) com rótulo (11px); com `para`, o card inteiro é um link. */
export function Indicador({ valor, rotulo, tom = 'neutro', para }: {
  valor: string; rotulo: string; tom?: TomIndicador; para?: To
}) {
  const corpo = (
    <>
      <span className="ind-rotulo">{rotulo}</span>
      <span className="ind-valor">{valor}</span>
    </>
  )
  const classe = `indicador ind-${tom}`
  return para
    ? <Link to={para} className={classe} aria-label={`${rotulo}: ${valor}`}>{corpo}</Link>
    : <div className={classe}>{corpo}</div>
}
