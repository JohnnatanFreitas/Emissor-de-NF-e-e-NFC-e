import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, json, mensagemErro } from '../api'
import { Logo } from '../marca/Logo'
import type { Eu } from '../tipos'
import { TituloPagina } from '../ui/TituloPagina'

export const MIN_SENHA = 12

/** Validação local antes de mandar ao servidor (que também confere). */
export function validarNovaSenha(nova: string, confirmacao: string) {
  if (nova.length < MIN_SENHA) return `A nova senha precisa ter pelo menos ${MIN_SENHA} caracteres`
  if (nova !== confirmacao) return 'A confirmação não confere com a nova senha'
  return ''
}

/** Formulário de troca (`POST /api/eu/senha`), usado na troca obrigatória e em Configurações → Minha senha. */
function FormSenha({ aoTrocar, extra }: { aoTrocar: () => void; extra?: ReactNode }) {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')

  const trocar = useMutation({
    mutationFn: () => api<{ ok: true }>('/api/eu/senha', json('POST', { senha_atual: atual, nova_senha: nova })),
    onSuccess: () => {
      setAtual(''); setNova(''); setConfirmacao('')
      aoTrocar()
    },
    onError: (e) => {
      setErro(mensagemErro(e))
      setAtual('')
    },
  })

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    if (!atual) return setErro('Informe a senha atual')
    const v = validarNovaSenha(nova, confirmacao)
    if (v) return setErro(v)
    setErro('')
    trocar.mutate()
  }

  const invalido = erro ? true : undefined
  return (
    <form onSubmit={enviar} noValidate>
      <label className="campo">
        <span>Senha atual</span>
        <input className="entrada" type="password" autoComplete="current-password" autoFocus value={atual}
          maxLength={256} onChange={(e) => setAtual(e.target.value)} aria-invalid={invalido} />
      </label>
      <label className="campo">
        <span>Nova senha</span>
        <input className="entrada" type="password" autoComplete="new-password" value={nova} maxLength={256}
          onChange={(e) => setNova(e.target.value)} aria-invalid={invalido} aria-describedby="dica-senha" />
        <small id="dica-senha" className="mudo">Pelo menos {MIN_SENHA} caracteres.</small>
      </label>
      <label className="campo">
        <span>Confirme a nova senha</span>
        <input className="entrada" type="password" autoComplete="new-password" value={confirmacao} maxLength={256}
          onChange={(e) => setConfirmacao(e.target.value)} aria-invalid={invalido} />
      </label>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="acoes-form">
        <button type="submit" className="botao" disabled={trocar.isPending}>
          {trocar.isPending ? 'Trocando…' : 'Trocar senha'}
        </button>
        {extra}
      </div>
    </form>
  )
}

/** Tela única enquanto a senha é provisória (`trocar_senha` no /api/eu). */
export function TrocarSenha({ eu }: { eu: Eu }) {
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const sair = useMutation({
    mutationFn: () => api<void>('/api/sessao', { method: 'DELETE' }),
    onSuccess: () => {
      navegar('/login', { replace: true })
      cliente.clear()
    },
  })
  return (
    <div className="tela-login">
      <main className="cartao login" aria-labelledby="titulo-troca">
        <div className="login-marca"><Logo variante="completa" fundo="escuro" tamanho={40} /></div>
        <h1 id="titulo-troca">Troque a senha provisória</h1>
        <p className="mudo">{eu.nome}, defina uma senha sua para continuar usando o sistema.</p>
        <FormSenha aoTrocar={() => void cliente.invalidateQueries({ queryKey: ['eu'] })}
          extra={<button type="button" className="botao sec" disabled={sair.isPending} onClick={() => sair.mutate()}>Sair</button>} />
        {sair.isError && <p className="erro" role="alert">{mensagemErro(sair.error)}</p>}
      </main>
    </div>
  )
}

/** Configurações → Minha senha. */
export function PaginaMinhaSenha() {
  const [ok, setOk] = useState(false)
  return (
    <section className="minha-senha">
      <TituloPagina titulo="Minha" destaque="senha" migalhas={[{ rotulo: 'Configurações' }, { rotulo: 'Minha senha' }]} />
      <div className="cartao formulario-estreito">
        <FormSenha aoTrocar={() => setOk(true)} />
        {ok && <p className="ok" role="status">Senha trocada.</p>}
      </div>
    </section>
  )
}
