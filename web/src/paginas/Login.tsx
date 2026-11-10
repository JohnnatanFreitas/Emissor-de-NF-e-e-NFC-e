import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, json, mensagemErro } from '../api'
import { Logo } from '../marca/Logo'
import { MarcaSecran } from '../marca/Secran'
import { Direitos } from '../layout/Direitos'
import type { Eu } from '../tipos'

export function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const cliente = useQueryClient()
  const navegar = useNavigate()

  const entrar = useMutation({
    mutationFn: () => api<Eu>('/api/sessao', json('POST', { email: email.trim(), senha })),
    onSuccess: (eu) => {
      cliente.setQueryData(['eu'], eu)
      navegar('/painel', { replace: true })
    },
    onError: (e) => {
      setErro(mensagemErro(e))
      setSenha('')
    },
  })

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    if (!email.trim() || !senha) {
      setErro('Informe o e-mail e a senha')
      return
    }
    setErro('')
    entrar.mutate()
  }

  return (
    <div className="tela-login">
      <main className="cartao login" aria-labelledby="titulo-login">
        <div className="login-marca"><Logo variante="completa" fundo="escuro" tamanho={40} /></div>
        <p className="login-slogan">Emissão de NF-e e NFC-e para a sua carteira.</p>
        <h1 id="titulo-login">Entrar</h1>
        <form onSubmit={enviar} noValidate>
          <label className="campo">
            <span>E-mail</span>
            <input className="entrada" name="email" type="email" autoComplete="username" autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} aria-invalid={erro ? true : undefined} />
          </label>
          <label className="campo">
            <span>Senha</span>
            <input className="entrada" name="senha" type="password" autoComplete="current-password" value={senha}
              maxLength={256} onChange={(e) => setSenha(e.target.value)} aria-invalid={erro ? true : undefined} />
          </label>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <button type="submit" className="botao largo" disabled={entrar.isPending}>
            {entrar.isPending ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </main>
      <footer className="login-rodape"><MarcaSecran /></footer>
      <Direitos />
    </div>
  )
}
