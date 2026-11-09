import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, json, lerBase64, mensagemErro } from '../api'
import { CamposCertificado, CamposEmpresa, type ErrosEmp, corpoEmpresa, formEmpresaVazio, validarEmpresa }
  from '../componentes/FormEmpresa'
import { useEmpresa, useListaEmpresas } from '../empresa'
import { cnpjBR, dataBR } from '../formato'
import { type Empresa, ROTULO_CRT } from '../tipos'
import { Icone } from '../ui/Icone'
import { SeloAmbiente, SeloCertificado } from '../ui/Selo'
import { TituloPagina } from '../ui/TituloPagina'

/** /empresas — Empresas da carteira, com busca local por nome ou CNPJ. */
export function PaginaEmpresas() {
  const lista = useListaEmpresas()
  const { atual, definir } = useEmpresa()
  const navegar = useNavigate()
  const [busca, setBusca] = useState('')
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const digitos = busca.replace(/\D/g, '')
  const filtradas = (lista.data ?? []).filter((e) => !termo
    || e.razao_social.toLocaleLowerCase('pt-BR').includes(termo)
    || (e.nome_fantasia ?? '').toLocaleLowerCase('pt-BR').includes(termo)
    || (digitos !== '' && e.cnpj.includes(digitos)))

  return (
    <section className="empresas">
      <TituloPagina titulo="Empresas da" destaque="carteira" apoio="Empresas que emitem notas por este sistema"
        acoes={<Link to="/empresas/nova" className="botao"><Icone nome="mais" />Cadastrar empresa</Link>} />
      <div className="ferramentas">
        <div className="busca" role="search">
          <input type="search" className="entrada" aria-label="Buscar empresa por nome ou CNPJ"
            placeholder="Nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      {lista.isError ? (
        <p className="erro" role="alert">{mensagemErro(lista.error)}</p>
      ) : !lista.data ? (
        <p className="mudo" role="status">Carregando…</p>
      ) : filtradas.length === 0 ? (
        <p className="vazio mudo">{lista.data.length === 0 ? 'Nenhuma empresa cadastrada' : 'Nenhuma empresa encontrada'}</p>
      ) : (
        <div className="cartao rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Empresa</th><th scope="col">CNPJ</th><th scope="col">UF</th><th scope="col">Regime</th>
                <th scope="col">Ambiente</th><th scope="col">Certificado</th><th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((e) => (
                <tr key={e.id} className={e.id === atual?.id ? 'linha-ativa' : undefined}>
                  <td>
                    <b>{e.razao_social}</b>
                    {e.nome_fantasia && <div className="mudo">{e.nome_fantasia}</div>}
                  </td>
                  <td className="mono">{cnpjBR(e.cnpj)}</td>
                  <td>{e.uf}</td>
                  <td>{ROTULO_CRT[e.crt] ?? e.crt}</td>
                  <td><SeloAmbiente ambiente={e.ambiente} /></td>
                  <td>
                    <SeloCertificado validade={e.certificado_validade} />
                    {e.certificado_validade && <div className="mudo dica">até {dataBR(e.certificado_validade)}</div>}
                  </td>
                  <td>
                    <span className="acoes-linha">
                      {e.id === atual?.id
                        ? <span className="mudo">Selecionada</span>
                        : <button type="button" className="botao-texto" onClick={() => definir(e.id)}>Selecionar</button>}
                      <button type="button" className="botao-texto"
                        onClick={() => { definir(e.id); navegar('/configuracoes/empresa') }}>Configurar</button>
                    </span>
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

/** /empresas/nova — cadastro com consulta à Receita e certificado A1. Sempre entra em homologação. */
export function PaginaEmpresaNova() {
  const navegar = useNavigate()
  const cliente = useQueryClient()
  const { definir } = useEmpresa()
  const [f, setF] = useState(formEmpresaVazio)
  const [erros, setErros] = useState<ErrosEmp & { certificado?: string }>({})
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [senhaCert, setSenhaCert] = useState('')

  const salvar = useMutation({
    mutationFn: async () => {
      const certificado_base64 = await lerBase64(arquivo!)
      return api<Empresa>('/api/empresas', json('POST', { ...corpoEmpresa(f), certificado_base64, certificado_senha: senhaCert }))
    },
    onSuccess: async (emp) => {
      await cliente.invalidateQueries({ queryKey: ['empresas'] })
      definir(emp.id)
      navegar('/configuracoes/empresa', { state: { criada: true } })
    },
  })

  function submeter(ev: FormEvent) {
    ev.preventDefault()
    const v: ErrosEmp & { certificado?: string } = validarEmpresa(f)
    if (!arquivo) v.certificado = 'Escolha o arquivo do certificado A1'
    else if (!senhaCert) v.certificado = 'Digite a senha do certificado'
    setErros(v)
    if (Object.keys(v).length > 0) return
    salvar.mutate()
  }

  return (
    <section className="empresa-nova">
      <TituloPagina titulo="Cadastrar" destaque="empresa"
        migalhas={[{ rotulo: 'Empresas da carteira', para: '/empresas' }, { rotulo: 'Cadastrar empresa' }]}
        apoio="A empresa entra em homologação. O sistema cria 3 perfis fiscais padrão de acordo com o regime." />
      <form className="cartao formulario" onSubmit={submeter} noValidate>
        <CamposEmpresa f={f} setF={setF} erros={erros} />
        <fieldset className="grupo">
          <legend>Certificado digital</legend>
          <CamposCertificado arquivo={arquivo} setArquivo={setArquivo} senha={senhaCert} setSenha={setSenhaCert}
            erro={erros.certificado} obrigatorio />
        </fieldset>
        {Object.keys(erros).length > 0 && <p className="erro" role="alert">Confira os campos destacados.</p>}
        {salvar.isError && <p className="erro" role="alert">{mensagemErro(salvar.error)}</p>}
        <div className="acoes-form">
          <button type="submit" className="botao" disabled={salvar.isPending}>
            {salvar.isPending ? 'Cadastrando…' : 'Cadastrar'}
          </button>
          <Link to="/empresas" className="botao sec">Cancelar</Link>
        </div>
      </form>
    </section>
  )
}
