import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { ErroApi, api, json, mensagemErro, rotaEmpresa } from '../api'
import { mesAnterior, periodoBR } from '../classificacao'
import { brl, centavosParaTexto, dataHoraBR, hojeISO, inteiro, textoParaCentavos } from '../formato'
import { ComEmpresa } from '../layout/Layout'
import type { ApuracaoSped, ArquivoSped, ConfigSped, Contabilista, CorpoSped, FinalidadeSped, PerfilSped, PreviaSped }
  from '../tipos'
import { Abas } from '../ui/Abas'
import { Campo, Marcar } from '../ui/Campo'
import { Icone } from '../ui/Icone'
import { Indicador } from '../ui/Indicador'
import { Selo } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'

export type AbaSped = 'gerar' | 'configuracao'

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro',
  'Novembro', 'Dezembro']

export const PERFIS: { valor: PerfilSped; titulo: string; texto: string }[] = [
  { valor: 'A', titulo: 'Perfil A — tudo detalhado', texto: 'C170 (itens) nas entradas e nas saídas.' },
  { valor: 'B', titulo: 'Perfil B — itens só nas entradas', texto: 'Saídas só com C100 e C190; C170 apenas nas entradas.' },
]

/** Classificação do estabelecimento industrial (registro 0002). */
const CLASSIF_INDUSTRIAL: { valor: string; rotulo: string }[] = [
  { valor: '00', rotulo: '00 — Industrial: transformação' },
  { valor: '01', rotulo: '01 — Industrial: beneficiamento' },
  { valor: '02', rotulo: '02 — Industrial: montagem' },
  { valor: '03', rotulo: '03 — Industrial: acondicionamento ou reacondicionamento' },
  { valor: '04', rotulo: '04 — Industrial: renovação ou recondicionamento' },
  { valor: '05', rotulo: '05 — Equiparado a industrial: por opção' },
  { valor: '06', rotulo: '06 — Equiparado a industrial: importação direta' },
  { valor: '07', rotulo: '07 — Equiparado a industrial: por lei específica' },
  { valor: '08', rotulo: '08 — Equiparado a industrial: não enquadrado em 05, 06 ou 07' },
  { valor: '09', rotulo: '09 — Outros' },
]

/** Chave dos parâmetros da prévia: o "Gerar arquivo" só libera para a mesma combinação conferida. */
export function chavePrevia(c: CorpoSped) {
  return [c.periodo, c.perfil, c.finalidade, c.saldo_credor_anterior_cent ?? ''].join('|')
}

/** Erros e alertas de um 422 do /sped/gerar (`{ erro, erros[], alertas[] }`). */
export function errosDoGerar(erro: unknown): { erros: string[]; alertas: string[] } | null {
  if (!(erro instanceof ErroApi) || erro.status !== 422) return null
  const c = erro.corpo as { erros?: unknown; alertas?: unknown } | undefined
  const lista = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  return { erros: lista(c?.erros), alertas: lista(c?.alertas) }
}

function useConfigSped(eid: number) {
  return useQuery({ queryKey: ['sped-config', eid], queryFn: () => api<ConfigSped>(rotaEmpresa(eid, 'sped/config')) })
}

function Conteudo({ eid, aba }: { eid: number; aba: AbaSped }) {
  const config = useConfigSped(eid)
  return (
    <section className="sped">
      <TituloPagina titulo="SPED" destaque="Fiscal" migalhas={[{ rotulo: 'SPED Fiscal' }]}
        apoio="EFD ICMS/IPI do mês: confira, gere o arquivo e baixe para transmitir no PVA." />
      <Abas rotulo="Seções do SPED Fiscal" atual={aba} para={(s) => (s === 'gerar' ? '/sped' : '/sped/configuracao')}
        abas={[{ slug: 'gerar', rotulo: 'Gerar arquivo' }, { slug: 'configuracao', rotulo: 'Configuração do SPED' }]} />
      <div className="espaco-acima">
        {config.isError && <p className="erro" role="alert">{mensagemErro(config.error)}</p>}
        {config.isPending && <p className="mudo" role="status">Carregando…</p>}
        {config.data && aba === 'gerar' && <Gerar eid={eid} config={config.data} />}
        {config.data && aba === 'configuracao' && <FormConfig key={eid} eid={eid} config={config.data} />}
      </div>
    </section>
  )
}

/* ---------------- Gerar ---------------- */

function Gerar({ eid, config }: { eid: number; config: ConfigSped }) {
  const cliente = useQueryClient()
  const hoje = hojeISO()
  const padrao = mesAnterior(hoje)
  const [ano, setAno] = useState(padrao.slice(0, 4))
  const [mes, setMes] = useState(padrao.slice(5, 7))
  const [perfil, setPerfil] = useState<PerfilSped>(config.perfil)
  const [finalidade, setFinalidade] = useState<FinalidadeSped>('0')
  const [saldo, setSaldo] = useState('')
  const [erroSaldo, setErroSaldo] = useState('')
  const [previa, setPrevia] = useState<{ chave: string; dados: PreviaSped } | null>(null)
  const [gerado, setGerado] = useState<ArquivoSped | null>(null)

  const anoAtual = Number(hoje.slice(0, 4))
  const anos = Array.from({ length: 6 }, (_, i) => String(anoAtual - i))
  const saldoCent = saldo.trim() ? textoParaCentavos(saldo) : undefined
  const corpo: CorpoSped = {
    periodo: `${ano}-${mes}`, perfil, finalidade,
    ...(saldoCent != null ? { saldo_credor_anterior_cent: saldoCent } : {}),
  }
  const chave = chavePrevia(corpo)

  function corpoValido() {
    if (saldo.trim() && (saldoCent == null || saldoCent < 0)) {
      setErroSaldo('Valor inválido. Use o formato 1.234,56 ou deixe em branco para usar o automático.')
      return false
    }
    setErroSaldo('')
    return true
  }

  const conferir = useMutation({
    mutationFn: (c: CorpoSped) => api<PreviaSped>(rotaEmpresa(eid, 'sped/previa'), json('POST', c)),
    onMutate: () => setGerado(null),
    onSuccess: (dados, c) => setPrevia({ chave: chavePrevia(c), dados }),
  })
  const gerar = useMutation({
    mutationFn: (c: CorpoSped) => api<ArquivoSped>(rotaEmpresa(eid, 'sped/gerar'), json('POST', c)),
    onMutate: () => setGerado(null),
    onSuccess: (a) => {
      setGerado(a)
      void cliente.invalidateQueries({ queryKey: ['sped-arquivos', eid] })
    },
  })
  const errosGerar = errosDoGerar(gerar.error)

  const mesmaPrevia = previa?.chave === chave
  const podeGerar = !!previa && mesmaPrevia && previa.dados.erros.length === 0 && !gerar.isPending
  const p = previa?.dados

  return (
    <div className="blocos-largos">
      <section className="bloco parametros-sped" aria-labelledby="t-param-sped">
        <h2 id="t-param-sped">Parâmetros</h2>
        <div className="linha-periodo">
          <div className="campo">
            <label htmlFor="sped-mes"><span>Mês</span></label>
            <select id="sped-mes" className="entrada" value={mes} onChange={(e) => setMes(e.target.value)}>
              {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="sped-ano"><span>Ano</span></label>
            <select id="sped-ano" className="entrada" value={ano} onChange={(e) => setAno(e.target.value)}>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <fieldset className="opcoes">
            <legend>Finalidade</legend>
            <label className="opcao"><input type="radio" name="finalidade" checked={finalidade === '0'}
              onChange={() => setFinalidade('0')} /> Original</label>
            <label className="opcao"><input type="radio" name="finalidade" checked={finalidade === '1'}
              onChange={() => setFinalidade('1')} /> Substituto</label>
          </fieldset>
        </div>

        <fieldset className="cartoes-tributo sem-borda">
          <legend className="so-leitor">Perfil do arquivo</legend>
          {PERFIS.map((op) => (
            <label key={op.valor} className={`cartao cartao-tributo cartao-opcao${perfil === op.valor ? ' on' : ''}`}>
              <input type="radio" name="perfil" value={op.valor} checked={perfil === op.valor} onChange={() => setPerfil(op.valor)} />
              <span><b>{op.titulo}</b><small>{op.texto}{config.perfil === op.valor ? ' Padrão da empresa.' : ''}</small></span>
            </label>
          ))}
        </fieldset>

        <div className="grade-campos">
          <Campo rotulo="Saldo credor anterior (opcional)" erro={erroSaldo || undefined}
            dica={p && mesmaPrevia
              ? <>Automático: <b>{brl(p.saldo_anterior.cent)}</b> — {p.saldo_anterior.origem}. Preencha só para substituir.</>
              : 'Em branco, usa o saldo transportado do mês anterior ou o saldo inicial da configuração.'}>
            {(pr) => <input {...pr} className="entrada mono entrada-num" inputMode="decimal" placeholder="0,00" value={saldo}
              onChange={(e) => setSaldo(e.target.value)} />}
          </Campo>
        </div>

        <div className="acoes-form">
          <button type="button" className="botao sec" disabled={conferir.isPending}
            onClick={() => { if (corpoValido()) conferir.mutate(corpo) }}>
            {conferir.isPending ? 'Conferindo…' : 'Conferir'}</button>
          <button type="button" className="botao" disabled={!podeGerar}
            onClick={() => { if (corpoValido()) gerar.mutate(corpo) }}>
            {gerar.isPending ? 'Gerando…' : 'Gerar arquivo'}</button>
        </div>
        {!previa && <p className="mudo dica">Confira o período antes de gerar: o arquivo só sai sem erros.</p>}
        {previa && !mesmaPrevia && (
          <p className="aviso" role="status">Os parâmetros mudaram desde a última conferência. Clique em Conferir de novo.</p>
        )}
        {conferir.isError && <p className="erro" role="alert">{mensagemErro(conferir.error)}</p>}
        {gerar.isError && (
          <div className="erro" role="alert">
            <p className="titulo-lista">{mensagemErro(gerar.error)}</p>
            {errosGerar && errosGerar.erros.length > 0 && (
              <ul className="lista-erros">{errosGerar.erros.map((e) => <li key={e}>{e}</li>)}</ul>
            )}
          </div>
        )}
        {gerado && (
          <p className="ok" role="status">Arquivo de {periodoBR(gerado.periodo)} gerado: {inteiro(gerado.linhas)} linhas.{' '}
            <a href={rotaEmpresa(eid, `sped/arquivos/${gerado.id}/download`)} download>Baixar agora</a></p>
        )}
      </section>

      {p && mesmaPrevia && <ResultadoPrevia p={p} />}

      <Arquivos eid={eid} />
    </div>
  )
}

function ResultadoPrevia({ p }: { p: PreviaSped }) {
  return (
    <section className="bloco" aria-labelledby="t-previa-sped">
      <h2 id="t-previa-sped">Conferência de {periodoBR(p.periodo)}{' '}
        {p.erros.length ? <Selo texto={`${p.erros.length} erro(s)`} tom="vermelho" /> : <Selo texto="Pronto para gerar" tom="verde" />}
      </h2>
      {p.erros.length > 0 && (
        <div className="erro" role="alert">
          <p className="titulo-lista"><b>Erros que impedem a geração</b></p>
          <ul className="lista-erros">{p.erros.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {p.alertas.length > 0 && (
        <div className="aviso">
          <p className="titulo-lista"><b>Alertas</b> (não bloqueiam; confira antes de transmitir)</p>
          <ul className="lista-alertas">{p.alertas.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {p.resumo && (
        <div className="indicadores espaco-acima">
          <Indicador rotulo="Saídas" valor={inteiro(p.resumo.saidas)} />
          <Indicador rotulo="Entradas" valor={inteiro(p.resumo.entradas)} />
          <Indicador rotulo="Participantes" valor={inteiro(p.resumo.participantes)} />
          <Indicador rotulo="Itens (0200)" valor={inteiro(p.resumo.itens)} />
          <Indicador rotulo="C170" valor={inteiro(p.resumo.c170)} />
          <Indicador rotulo="Linhas" valor={inteiro(p.linhas)} />
        </div>
      )}
      {p.apuracao && <Apuracao a={p.apuracao} />}
    </section>
  )
}

export function Apuracao({ a }: { a: ApuracaoSped }) {
  const st = a.st ?? []
  const difal = a.difal ?? []
  return (
    <div className="grade-2 espaco-acima">
      <div className="apuracao-sped">
        <h3>Apuração do ICMS (E110)</h3>
        <dl className="resumo-linhas">
          <div><dt>Débitos</dt><dd className="mono">{brl(a.debitos_cent)}</dd></div>
          <div><dt>Créditos</dt><dd className="mono">{brl(a.creditos_cent)}</dd></div>
          <div><dt>Saldo credor anterior</dt><dd className="mono">{brl(a.saldo_credor_anterior_cent)}</dd></div>
          {a.deducoes_cent > 0 && <div><dt>Deduções</dt><dd className="mono">{brl(a.deducoes_cent)}</dd></div>}
          <div className="resumo-total"><dt>ICMS a recolher</dt><dd className="mono">{brl(a.icms_recolher_cent)}</dd></div>
          <div><dt>Saldo credor a transportar</dt><dd className="mono">{brl(a.saldo_credor_transportar_cent)}</dd></div>
        </dl>
      </div>
      {(st.length > 0 || difal.length > 0 || a.ipi) && (
        <div>
          {st.length > 0 && (
            <>
              <h3>ICMS-ST retido (E200)</h3>
              <table className="tabela">
                <thead><tr><th scope="col">UF</th><th scope="col" className="num">Retido</th></tr></thead>
                <tbody>{st.map((s) => <tr key={s.uf}><td>{s.uf}</td><td className="num">{brl(s.retido_cent)}</td></tr>)}</tbody>
              </table>
            </>
          )}
          {difal.length > 0 && (
            <>
              <h3>DIFAL e FCP (E300)</h3>
              <table className="tabela">
                <thead><tr><th scope="col">UF</th><th scope="col" className="num">DIFAL</th><th scope="col" className="num">FCP</th></tr></thead>
                <tbody>{difal.map((d) => (
                  <tr key={d.uf}><td>{d.uf}</td><td className="num">{brl(d.difal_cent)}</td><td className="num">{brl(d.fcp_cent)}</td></tr>
                ))}</tbody>
              </table>
            </>
          )}
          {a.ipi && (
            <>
              <h3>Apuração do IPI (E520)</h3>
              <dl className="resumo-linhas">
                <div><dt>Débitos</dt><dd className="mono">{brl(a.ipi.debitos_cent)}</dd></div>
                <div><dt>Créditos</dt><dd className="mono">{brl(a.ipi.creditos_cent)}</dd></div>
                <div><dt>Saldo devedor</dt><dd className="mono">{brl(a.ipi.saldo_devedor_cent)}</dd></div>
                <div><dt>Saldo credor</dt><dd className="mono">{brl(a.ipi.saldo_credor_cent)}</dd></div>
              </dl>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Arquivos({ eid }: { eid: number }) {
  const q = useQuery({
    queryKey: ['sped-arquivos', eid],
    queryFn: () => api<ArquivoSped[]>(rotaEmpresa(eid, 'sped/arquivos')),
  })
  return (
    <section className="bloco" aria-labelledby="t-arquivos-sped">
      <h2 id="t-arquivos-sped">Arquivos gerados</h2>
      {q.isError && <p className="erro" role="alert">{mensagemErro(q.error)}</p>}
      {q.isPending && <p className="mudo" role="status">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="vazio mudo">Nenhum arquivo gerado ainda</p>}
      {q.data && q.data.length > 0 && (
        <div className="rolagem">
          <table className="tabela">
            <thead>
              <tr><th scope="col">Período</th><th scope="col">Perfil</th><th scope="col">Finalidade</th>
                <th scope="col" className="num">Linhas</th><th scope="col" className="num">ICMS a recolher</th>
                <th scope="col">Gerado em</th><th scope="col">Por</th><th scope="col">Arquivo</th></tr>
            </thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{periodoBR(a.periodo)}</td>
                  <td>{a.perfil}</td>
                  <td>{a.finalidade === '1' ? <Selo texto="Substituto" tom="laranja" /> : <Selo texto="Original" tom="azul" />}</td>
                  <td className="num">{inteiro(a.linhas)}</td>
                  <td className="num">{brl(a.apuracao?.icms_recolher_cent)}</td>
                  <td className="mono">{dataHoraBR(a.gerado_em)}</td>
                  <td>{a.usuario_nome ?? '—'}</td>
                  <td>
                    <a className="botao-texto acoes" href={rotaEmpresa(eid, `sped/arquivos/${a.id}/download`)} download
                      aria-label={`Baixar o SPED de ${periodoBR(a.periodo)}, perfil ${a.perfil}`}>
                      <Icone nome="baixar" tamanho={14} />Baixar</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ---------------- Configuração ---------------- */

const CONTABILISTA_VAZIO: Contabilista = {
  nome: '', cpf: '', crc: '', cnpj: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', fone: '', email: '',
  cod_municipio: '',
}

type FormSped = Omit<ConfigSped, 'dia_vencimento' | 'saldo_credor_inicial_cent'> & { dia: string; saldo: string }

function formDaConfig(c: ConfigSped): FormSped {
  const { dia_vencimento, saldo_credor_inicial_cent, ...resto } = c
  return { ...resto, contabilista: { ...CONTABILISTA_VAZIO, ...c.contabilista }, dia: String(dia_vencimento ?? 20), saldo: centavosParaTexto(saldo_credor_inicial_cent ?? 0) }
}

/** Confere o formulário da configuração; devolve os erros por campo. */
export function validarConfigSped(f: FormSped) {
  const erros: Record<string, string> = {}
  const dia = Number(f.dia)
  if (!Number.isInteger(dia) || dia < 1 || dia > 28) erros.dia = 'De 1 a 28'
  const s = textoParaCentavos(f.saldo)
  if (f.saldo.trim() && (s == null || s < 0)) erros.saldo = 'Valor inválido'
  if (f.atividade === '0' && !f.ind_classif) erros.ind_classif = 'Obrigatória para industrial'
  const cpf = f.contabilista.cpf.replace(/\D/g, '')
  if (cpf && cpf.length !== 11) erros.cpf = 'CPF com 11 dígitos'
  const cnpj = f.contabilista.cnpj.replace(/\D/g, '')
  if (cnpj && cnpj.length !== 14) erros.cnpj = 'CNPJ com 14 dígitos'
  const mun = f.contabilista.cod_municipio.replace(/\D/g, '')
  if (mun && mun.length !== 7) erros.cod_municipio = 'Código IBGE com 7 dígitos'
  return erros
}

function FormConfig({ eid, config }: { eid: number; config: ConfigSped }) {
  const cliente = useQueryClient()
  const [f, setF] = useState(() => formDaConfig(config))
  const [erros, setErros] = useState<Record<string, string>>({})
  const [ok, setOk] = useState(false)
  const salvar = useMutation({
    mutationFn: (corpo: ConfigSped) => api<ConfigSped>(rotaEmpresa(eid, 'sped/config'), json('PUT', corpo)),
    onMutate: () => setOk(false),
    onSuccess: (c) => { cliente.setQueryData(['sped-config', eid], c); setF(formDaConfig(c)); setOk(true) },
  })
  const ct = (k: keyof Contabilista, v: string) => setF((a) => ({ ...a, contabilista: { ...a.contabilista, [k]: v } }))

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    const v = validarConfigSped(f)
    setErros(v)
    if (Object.keys(v).length) return
    const { dia, saldo, ...resto } = f
    salvar.mutate({
      ...resto, ind_classif: f.atividade === '0' ? f.ind_classif : '',
      dia_vencimento: Number(dia), saldo_credor_inicial_cent: textoParaCentavos(saldo) ?? 0,
    })
  }

  const campoCt = (k: keyof Contabilista, rotulo: string, extra: { mono?: boolean; largo?: boolean; tipo?: string } = {}) => (
    <Campo rotulo={rotulo} erro={erros[k]} largo={extra.largo}>
      {(p) => <input {...p} type={extra.tipo ?? 'text'} className={`entrada${extra.mono ? ' mono' : ''}`} value={f.contabilista[k]}
        onChange={(e) => ct(k, e.target.value)} />}
    </Campo>
  )

  return (
    <form className="blocos" onSubmit={enviar} noValidate>
      <section className="bloco" aria-labelledby="t-cfg-geral">
        <h2 id="t-cfg-geral">Escrituração</h2>
        <div className="grade-campos">
          <Campo rotulo="Perfil padrão">
            {(p) => <select {...p} className="entrada" value={f.perfil} onChange={(e) => setF({ ...f, perfil: e.target.value as PerfilSped })}>
              {PERFIS.map((op) => <option key={op.valor} value={op.valor}>{op.titulo}</option>)}
            </select>}
          </Campo>
          <Campo rotulo="Atividade">
            {(p) => <select {...p} className="entrada" value={f.atividade}
              onChange={(e) => setF({ ...f, atividade: e.target.value as '0' | '1' })}>
              <option value="0">Industrial ou equiparado</option>
              <option value="1">Outros (comércio, serviços)</option>
            </select>}
          </Campo>
          {f.atividade === '0' && (
            <Campo rotulo="Classificação do estabelecimento (0002)" erro={erros.ind_classif} largo>
              {(p) => <select {...p} className="entrada" value={f.ind_classif} onChange={(e) => setF({ ...f, ind_classif: e.target.value })}>
                <option value="">Selecione</option>
                {CLASSIF_INDUSTRIAL.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
              </select>}
            </Campo>
          )}
        </div>
      </section>

      <section className="bloco" aria-labelledby="t-cfg-contab">
        <h2 id="t-cfg-contab">Contabilista (0100)</h2>
        <div className="grade-campos">
          {campoCt('nome', 'Nome', { largo: true })}
          {campoCt('cpf', 'CPF', { mono: true })}
          {campoCt('crc', 'CRC', { mono: true })}
          {campoCt('cnpj', 'CNPJ do escritório (opcional)', { mono: true })}
          {campoCt('cep', 'CEP', { mono: true })}
          {campoCt('logradouro', 'Logradouro', { largo: true })}
          {campoCt('numero', 'Número')}
          {campoCt('complemento', 'Complemento')}
          {campoCt('bairro', 'Bairro')}
          {campoCt('cod_municipio', 'Código do município (IBGE)', { mono: true })}
          {campoCt('fone', 'Telefone', { mono: true })}
          {campoCt('email', 'E-mail', { tipo: 'email', largo: true })}
        </div>
      </section>

      <section className="bloco" aria-labelledby="t-cfg-apur">
        <h2 id="t-cfg-apur">Apuração e recolhimento</h2>
        <div className="grade-campos">
          <Campo rotulo="Código de receita do ICMS (E116)">
            {(p) => <input {...p} className="entrada mono" value={f.cod_receita} onChange={(e) => setF({ ...f, cod_receita: e.target.value })} />}
          </Campo>
          <Campo rotulo="Código de receita do ICMS-ST (E250)">
            {(p) => <input {...p} className="entrada mono" value={f.cod_receita_st} onChange={(e) => setF({ ...f, cod_receita_st: e.target.value })} />}
          </Campo>
          <Campo rotulo="Código de receita do DIFAL (E316)">
            {(p) => <input {...p} className="entrada mono" value={f.cod_receita_difal}
              onChange={(e) => setF({ ...f, cod_receita_difal: e.target.value })} />}
          </Campo>
          <Campo rotulo="Dia de vencimento" erro={erros.dia} dica="No mês seguinte ao período (1 a 28).">
            {(p) => <input {...p} className="entrada mono entrada-num" inputMode="numeric" value={f.dia}
              onChange={(e) => setF({ ...f, dia: e.target.value.replace(/\D/g, '').slice(0, 2) })} />}
          </Campo>
          <Campo rotulo="Saldo credor inicial (R$)" erro={erros.saldo}
            dica="Usado no primeiro arquivo, quando não há SPED do mês anterior gerado aqui.">
            {(p) => <input {...p} className="entrada mono entrada-num" inputMode="decimal" value={f.saldo}
              onChange={(e) => setF({ ...f, saldo: e.target.value })} />}
          </Campo>
        </div>
        <div className="espaco-acima">
          <Marcar rotulo="Incluir notas de homologação (somente testes)" marcado={f.incluir_homologacao}
            dica="notas sem valor fiscal; nunca use em arquivo para transmitir"
            mudar={(v) => setF({ ...f, incluir_homologacao: v })} />
        </div>
      </section>

      {Object.keys(erros).length > 0 && <p className="erro" role="alert">Confira os campos destacados.</p>}
      {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
      {ok && <p className="ok" role="status">Configuração do SPED salva.</p>}
      <div className="acoes-form">
        <button type="submit" className="botao" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar configuração'}</button>
      </div>
    </form>
  )
}

export function PaginaSped({ aba }: { aba: AbaSped }) {
  return <ComEmpresa>{(eid) => <Conteudo key={eid} eid={eid} aba={aba} />}</ComEmpresa>
}
