import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, json, mensagemErro, rotaEmpresa } from '../api'
import { useEmpresa } from '../empresa'
import { numeroParaTexto, pct, textoParaNumero } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { Crt, PerfilEntrada, PerfilFiscal } from '../tipos'
import { Campo, Marcar } from '../ui/Campo'
import { Icone } from '../ui/Icone'
import { Selo } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'

export const ORIGENS: [string, string][] = [
  ['0', '0 — Nacional'], ['1', '1 — Estrangeira, importação direta'], ['2', '2 — Estrangeira, mercado interno'],
  ['3', '3 — Nacional, conteúdo importado > 40%'], ['4', '4 — Nacional, processos básicos'],
  ['5', '5 — Nacional, conteúdo importado ≤ 40%'], ['6', '6 — Estrangeira direta, sem similar (CAMEX)'],
  ['7', '7 — Estrangeira interna, sem similar (CAMEX)'], ['8', '8 — Nacional, conteúdo importado > 70%'],
]
const CST_NORMAL = ['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90']
const CSOSN = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']
const CST_PIS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '49', '99']
const CST_IPI = ['50', '51', '52', '53', '54', '55', '99']

type Num = 'aliq_icms_interna' | 'aliq_icms_interestadual' | 'reducao_bc_icms' | 'mva_st' | 'aliq_icms_st' | 'aliq_pis'
  | 'aliq_cofins' | 'aliq_ipi' | 'aliq_ibs_uf' | 'aliq_ibs_mun' | 'aliq_cbs'
const NUMEROS: Num[] = ['aliq_icms_interna', 'aliq_icms_interestadual', 'reducao_bc_icms', 'mva_st', 'aliq_icms_st',
  'aliq_pis', 'aliq_cofins', 'aliq_ipi', 'aliq_ibs_uf', 'aliq_ibs_mun', 'aliq_cbs']

/** Formulário: os números ficam em texto (vírgula decimal) até salvar. */
export type FormPerfil = Omit<PerfilEntrada, Num | 'cst_ipi'> & Record<Num, string> & { cst_ipi: string }

export function perfilPadrao(crt: Crt | undefined): PerfilEntrada {
  const simples = crt === '1' || crt === '2'
  return {
    nome: '', ativo: true, cfop_interno: '5102', cfop_interestadual: '6102', cfop_nfce: '5102', origem: '0',
    cst_icms: simples ? '102' : '00', aliq_icms_interna: simples ? 0 : 18, aliq_icms_interestadual: 0,
    reducao_bc_icms: 0, mva_st: 0, aliq_icms_st: 0,
    cst_pis: simples ? '49' : '01', aliq_pis: simples ? 0 : 0.65, cst_cofins: simples ? '49' : '01', aliq_cofins: simples ? 0 : 3,
    cst_ipi: null, aliq_ipi: 0,
    informar_ibscbs: true, cst_ibscbs: '000', cclass_trib: '000001', aliq_ibs_uf: 0.1, aliq_ibs_mun: 0, aliq_cbs: 0.9,
    ibscbs_base_liquida: true,
  }
}

export function formDoPerfil(p: PerfilEntrada): FormPerfil {
  const f = { ...p, cst_ipi: p.cst_ipi ?? '' } as unknown as FormPerfil
  for (const k of NUMEROS) f[k] = numeroParaTexto(p[k])
  return f
}

/** Converte o formulário no corpo da API; devolve os erros por campo quando há número inválido. */
export function corpoDoPerfil(f: FormPerfil): { corpo?: PerfilEntrada; erros: Record<string, string> } {
  const erros: Record<string, string> = {}
  if (!f.nome.trim()) erros.nome = 'Informe o nome do perfil'
  for (const k of ['cfop_interno', 'cfop_interestadual', 'cfop_nfce'] as const) {
    if (!/^\d{4}$/.test(f[k].trim())) erros[k] = 'CFOP com 4 dígitos'
  }
  if (!f.cst_icms.trim()) erros.cst_icms = 'Informe o CST/CSOSN'
  const nums = {} as Record<Num, number>
  for (const k of NUMEROS) {
    const n = textoParaNumero(f[k] || '0')
    if (n == null || n < 0) erros[k] = 'Número inválido'
    else nums[k] = n
  }
  if (Object.keys(erros).length) return { erros }
  return {
    erros,
    corpo: {
      ...f, ...nums, nome: f.nome.trim(), cfop_interno: f.cfop_interno.trim(), cfop_interestadual: f.cfop_interestadual.trim(),
      cfop_nfce: f.cfop_nfce.trim(), cst_icms: f.cst_icms.trim(), cst_ipi: f.cst_ipi.trim() || null,
      cst_pis: f.cst_pis.trim(), cst_cofins: f.cst_cofins.trim(), cst_ibscbs: f.cst_ibscbs.trim(),
      cclass_trib: f.cclass_trib.trim(),
    },
  }
}

export function usePerfis(eid: number) {
  return useQuery({ queryKey: ['perfis', eid], queryFn: () => api<PerfilFiscal[]>(rotaEmpresa(eid, 'perfis')) })
}

function Lista({ eid }: { eid: number }) {
  const q = usePerfis(eid)
  return (
    <section className="perfis">
      <TituloPagina titulo="Perfis" destaque="fiscais" migalhas={[{ rotulo: 'Configurações' }, { rotulo: 'Perfis fiscais' }]}
        apoio="A regra tributária de cada produto: CFOP, CST e alíquotas saem daqui, sem o vendedor digitar nada."
        acoes={<Link to="/configuracoes/perfis/novo" className="botao"><Icone nome="mais" />Novo perfil</Link>} />
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhum perfil cadastrado</p>}
      {q.data && q.data.length > 0 && (
        <div className="cartao rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Perfil</th><th scope="col">CFOP interno / inter. / NFC-e</th><th scope="col">CST ICMS</th>
                <th scope="col" className="num">ICMS int.</th><th scope="col" className="num">ICMS inter.</th>
                <th scope="col">PIS / COFINS</th><th scope="col">IBS / CBS</th><th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/configuracoes/perfis/${p.id}`}>{p.nome}</Link></td>
                  <td className="mono">{p.cfop_interno} / {p.cfop_interestadual} / {p.cfop_nfce}</td>
                  <td className="mono">{p.origem}{p.cst_icms}</td>
                  <td className="num">{pct(p.aliq_icms_interna)}</td>
                  <td className="num">{p.aliq_icms_interestadual === 0 ? 'automática' : pct(p.aliq_icms_interestadual)}</td>
                  <td className="mono">{p.cst_pis} {pct(p.aliq_pis)} / {p.cst_cofins} {pct(p.aliq_cofins)}</td>
                  <td className="mono">{p.informar_ibscbs ? `${pct(p.aliq_ibs_uf + p.aliq_ibs_mun)} / ${pct(p.aliq_cbs)}` : 'não informa'}</td>
                  <td>{p.ativo ? <Selo texto="Ativo" tom="verde" /> : <Selo texto="Inativo" tom="cinza" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Formulario({ eid, id }: { eid: number; id: number | null }) {
  const { atual } = useEmpresa()
  const lista = usePerfis(eid)
  const existente = id != null ? lista.data?.find((p) => p.id === id) : undefined
  if (id != null && lista.isPending) return <p className="mudo" role="status">Carregando…</p>
  if (id != null && lista.isError) return <p className="erro" role="alert">{mensagemErro(lista.error)}</p>
  if (id != null && !existente) return <p className="erro" role="alert">Perfil não encontrado nesta empresa.</p>
  return <FormPerfilFiscal eid={eid} id={id} inicial={formDoPerfil(existente ?? perfilPadrao(atual?.crt))} crt={atual?.crt} />
}

function FormPerfilFiscal({ eid, id, inicial, crt }: { eid: number; id: number | null; inicial: FormPerfil; crt?: Crt }) {
  const navegar = useNavigate()
  const cliente = useQueryClient()
  const [f, setF] = useState(inicial)
  const [erros, setErros] = useState<Record<string, string>>({})
  const mudar = <K extends keyof FormPerfil>(k: K, v: FormPerfil[K]) => setF((a) => ({ ...a, [k]: v }))
  const t = (k: keyof FormPerfil) => (e: { target: { value: string } }) => mudar(k, e.target.value as never)
  const simples = crt === '1' || crt === '2'

  const salvar = useMutation({
    mutationFn: (corpo: PerfilEntrada) => id == null
      ? api<PerfilFiscal>(rotaEmpresa(eid, 'perfis'), json('POST', corpo))
      : api<PerfilFiscal>(rotaEmpresa(eid, `perfis/${id}`), json('PUT', corpo)),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['perfis', eid] })
      navegar('/configuracoes/perfis')
    },
  })

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    const r = corpoDoPerfil(f)
    setErros(r.erros)
    if (r.corpo) salvar.mutate(r.corpo)
  }

  const num = (k: Num, rotulo: string, dica?: string) => (
    <Campo rotulo={rotulo} erro={erros[k]} dica={dica}>
      {(p) => <input {...p} className="entrada mono" inputMode="decimal" value={f[k]} onChange={t(k)} />}
    </Campo>
  )
  const txt = (k: keyof FormPerfil, rotulo: string, lista?: string[], dica?: string) => (
    <Campo rotulo={rotulo} erro={erros[k as string]} dica={dica}>
      {(p) => (
        <>
          <input {...p} className="entrada mono" value={String(f[k] ?? '')} onChange={t(k)} list={lista ? `${p.id}-l` : undefined} />
          {lista && <datalist id={`${p.id}-l`}>{lista.map((o) => <option key={o} value={o} />)}</datalist>}
        </>
      )}
    </Campo>
  )

  return (
    <section className="perfil-form">
      <TituloPagina titulo={id == null ? 'Novo perfil' : 'Perfil'} destaque={id == null ? 'fiscal' : inicial.nome}
        migalhas={[{ rotulo: 'Configurações' }, { rotulo: 'Perfis fiscais', para: '/configuracoes/perfis' },
          { rotulo: id == null ? 'Novo' : inicial.nome }]} />
      <form className="cartao formulario" onSubmit={enviar} noValidate>
        <fieldset className="grupo">
          <legend>Perfil</legend>
          <div className="grade-campos">
            <Campo rotulo="Nome" erro={erros.nome} largo>
              {(p) => <input {...p} className="entrada" value={f.nome} placeholder="Ex.: Revenda tributada"
                onChange={(e) => mudar('nome', e.target.value)} />}
            </Campo>
            <div className="campo campo-caixa"><Marcar rotulo="Ativo" marcado={f.ativo} mudar={(v) => mudar('ativo', v)} /></div>
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>ICMS</legend>
          <div className="grade-campos">
            {txt('cfop_interno', 'CFOP dentro do estado', ['5101', '5102', '5405', '5403'], 'Ex.: 5102 revenda')}
            {txt('cfop_interestadual', 'CFOP fora do estado', ['6101', '6102', '6404', '6108'], 'Ex.: 6102 revenda')}
            {txt('cfop_nfce', 'CFOP na NFC-e', ['5102', '5405'])}
            <Campo rotulo="Origem da mercadoria">
              {(p) => (
                <select {...p} className="entrada" value={f.origem} onChange={t('origem')}>
                  {ORIGENS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              )}
            </Campo>
            {txt('cst_icms', simples ? 'CSOSN' : 'CST do ICMS', simples ? CSOSN : CST_NORMAL,
              simples ? 'Simples Nacional: 101, 102, 500…' : 'Regime normal: 00, 20, 40, 60…')}
            {simples
              ? num('aliq_icms_interna', 'Crédito do ICMS (%)', 'Percentual de crédito do CSOSN 101/201')
              : num('aliq_icms_interna', 'Alíquota interna (%)')}
            {num('aliq_icms_interestadual', 'Alíquota interestadual (%)', '0 = automática (4%, 7% ou 12% conforme origem e destino)')}
            {num('reducao_bc_icms', 'Redução da base (%)')}
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>ICMS ST</legend>
          <div className="grade-campos">
            {num('mva_st', 'MVA (%)')}
            {num('aliq_icms_st', 'Alíquota do ICMS ST (%)')}
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>PIS e COFINS</legend>
          <div className="grade-campos">
            {txt('cst_pis', 'CST do PIS', CST_PIS)}
            {num('aliq_pis', 'Alíquota do PIS (%)')}
            {txt('cst_cofins', 'CST da COFINS', CST_PIS)}
            {num('aliq_cofins', 'Alíquota da COFINS (%)')}
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>IPI</legend>
          <div className="grade-campos">
            {txt('cst_ipi', 'CST do IPI', CST_IPI, 'Deixe vazio se a empresa não é contribuinte do IPI')}
            {num('aliq_ipi', 'Alíquota do IPI (%)')}
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>IBS e CBS (Reforma Tributária)</legend>
          <Marcar rotulo="Informar IBS e CBS na nota" marcado={f.informar_ibscbs} mudar={(v) => mudar('informar_ibscbs', v)} />
          <div className="grade-campos">
            {txt('cst_ibscbs', 'CST do IBS/CBS', ['000', '200', '410'])}
            {txt('cclass_trib', 'cClassTrib', ['000001'])}
            {num('aliq_ibs_uf', 'IBS estadual (%)', 'Em 2026: 0,1%')}
            {num('aliq_ibs_mun', 'IBS municipal (%)', 'Em 2026: 0%')}
            {num('aliq_cbs', 'CBS (%)', 'Em 2026: 0,9%')}
          </div>
          <Marcar rotulo="Tirar ICMS, PIS e COFINS da base" marcado={f.ibscbs_base_liquida}
            mudar={(v) => mudar('ibscbs_base_liquida', v)} dica="confira se é a regra que você quer aplicar" />
        </fieldset>
        {Object.keys(erros).length > 0 && <p className="erro" role="alert">Confira os campos destacados.</p>}
        {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
        <div className="acoes-form">
          <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar perfil'}</button>
          <Link to="/configuracoes/perfis" className="botao sec">Cancelar</Link>
        </div>
      </form>
    </section>
  )
}

export function PaginaPerfis() {
  return <ComEmpresa>{(eid) => <Lista key={eid} eid={eid} />}</ComEmpresa>
}

export function PaginaPerfil() {
  const { id } = useParams()
  const n = id && id !== 'novo' ? Number(id) : null
  return <ComEmpresa>{(eid) => <Formulario key={`${eid}-${id}`} eid={eid} id={n} />}</ComEmpresa>
}
