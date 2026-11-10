/** Ícones SVG de traço (mesma família do menu do Argus Captura). */
export const ICONES = {
  painel: 'M4 20V11M10 20V5M16 20v-6M22 20H2',
  empresas: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01',
  produtos: 'M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  estoque: 'M3 7h18v4H3zM5 11v9h14v-9M10 15h4',
  pessoas: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  pedidos: 'M9 3h6v3H9zM9 4.5H6V21h12V4.5h-3M9 11h6M9 15h6M9 18h3',
  notas: 'M14 3H6v18h12V7l-4-4zm0 0v4h4M9 12h6M9 16h6',
  balcao: 'M3 9h18l-2 11H5L3 9zM8 9V6a4 4 0 0 1 8 0v3',
  receber: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  sped: 'M4 4h16v16H4zM4 9h16M9 9v11M12 13h5M12 16h5',
  configuracoes: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  mais: 'M12 5v14M5 12h14',
  lixo: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15',
  baixar: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3',
  abrir: 'M14 3h7v7M10 14 21 3M19 14v7H3V5h7',
  alerta: 'M12 3 2 21h20L12 3zM12 10v5M12 18h.01',
  busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
} as const

export type NomeIcone = keyof typeof ICONES

export function Icone({ nome, tamanho = 16, className }: { nome: NomeIcone; tamanho?: number; className?: string }) {
  return (
    <svg className={className} width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONES[nome]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        strokeLinejoin="round" />
    </svg>
  )
}
