import { digitos, trocarDestino } from '../classificacao'
import type { Classificacao, Destino, DestinoOpcao } from '../tipos'

/**
 * Campos da classificação fiscal de um item de entrada (destino, CFOP, CST e créditos), usados na Entrada por XML e na
 * conferência das entradas. Trocar o destino recalcula o CFOP sugerido (ver `trocarDestino`).
 */
export function CamposClassificacao({ item, valor, mudar, destinos, comSt, temIcms = true, temIpi = true }: {
  /** rótulo do item para os nomes acessíveis (ex.: "item 3") */
  item: string
  valor: Classificacao
  mudar: (c: Classificacao) => void
  destinos: DestinoOpcao[]
  /** item veio com ICMS-ST: o CFOP sugerido usa o final de ST */
  comSt: boolean
  /** sem ICMS destacado não há crédito: a caixa fica desabilitada */
  temIcms?: boolean
  temIpi?: boolean
}) {
  return (
    <div className="classif">
      <select className="entrada" aria-label={`Destino do ${item}`} value={valor.destino}
        onChange={(e) => mudar(trocarDestino(valor, e.target.value as Destino, destinos, comSt))}>
        {destinos.map((d) => <option key={d.valor} value={d.valor}>{d.rotulo}</option>)}
      </select>
      <input className="entrada mono" aria-label={`CFOP de entrada do ${item}`} inputMode="numeric" maxLength={4}
        value={valor.cfop} onChange={(e) => mudar({ ...valor, cfop: digitos(e.target.value, 4) })} />
      <input className="entrada mono" aria-label={`CST do ICMS do ${item}`} inputMode="numeric" maxLength={3}
        placeholder="CST" value={valor.cst_icms} onChange={(e) => mudar({ ...valor, cst_icms: digitos(e.target.value, 3) })} />
      <span className="classif-marcas">
        <label className="opcao" title={temIcms ? undefined : 'Sem ICMS destacado na nota'}>
          <input type="checkbox" aria-label={`Crédito de ICMS do ${item}`} checked={temIcms && valor.credito_icms} disabled={!temIcms}
            onChange={(e) => mudar({ ...valor, credito_icms: e.target.checked })} />
          <span>Crédito ICMS</span>
        </label>
        <label className="opcao" title={temIpi ? undefined : 'Sem IPI destacado na nota'}>
          <input type="checkbox" aria-label={`Crédito de IPI do ${item}`} checked={temIpi && valor.credito_ipi} disabled={!temIpi}
            onChange={(e) => mudar({ ...valor, credito_ipi: e.target.checked })} />
          <span>Crédito IPI</span>
        </label>
      </span>
    </div>
  )
}
