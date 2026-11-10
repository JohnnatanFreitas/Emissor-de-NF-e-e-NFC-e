/** Assinatura "Uma solução Secran Group": a logo (PNG de fundo branco) num bloco claro arredondado, para o branco da
 *  imagem ficar intencional sobre o azul-noite do menu e da tela de entrada, nos dois temas. */
export const LOGO_SECRAN = `${import.meta.env.BASE_URL}secran-group.png`

export function MarcaSecran({ compacta = false, className = '' }: { compacta?: boolean; className?: string }) {
  return (
    <div className={`marca-secran${compacta ? ' compacta' : ''}${className ? ` ${className}` : ''}`}>
      <img src={LOGO_SECRAN} alt="Secran Group" width={compacta ? 36 : 96} height={compacta ? 31 : 84} />
      {!compacta && <span className="marca-secran-texto">Uma solução Secran Group</span>}
    </div>
  )
}
