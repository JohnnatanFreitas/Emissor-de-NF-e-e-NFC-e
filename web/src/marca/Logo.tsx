/** Marca Argus Emissor: o mesmo arco em volta do "A" da família Argus, com a seta azul de envio atravessando o "A". */
export const AZUL_MARCA = '#2AA7E0'
export const TRACO = { claro: '#2B2B2B', escuro: '#E6ECF2' } as const

type Fundo = keyof typeof TRACO

export function Simbolo({ cor, tamanho = 28, decorativo = false }: { cor: string; tamanho?: number; decorativo?: boolean }) {
  const a11y = decorativo ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Argus Emissor' }
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 64 64" focusable="false" {...a11y}>
      <path d="M46 13 A24 24 0 1 0 15 51" fill="none" stroke={cor} strokeWidth="6" strokeLinecap="round" />
      <path d="M20 52 L33 17 L45 52" fill="none" stroke={cor} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M26 38 H56 M47 29 L56 38 L47 47" fill="none" stroke={AZUL_MARCA} strokeWidth="6" strokeLinecap="round"
        strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ variante = 'completa', fundo = 'escuro', tamanho = 28 }: {
  variante?: 'simbolo' | 'completa'
  fundo?: Fundo
  tamanho?: number
}) {
  if (variante === 'simbolo') return <Simbolo cor={TRACO[fundo]} tamanho={tamanho} />
  return (
    <span className={`logo logo-${fundo}`} role="img" aria-label="Argus Emissor — NF-e e NFC-e">
      <Simbolo cor={TRACO[fundo]} tamanho={tamanho} decorativo />
      <span className="logo-texto" aria-hidden="true">
        <span className="logo-nome">Argus Emissor</span>
        <span className="logo-sub">NF-e e NFC-e</span>
      </span>
    </span>
  )
}
