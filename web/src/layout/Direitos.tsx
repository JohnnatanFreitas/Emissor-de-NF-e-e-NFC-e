/** Rodapé discreto de direitos, no canto direito (telas do sistema e de entrada). */
export const TEXTO_DIREITOS = '© 2026 Secran Group. Todos os direitos reservados.'

export function Direitos() {
  return <footer className="direitos"><small>{TEXTO_DIREITOS}</small></footer>
}
