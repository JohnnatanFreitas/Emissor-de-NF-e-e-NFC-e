import { QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { criarQueryClient } from './api'
import { Layout } from './layout/Layout'
import { PaginaBalcao } from './paginas/Balcao'
import { PaginaConfigEmpresa } from './paginas/ConfigEmpresa'
import { PaginaEmpresaNova, PaginaEmpresas } from './paginas/Empresas'
import { PaginaEntradaXml } from './paginas/EntradaXml'
import { PaginaAjuste, PaginaEstoque, PaginaMovimentos } from './paginas/Estoque'
import { Exige, NaoEncontrada } from './paginas/Guardas'
import { Login } from './paginas/Login'
import { PaginaNota, PaginaNotas } from './paginas/Notas'
import { PaginaPedido, PaginaPedidos } from './paginas/Pedidos'
import { PaginaPerfil, PaginaPerfis } from './paginas/Perfis'
import { PaginaPessoa, PaginaPessoas } from './paginas/Pessoas'
import { PaginaProduto, PaginaProdutos } from './paginas/Produtos'
import { PaginaReceber } from './paginas/Receber'
import { PaginaMinhaSenha } from './paginas/TrocarSenha'
import { PaginaUsuarios } from './paginas/Usuarios'

// O Painel carrega o Recharts: fica num chunk à parte, baixado só ao abrir a página.
const PaginaPainel = lazy(() => import('./paginas/Painel').then((m) => ({ default: m.PaginaPainel })))

export function Rotas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/painel" replace />} />
        <Route path="painel" element={
          <Suspense fallback={<p className="mudo" role="status">Carregando…</p>}><PaginaPainel /></Suspense>
        } />
        <Route path="empresas" element={<Exige acoes={['gerir_empresas']}><PaginaEmpresas /></Exige>} />
        <Route path="empresas/nova" element={<Exige acoes={['gerir_empresas']}><PaginaEmpresaNova /></Exige>} />
        <Route path="produtos" element={<Exige acoes={['editar_produtos', 'pedidos', 'estoque']}><PaginaProdutos /></Exige>} />
        <Route path="produtos/:id" element={<Exige acoes={['editar_produtos']}><PaginaProduto /></Exige>} />
        <Route path="estoque" element={<Exige acoes={['estoque']}><PaginaEstoque /></Exige>} />
        <Route path="estoque/ajuste" element={<Exige acoes={['estoque']}><PaginaAjuste /></Exige>} />
        <Route path="estoque/movimentos" element={<Exige acoes={['estoque']}><PaginaMovimentos /></Exige>} />
        <Route path="estoque/entrada-xml" element={<Exige acoes={['estoque']}><PaginaEntradaXml /></Exige>} />
        <Route path="pessoas" element={<Exige acoes={['editar_pessoas', 'pedidos', 'financeiro']}><PaginaPessoas /></Exige>} />
        <Route path="pessoas/:id" element={<Exige acoes={['editar_pessoas']}><PaginaPessoa /></Exige>} />
        <Route path="pedidos" element={<Exige acoes={['pedidos']}><PaginaPedidos /></Exige>} />
        <Route path="pedidos/:id" element={<Exige acoes={['pedidos']}><PaginaPedido /></Exige>} />
        <Route path="notas" element={<PaginaNotas />} />
        <Route path="notas/:id" element={<PaginaNota />} />
        <Route path="balcao" element={<Exige acoes={['emitir']}><PaginaBalcao /></Exige>} />
        <Route path="receber" element={<Exige acoes={['financeiro']}><PaginaReceber /></Exige>} />
        <Route path="configuracoes" element={<Navigate to="/configuracoes/senha" replace />} />
        <Route path="configuracoes/empresa" element={<Exige acoes={['gerir_empresas']}><PaginaConfigEmpresa /></Exige>} />
        <Route path="configuracoes/perfis" element={<Exige acoes={['editar_perfis']}><PaginaPerfis /></Exige>} />
        <Route path="configuracoes/perfis/:id" element={<Exige acoes={['editar_perfis']}><PaginaPerfil /></Exige>} />
        <Route path="configuracoes/usuarios" element={<Exige acoes={['gerir_usuarios']}><PaginaUsuarios /></Exige>} />
        <Route path="configuracoes/senha" element={<PaginaMinhaSenha />} />
        <Route path="*" element={<NaoEncontrada />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const [cliente] = useState(criarQueryClient)
  return (
    <QueryClientProvider client={cliente}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Rotas />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
