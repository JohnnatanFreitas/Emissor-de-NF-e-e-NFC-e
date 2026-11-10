import { Link, useLocation } from 'react-router-dom'
import type { Acao } from '../tipos'
import { Logo } from '../marca/Logo'
import { MarcaSecran } from '../marca/Secran'
import { itemAtivo, menuVisivel } from '../rotas'
import { Icone } from '../ui/Icone'

/** Menu lateral: o item ativo tem o filete azul e o submenu dele aparece aberto logo abaixo. Cada item só aparece
 *  para quem tem a ação dele (`acoes` do /api/eu). */
export function Menu({ acoes, aberto, recolhido, id }: {
  acoes: readonly Acao[]; aberto: boolean; recolhido: boolean; id: string
}) {
  const { pathname } = useLocation()
  const compacto = recolhido && !aberto

  return (
    <aside id={id} className={`lateral${aberto ? ' aberta' : ''}${recolhido ? ' recolhida' : ''}`}>
      <div className="lateral-marca">
        <Logo variante={compacto ? 'simbolo' : 'completa'} fundo="escuro" />
      </div>
      <nav aria-label="Menu principal">
        <ul className="menu">
          {menuVisivel(acoes).map((item) => {
            const ativo = itemAtivo(item, pathname)
            const subs = ativo && !compacto ? item.subs : []
            const atual = ativo ? (subs.some((s) => s.ativo(pathname)) ? 'true' : 'page') : undefined
            return (
              <li key={item.rotulo}>
                <Link to={item.para} className={`menu-item${ativo ? ' on' : ''}`} aria-current={atual}
                  title={compacto ? item.rotulo : undefined} aria-label={compacto ? item.rotulo : undefined}>
                  <Icone nome={item.icone} tamanho={18} className="menu-ico" />
                  <span>{item.rotulo}</span>
                </Link>
                {subs.length > 0 && (
                  <ul className="submenu" aria-label={item.rotulo}>
                    {subs.map((s) => {
                      const on = s.ativo(pathname)
                      return (
                        <li key={s.para}>
                          <Link to={s.para} className={`menu-sub${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined}>
                            {s.rotulo}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
      <MarcaSecran compacta={compacto} />
    </aside>
  )
}
