/** Menu lateral do Argus Emissor (nomes do guia do produto). Cada item aparece só para quem tem uma das `acoes`. */
import type { Acao } from './tipos'
import type { NomeIcone } from './ui/Icone'

export type SubItem = { rotulo: string; para: string; ativo: (caminho: string) => boolean; acoes?: Acao[] }
export type ItemMenu = {
  rotulo: string
  para?: string
  prefixos: string[]
  icone: NomeIcone
  /** sem `acoes`, todos veem; com elas, quem tem pelo menos uma */
  acoes?: Acao[]
  subs?: SubItem[]
}

export const sob = (prefixo: string) => (c: string) => c === prefixo || c.startsWith(prefixo + '/')
const igual = (p: string) => (c: string) => c === p || c === p + '/'

export const MENU: ItemMenu[] = [
  { rotulo: 'Painel', para: '/painel', prefixos: ['/painel'], icone: 'painel' },
  { rotulo: 'Empresas da carteira', para: '/empresas', prefixos: ['/empresas'], icone: 'empresas', acoes: ['gerir_empresas'] },
  {
    rotulo: 'Produtos', para: '/produtos', prefixos: ['/produtos'], icone: 'produtos',
    acoes: ['editar_produtos', 'pedidos', 'estoque'],
  },
  {
    rotulo: 'Estoque', prefixos: ['/estoque'], icone: 'estoque', acoes: ['estoque'],
    subs: [
      { rotulo: 'Saldos', para: '/estoque', ativo: igual('/estoque') },
      { rotulo: 'Ajuste / inventário', para: '/estoque/ajuste', ativo: sob('/estoque/ajuste') },
      { rotulo: 'Movimentos', para: '/estoque/movimentos', ativo: sob('/estoque/movimentos') },
      { rotulo: 'Entrada por XML', para: '/estoque/entrada-xml', ativo: sob('/estoque/entrada-xml') },
      { rotulo: 'Classificar entradas', para: '/estoque/entradas', ativo: sob('/estoque/entradas') },
    ],
  },
  {
    rotulo: 'Clientes e fornecedores', para: '/pessoas', prefixos: ['/pessoas'], icone: 'pessoas',
    acoes: ['editar_pessoas', 'pedidos', 'financeiro'],
  },
  { rotulo: 'Pedidos e orçamentos', para: '/pedidos', prefixos: ['/pedidos'], icone: 'pedidos', acoes: ['pedidos'] },
  { rotulo: 'Notas fiscais', para: '/notas', prefixos: ['/notas'], icone: 'notas' },
  { rotulo: 'Venda balcão (NFC-e)', para: '/balcao', prefixos: ['/balcao'], icone: 'balcao', acoes: ['emitir'] },
  { rotulo: 'Emissão rápida', para: '/emissao-rapida', prefixos: ['/emissao-rapida'], icone: 'rapida', acoes: ['emitir'] },
  {
    rotulo: 'NFS-e (serviços)', prefixos: ['/nfse'], icone: 'servicos', acoes: ['emitir'],
    subs: [
      { rotulo: 'Notas de serviço', para: '/nfse', ativo: (c) => c === '/nfse' || c === '/nfse/' || /^\/nfse\/\d+/.test(c) },
      { rotulo: 'Emitir NFS-e', para: '/nfse/nova', ativo: sob('/nfse/nova') },
      { rotulo: 'Serviços', para: '/nfse/servicos', ativo: sob('/nfse/servicos') },
    ],
  },
  { rotulo: 'Contas a receber', para: '/receber', prefixos: ['/receber'], icone: 'receber', acoes: ['financeiro'] },
  { rotulo: 'SPED Fiscal', para: '/sped', prefixos: ['/sped'], icone: 'sped', acoes: ['sped'] },
  {
    rotulo: 'Configurações', prefixos: ['/configuracoes'], icone: 'configuracoes',
    subs: [
      { rotulo: 'Empresa', para: '/configuracoes/empresa', ativo: sob('/configuracoes/empresa'), acoes: ['gerir_empresas'] },
      { rotulo: 'Perfis fiscais', para: '/configuracoes/perfis', ativo: sob('/configuracoes/perfis'), acoes: ['editar_perfis'] },
      { rotulo: 'Usuários', para: '/configuracoes/usuarios', ativo: sob('/configuracoes/usuarios'), acoes: ['gerir_usuarios'] },
      { rotulo: 'Minha senha', para: '/configuracoes/senha', ativo: sob('/configuracoes/senha') },
    ],
  },
]

export function visivel(acoesItem: Acao[] | undefined, acoes: readonly Acao[]) {
  return !acoesItem || acoesItem.some((a) => acoes.includes(a))
}

export function itemAtivo(item: ItemMenu, caminho: string) {
  return item.prefixos.some((p) => sob(p)(caminho))
}

export function subsVisiveis(subs: SubItem[], acoes: readonly Acao[]) {
  return subs.filter((s) => visivel(s.acoes, acoes))
}

/** Itens do menu que o usuário vê, com o destino resolvido (item sem `para` leva ao primeiro submenu visível). */
export function menuVisivel(acoes: readonly Acao[]) {
  return MENU.flatMap((item) => {
    if (!visivel(item.acoes, acoes)) return []
    const subs = item.subs ? subsVisiveis(item.subs, acoes) : []
    const para = item.para ?? subs[0]?.para
    return para ? [{ ...item, para, subs }] : []
  })
}
