import { brl } from '../formato'
import type { Totais } from '../tipos'

const LINHAS: [keyof Totais, string][] = [
  ['produtos_cent', 'Produtos'],
  ['desconto_cent', 'Descontos'],
  ['bc_icms_cent', 'Base do ICMS'],
  ['icms_cent', 'ICMS'],
  ['bc_icms_st_cent', 'Base do ICMS ST'],
  ['icms_st_cent', 'ICMS ST'],
  ['icms_uf_dest_cent', 'DIFAL (ICMS UF destino)'],
  ['ipi_cent', 'IPI'],
  ['pis_cent', 'PIS'],
  ['cofins_cent', 'COFINS'],
  ['bc_ibscbs_cent', 'Base do IBS/CBS'],
  ['ibs_uf_cent', 'IBS estadual'],
  ['ibs_mun_cent', 'IBS municipal'],
  ['ibs_cent', 'IBS'],
  ['cbs_cent', 'CBS'],
]

/** Linhas que só aparecem quando vêm com valor (DIFAL, base da ST, IBS por esfera). */
const OPCIONAIS: (keyof Totais)[] = ['bc_icms_st_cent', 'icms_uf_dest_cent', 'ibs_uf_cent', 'ibs_mun_cent']

/** Quadro "Resumo": tributos e total da nota (vNF). */
export function QuadroResumo({ totais, carregando, erro, aviso, titulo = 'Resumo' }: {
  totais?: Totais | null; carregando?: boolean; erro?: string; aviso?: string; titulo?: string
}) {
  return (
    <section className="cartao resumo" aria-labelledby="titulo-resumo" aria-busy={carregando || undefined}>
      <h2 id="titulo-resumo">{titulo}</h2>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {!totais && !erro && <p className="mudo">{carregando ? 'Calculando…' : aviso ?? 'Adicione itens para ver os tributos.'}</p>}
      {totais && (
        <dl className={`resumo-linhas${carregando ? ' recalculando' : ''}`}>
          {LINHAS.filter(([k]) => totais[k] != null && (OPCIONAIS.indexOf(k) < 0 || Number(totais[k]) !== 0)).map(([k, r]) => (
            <div key={k} className={k.startsWith('bc_') ? 'resumo-base' : undefined}>
              <dt>{r}</dt><dd className="mono">{brl(totais[k] as number)}</dd>
            </div>
          ))}
          <div className="resumo-total"><dt>Total da nota</dt><dd className="mono">{brl(totais.total_cent)}</dd></div>
        </dl>
      )}
      {totais && aviso && <p className="mudo dica">{aviso}</p>}
    </section>
  )
}
