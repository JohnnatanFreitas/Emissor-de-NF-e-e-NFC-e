/** Tipos espelhando docs/API.md do Argus Emissor. Dinheiro sempre em centavos (campos `_cent`). */

export type Papel = 'admin' | 'equipe' | 'vendedor' | 'financeiro'
export type Acao = 'gerir_usuarios' | 'gerir_empresas' | 'liberar_producao' | 'editar_perfis' | 'editar_produtos'
  | 'editar_pessoas' | 'pedidos' | 'emitir' | 'cancelar_nota' | 'estoque' | 'financeiro' | 'sped'

export type Eu = {
  id: number; nome: string; email: string; papel: Papel
  /** null = todas as empresas */
  empresas: number[] | null
  trocar_senha: boolean
  acoes: Acao[]
}

export type Usuario = {
  id: number; nome: string; email: string; papel: Papel; empresas: number[] | null; ativo: boolean
  trocar_senha: boolean; criado_em: string
}

export type DadosReceita = {
  cnpj: string; razao_social: string; nome_fantasia: string; logradouro: string; numero: string; complemento: string
  bairro: string; cod_municipio: string; municipio: string; uf: string; cep: string; fone: string; email: string
  cnae: string; crt_sugerido: '1' | '3'; situacao: string
}

export type Crt = '1' | '2' | '3'
export type Ambiente = 1 | 2

export type EmpresaEntrada = {
  cnpj: string; razao_social: string; nome_fantasia: string; ie: string; im?: string; crt: Crt; cnae?: string
  logradouro: string; numero: string; complemento?: string; bairro: string; cod_municipio: string; municipio: string
  uf: string; cep: string; fone?: string; email?: string
  serie_nfe: number; proximo_nfe: number; serie_nfce: number; proximo_nfce: number
}
export type Certificado = { titular: string; validade: string; dias_restantes: number }
export type Empresa = EmpresaEntrada & {
  id: number; ambiente: Ambiente; csc_id: string | null; tem_csc: boolean; certificado: Certificado | null
  criado_em: string
}
export type EmpresaResumo = {
  id: number; cnpj: string; razao_social: string; nome_fantasia: string; uf: string; crt: Crt; ambiente: Ambiente
  certificado_validade: string | null
}
export type StatusSefaz = { cStat: string; xMotivo: string; modelo: '55' }

export type StatusNota = 'enviando' | 'autorizada' | 'rejeitada' | 'denegada' | 'cancelada' | 'pendente'
  | 'nao_enviada' | 'falha_assinatura' | 'inutilizada'
export type StatusInutilizacao = 'enviando' | 'homologada' | 'rejeitada' | 'sem_resposta'
export type Inutilizacao = {
  id: number; modelo: '55' | '65'; serie: number; numero_inicial: number; numero_final: number; justificativa: string
  ambiente: 1 | 2; status: StatusInutilizacao; protocolo: string | null; c_stat: string | null; x_motivo: string | null
  usuario_nome: string | null; criado_em: string
}
export type Modelo = '55' | '65'

export type Totais = {
  produtos_cent: number; desconto_cent: number; bc_icms_cent: number; icms_cent: number; icms_st_cent: number
  ipi_cent: number; pis_cent: number; cofins_cent: number; bc_ibscbs_cent: number; ibs_cent: number; cbs_cent: number
  total_cent: number
  /** extras devolvidos pelo backend (fora do API.md): DIFAL, base da ST e IBS por esfera */
  icms_uf_dest_cent?: number; bc_icms_st_cent?: number; ibs_uf_cent?: number; ibs_mun_cent?: number
}
export type ItemCalculado = {
  produto_id: number; codigo: string; descricao: string; quantidade: number; valor_unitario_cent: number
  desconto_cent: number; valor_cent: number; cfop: string; cst_icms: string; bc_icms_cent: number; aliq_icms: number
  icms_cent: number; icms_st_cent: number; ipi_cent: number; pis_cent: number; cofins_cent: number
  bc_ibscbs_cent: number; ibs_cent: number; cbs_cent: number
}
export type Calculo = { interestadual: boolean; consumidor_final: boolean; itens: ItemCalculado[]; totais: Totais }

export type NotaResumo = {
  id: number; modelo: Modelo; serie: number; numero: number; chave: string; status: StatusNota; ambiente: Ambiente
  destinatario: string; total_cent: number; emitida_em: string; c_stat: string | null; x_motivo: string | null
  pedido_id: number | null
}
export type EventoNota = {
  id: number; tipo: 'cce' | 'cancelamento'; sequencia: number; texto: string; protocolo: string | null
  c_stat: string | null; x_motivo: string | null; criado_em: string
}
export type Pagamento = { tPag: string; valor_cent: number }
export type Nota = NotaResumo & {
  protocolo: string | null; natureza: string; totais: Totais; itens: ItemCalculado[]; pagamentos: Pagamento[]
  eventos: EventoNota[]
  duplicatas?: { numero: string; vencimento: string; valor_cent: number }[]
  autorizada_em?: string | null; cancelada_em?: string | null
  pode: { cancelar: boolean; cce: boolean; reenviar: boolean; consultar: boolean }
}

export type Painel = {
  notas_mes: number; faturamento_mes_cent: number; ibs_mes_cent: number; cbs_mes_cent: number; icms_mes_cent: number
  receber_aberto_cent: number; receber_vencido_cent: number; pedidos_abertos: number
  estoque_baixo: { id: number; codigo: string; descricao: string; estoque: number }[]
  ultimas_notas: NotaResumo[]
  faturamento_dias: { dia: string; total_cent: number }[]
}

export type PerfilEntrada = {
  nome: string; ativo: boolean
  cfop_interno: string; cfop_interestadual: string; cfop_nfce: string
  origem: string; cst_icms: string
  aliq_icms_interna: number; aliq_icms_interestadual: number; reducao_bc_icms: number
  mva_st: number; aliq_icms_st: number
  cst_pis: string; aliq_pis: number; cst_cofins: string; aliq_cofins: number
  cst_ipi: string | null; aliq_ipi: number
  informar_ibscbs: boolean; cst_ibscbs: string; cclass_trib: string
  aliq_ibs_uf: number; aliq_ibs_mun: number; aliq_cbs: number
  ibscbs_base_liquida: boolean
}
export type PerfilFiscal = PerfilEntrada & { id: number; empresa_id: number }

export type ProdutoEntrada = {
  codigo: string; descricao: string; ncm: string; cest?: string; ean?: string; unidade: string
  preco_cent: number; perfil_id: number; estoque_minimo: number; ativo: boolean
}
export type Produto = ProdutoEntrada & { id: number; estoque: number; custo_medio_cent: number; perfil_nome: string }

export type TipoPessoa = 'cliente' | 'fornecedor' | 'ambos'
export type IndIeDest = '1' | '2' | '9'
export type PessoaEntrada = {
  tipo: TipoPessoa; cpf_cnpj: string; nome: string; nome_fantasia?: string; ind_ie_dest: IndIeDest; ie?: string
  email?: string; fone?: string; logradouro: string; numero: string; complemento?: string; bairro: string
  cod_municipio: string; municipio: string; uf: string; cep: string; ativo: boolean
}
export type Pessoa = PessoaEntrada & { id: number }

export type ItemPedidoEntrada = { produto_id: number; quantidade: number; valor_unitario_cent: number; desconto_cent?: number }
export type PedidoEntrada = {
  tipo: 'orcamento' | 'pedido'; cliente_id: number; itens: ItemPedidoEntrada[]
  forma_pagamento: string; parcelas: number; primeiro_vencimento?: string; intervalo_dias: number; observacoes?: string
}
export type StatusPedido = 'aberto' | 'faturado' | 'cancelado'
export type PedidoResumo = {
  id: number; numero: number; tipo: 'orcamento' | 'pedido'; status: StatusPedido; cliente_nome: string
  total_cent: number; criado_em: string; nota_id: number | null; nota_numero: number | null
}
export type Pedido = Omit<PedidoEntrada, 'itens'> & PedidoResumo & {
  itens: (ItemPedidoEntrada & { id: number; codigo: string; descricao: string; unidade: string })[]
  calculo: Calculo
}
export type RespostaPedido = { pedido: Pedido; nota?: Nota; erro_emissao?: string }

export type TipoMovimento = 'entrada_manual' | 'saida_manual' | 'inventario' | 'venda' | 'estorno_venda' | 'entrada_xml'
export type Movimento = {
  id: number; produto_id: number; codigo: string; descricao: string; tipo: TipoMovimento; quantidade: number
  custo_unitario_cent: number | null; saldo_apos: number; nota_id: number | null; observacao: string | null
  usuario_nome: string | null; criado_em: string
}
export type ItemLeitura = {
  indice: number; codigo: string; descricao: string; ncm: string; ean: string; unidade: string; quantidade: number
  valor_unitario_cent: number; valor_cent: number; ipi_cent: number; icms_st_cent: number; frete_cent: number
  custo_total_cent: number
  sugestao: { acao: 'vincular' | 'criar'; produto_id: number | null; fator: number }
  /** classificação fiscal sugerida para o SPED (última do mesmo item/fornecedor, senão pela regra) */
  classificacao?: Classificacao
}
export type LeituraXml = {
  ja_lancada: boolean; destinatario_confere?: boolean; chave: string; numero: number; serie: number; emitida_em: string; total_cent: number
  frete_cent: number
  fornecedor: { cnpj: string; nome: string; uf: string; pessoa_id: number | null }
  /** AAAA-MM-DD */
  data_entrada_sugerida?: string
  itens: ItemLeitura[]
}
export type ItemLancar = {
  indice: number; acao: 'vincular' | 'criar' | 'ignorar'; produto_id?: number; fator: number
  novo?: { codigo: string; descricao: string; unidade: string; preco_cent: number; perfil_id: number }
  classificacao?: Classificacao
}

/* ---- Entradas para o SPED (classificação fiscal dos itens da nota de compra) ---- */
export type Destino = 'revenda' | 'industrializacao' | 'uso_consumo' | 'ativo' | 'outros'
export type Classificacao = { destino: Destino; cfop: string; cst_icms: string; credito_icms: boolean; credito_ipi: boolean }
export type DestinoOpcao = { valor: Destino; rotulo: string; tipo_item: string; cfop_final: string; cfop_final_st: string }

/** Destinos do contrato (o detalhe da entrada traz a lista do servidor; a Entrada por XML usa esta). */
export const DESTINOS: DestinoOpcao[] = [
  { valor: 'revenda', rotulo: 'Revenda', tipo_item: '00', cfop_final: '102', cfop_final_st: '403' },
  { valor: 'industrializacao', rotulo: 'Industrialização (insumo)', tipo_item: '01', cfop_final: '101', cfop_final_st: '401' },
  { valor: 'uso_consumo', rotulo: 'Uso e consumo', tipo_item: '07', cfop_final: '556', cfop_final_st: '407' },
  { valor: 'ativo', rotulo: 'Ativo imobilizado', tipo_item: '08', cfop_final: '551', cfop_final_st: '406' },
  { valor: 'outros', rotulo: 'Outras entradas', tipo_item: '99', cfop_final: '949', cfop_final_st: '949' },
]

export type EntradaResumo = {
  id: number; chave: string; numero: number; emitida_em: string; total_cent: number; classificada: boolean
  /** AAAA-MM-DD */
  data_entrada: string
  fornecedor_nome: string | null; fornecedor_cnpj: string | null; fornecedor_uf: string | null
}
export type ItemEntrada = {
  num_item: number; codigo_fornecedor: string; descricao: string; ncm: string; cfop_emitente: string; cst_emitente: string
  quantidade: number; unidade: string; valor_cent: number; bc_icms_cent: number; aliq_icms: number; icms_cent: number
  icms_st_cent: number; ipi_cent: number; credito_simples_cent: number
  produto: { id: number; codigo: string; descricao: string } | null
  classificacao: Classificacao | null
}
export type EntradaDetalhe = {
  id: number; chave: string; numero: number; serie: number; dt_emissao: string; data_entrada: string | null
  classificada: boolean
  fornecedor: { nome: string; cnpj: string; uf: string; simples: boolean }
  total_cent: number
  itens: ItemEntrada[]
  destinos: DestinoOpcao[]
}

/* ---- SPED Fiscal (EFD ICMS/IPI) ---- */
export type PerfilSped = 'A' | 'B'
export type FinalidadeSped = '0' | '1'
export type Contabilista = {
  nome: string; cpf: string; crc: string; cnpj: string; cep: string; logradouro: string; numero: string
  complemento: string; bairro: string; fone: string; email: string; cod_municipio: string
}
export type ConfigSped = {
  perfil: PerfilSped
  /** '0' industrial ou equiparado, '1' outros */
  atividade: '0' | '1'
  /** registro 0002, só industrial */
  ind_classif: string
  contabilista: Contabilista
  cod_receita: string; cod_receita_st: string; cod_receita_difal: string
  /** 1–28, no mês seguinte */
  dia_vencimento: number
  saldo_credor_inicial_cent: number
  incluir_homologacao: boolean
}
export type ApuracaoSped = {
  debitos_cent: number; creditos_cent: number; saldo_credor_anterior_cent: number; saldo_apurado_cent: number
  deducoes_cent: number; icms_recolher_cent: number; saldo_credor_transportar_cent: number
  st: { uf: string; retido_cent: number }[]
  difal: { uf: string; difal_cent: number; fcp_cent: number }[]
  ipi: { debitos_cent: number; creditos_cent: number; saldo_devedor_cent: number; saldo_credor_cent: number } | null
}
export type ResumoSped = { perfil: PerfilSped; saidas: number; entradas: number; participantes: number; itens: number; c170: number }
export type PreviaSped = {
  periodo: string; erros: string[]; alertas: string[]; saldo_anterior: { cent: number; origem: string }
  linhas?: number; contagem?: Record<string, number>; apuracao?: ApuracaoSped; resumo?: ResumoSped
}
export type ArquivoSped = {
  id: number; periodo: string; perfil: PerfilSped; finalidade: FinalidadeSped; linhas: number; apuracao: ApuracaoSped
  gerado_em: string; usuario_nome: string | null
}
export type CorpoSped = {
  periodo: string; perfil: PerfilSped; finalidade: FinalidadeSped; saldo_credor_anterior_cent?: number
}

export type StatusParcela = 'aberta' | 'recebida' | 'cancelada'
export type Parcela = {
  id: number; nota_id: number | null; nota_numero: number | null; pedido_id: number | null; cliente_id: number
  cliente_nome: string; parcela: number; numero_dup: string; vencimento: string; valor_cent: number
  status: StatusParcela; vencida: boolean; recebida_em: string | null; valor_recebido_cent: number | null
  forma: string | null
}

/** Formas de pagamento (tPag) do contrato. */
export const FORMAS_PAGAMENTO: { valor: string; rotulo: string }[] = [
  { valor: '01', rotulo: 'Dinheiro' },
  { valor: '03', rotulo: 'Cartão de crédito' },
  { valor: '04', rotulo: 'Cartão de débito' },
  { valor: '15', rotulo: 'Boleto' },
  { valor: '17', rotulo: 'PIX' },
  { valor: '90', rotulo: 'Sem pagamento' },
]
export function rotuloPagamento(tPag: string | null | undefined) {
  return FORMAS_PAGAMENTO.find((f) => f.valor === tPag)?.rotulo ?? (tPag || '—')
}

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: 'Administrador', equipe: 'Equipe do escritório', vendedor: 'Vendedor', financeiro: 'Financeiro',
}
export const PAPEIS = Object.keys(ROTULO_PAPEL) as Papel[]

export const ROTULO_CRT: Record<Crt, string> = {
  '1': 'Simples Nacional', '2': 'Simples Nacional — excesso de sublimite', '3': 'Regime normal',
}

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI',
  'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
