import { type ReactNode, type SelectHTMLAttributes, useId } from 'react'
import { UFS } from '../tipos'

export type PropsCampo = { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }

/** Campo com rótulo e, se houver, a dica ou a mensagem de erro ligadas por aria-describedby. */
export function Campo({ rotulo, erro, dica, children, largo }: {
  rotulo: string; erro?: string; dica?: ReactNode; largo?: boolean; children: (props: PropsCampo) => ReactNode
}) {
  const id = useId()
  const desc = erro ? `${id}-erro` : dica ? `${id}-dica` : undefined
  return (
    <div className={`campo${largo ? ' campo-largo' : ''}`}>
      <label htmlFor={id}><span>{rotulo}</span></label>
      {children({ id, 'aria-invalid': erro ? true : undefined, 'aria-describedby': desc })}
      {erro ? <small id={`${id}-erro`} className="erro-campo">{erro}</small>
        : dica ? <small id={`${id}-dica`} className="mudo dica">{dica}</small> : null}
    </div>
  )
}

export function SelectUF({ valor, mudar, ...props }: { valor: string; mudar: (v: string) => void }
  & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select className="entrada" value={valor} onChange={(e) => mudar(e.target.value)} {...props}>
      <option value="">Selecione</option>
      {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
    </select>
  )
}

/** Caixa de marcar com rótulo ao lado. */
export function Marcar({ rotulo, marcado, mudar, dica }: {
  rotulo: string; marcado: boolean; mudar: (v: boolean) => void; dica?: string
}) {
  return (
    <label className="opcao marcar">
      <input type="checkbox" checked={marcado} onChange={(e) => mudar(e.target.checked)} />
      <span>{rotulo}{dica && <small className="mudo"> — {dica}</small>}</span>
    </label>
  )
}

/** Mensagem de sucesso ou erro de uma ação (role status/alert). */
export function Aviso({ tipo, children }: { tipo: 'ok' | 'erro'; children: ReactNode }) {
  return <p className={tipo === 'erro' ? 'erro' : 'ok'} role={tipo === 'erro' ? 'alert' : 'status'}>{children}</p>
}

/** Estado de carregamento/erro padrão de uma consulta. */
export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <p className="mudo" role="status">{texto}</p>
}
