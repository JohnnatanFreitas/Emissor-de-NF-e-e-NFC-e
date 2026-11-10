# Argus Emissor — contrato da API

Servidor Fastify em `http://127.0.0.1:3000`. Tudo sob `/api`, JSON em UTF-8.

## Convenções

- **Sessão por cookie** `argus_sessao` (HttpOnly, SameSite=Strict). O front usa `fetch(..., { credentials: 'same-origin' })`.
- **Anti-CSRF:** toda escrita (POST/PUT/PATCH/DELETE) manda o cabeçalho `X-Argus: 1`. Sem ele → 403.
- **Erro:** status HTTP ≠ 2xx com corpo `{ "erro": "mensagem para o usuário" }`. 401 = sem sessão (ir para /login).
  403 = sem permissão. 409 = conflito de regra (ex.: nota já cancelada). 422 = dados inválidos.
- **Dinheiro em centavos** (inteiros) em todo campo terminado em `_cent`. Quantidades e alíquotas são números decimais
  (alíquota em %, ex.: `18` = 18%, `0.1` = 0,1%).
- **Datas** em ISO: `"2026-11-08"` (data) ou `"2026-11-08T14:03:00-03:00"` (data e hora).
- Rotas de uma empresa ficam em `/api/empresas/:eid/...`. O servidor confere se o usuário enxerga a empresa.

## Papéis (`papel`)

| papel | Pode |
|---|---|
| `admin` | tudo, inclusive usuários e liberar produção |
| `equipe` | tudo menos liberar produção (equipe do escritório). Gere usuários, mas não cria/promove admin; de um admin só redefine a senha |
| `vendedor` | painel, produtos (ler), clientes, pedidos, venda balcão, notas (ler, emitir, DANFE/XML) |
| `financeiro` | painel, clientes (ler), notas (ler, DANFE/XML), contas a receber |

`GET /api/eu` devolve `acoes`: lista de strings que o front usa para mostrar/esconder menus:
`gerir_usuarios`, `gerir_empresas`, `liberar_producao`, `editar_perfis`, `editar_produtos`, `editar_pessoas`,
`pedidos`, `emitir`, `cancelar_nota`, `estoque`, `financeiro`.

## Sessão

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/sessao` | `{ email, senha }` | `Eu` (e grava o cookie) |
| DELETE | `/api/sessao` | — | `{ ok: true }` |
| GET | `/api/eu` | — | `Eu` |
| POST | `/api/eu/senha` | `{ senha_atual, nova_senha }` (nova ≥ 12 caracteres) | `{ ok: true }` |

```ts
type Eu = { id: number; nome: string; email: string; papel: 'admin'|'equipe'|'vendedor'|'financeiro';
  empresas: number[] | null /* null = todas */; trocar_senha: boolean; acoes: string[] }
```

## Sistema

| GET | `/api/saude` | → `{ ok: true, versao }` (sem login; confere o banco) |
|---|---|---|
| GET | `/api/saude/detalhes` | → `{ ok, versao, banco: 'postgres'|'pglite', modo_sefaz, serverless }` (com login) |
| GET | `/api/cnpj/:cnpj` | → `DadosReceita` (consulta BrasilAPI). 404 se não achar. |

```ts
type DadosReceita = { cnpj; razao_social; nome_fantasia; logradouro; numero; complemento; bairro;
  cod_municipio /* IBGE 7 dígitos */; municipio; uf; cep; fone; email; cnae; crt_sugerido: '1'|'3'; situacao }
```

## Usuários (`admin` e `equipe`, ação `gerir_usuarios`)

| GET | `/api/usuarios` | → `Usuario[]` |
|---|---|---|
| POST | `/api/usuarios` | `{ nome, email, papel, empresas, senha }` → `Usuario` (entra com `trocar_senha=true`) |
| PUT | `/api/usuarios/:id` | `{ nome?, email?, papel?, empresas?, ativo?, senha? }` → `Usuario` |

`Usuario = { id, nome, email, papel, empresas, ativo, trocar_senha, criado_em }`

## Empresas da carteira

| GET | `/api/empresas` | → `EmpresaResumo[]` (só as que o usuário enxerga) |
|---|---|---|
| POST | `/api/empresas` | `EmpresaEntrada` + `{ certificado_base64, certificado_senha }` → `Empresa` (cria 3 perfis padrão; sempre homologação) |
| GET | `/api/empresas/:eid` | → `Empresa` |
| PUT | `/api/empresas/:eid` | `Partial<EmpresaEntrada>` + opcionais `{ certificado_base64, certificado_senha, csc_id, csc }` → `Empresa` |
| POST | `/api/empresas/:eid/producao` | `{ confirmacao: "LIBERAR PRODUCAO" }` (admin) → `Empresa` com `ambiente: 1` |
| POST | `/api/empresas/:eid/homologacao` | — → `Empresa` com `ambiente: 2` |
| GET | `/api/empresas/:eid/sefaz/status` | → `{ cStat, xMotivo, modelo: '55' }` |
| GET | `/api/empresas/:eid/painel` | → `Painel` |

```ts
type EmpresaEntrada = { cnpj; razao_social; nome_fantasia; ie; im?; crt: '1'|'2'|'3'; cnae?;
  logradouro; numero; complemento?; bairro; cod_municipio; municipio; uf; cep; fone?; email?;
  serie_nfe: number; proximo_nfe: number; serie_nfce: number; proximo_nfce: number }
type Empresa = EmpresaEntrada & { id; ambiente: 1|2; csc_id: string|null; tem_csc: boolean;
  certificado: { titular: string; validade: string /* ISO */; dias_restantes: number } | null; criado_em }
type EmpresaResumo = { id; cnpj; razao_social; nome_fantasia; uf; crt; ambiente; certificado_validade: string|null }
type Painel = { notas_mes: number; faturamento_mes_cent: number; ibs_mes_cent; cbs_mes_cent; icms_mes_cent;
  receber_aberto_cent: number; receber_vencido_cent: number; pedidos_abertos: number;
  estoque_baixo: { id; codigo; descricao; estoque: number }[];
  ultimas_notas: NotaResumo[]; faturamento_dias: { dia: string; total_cent: number }[] /* últimos 30 dias */ }
```

## Perfis fiscais

| GET | `/api/empresas/:eid/perfis` | → `Perfil[]` |
|---|---|---|
| POST | `/api/empresas/:eid/perfis` | `PerfilEntrada` → `Perfil` |
| PUT | `/api/empresas/:eid/perfis/:id` | `Partial<PerfilEntrada>` → `Perfil` |

```ts
type PerfilEntrada = { nome; ativo: boolean;
  cfop_interno: string /* '5102' */; cfop_interestadual: string /* '6102' */; cfop_nfce: string /* '5102' */;
  origem: string /* '0'..'8' */;
  cst_icms: string /* regime normal: '00','20','40','41','60','10'... | Simples: CSOSN '101','102','103','201','202','300','400','500','900' */;
  aliq_icms_interna: number; aliq_icms_interestadual: number; reducao_bc_icms: number /* % */;
  mva_st: number; aliq_icms_st: number;
  cst_pis: string; aliq_pis: number; cst_cofins: string; aliq_cofins: number;
  cst_ipi: string|null; aliq_ipi: number;
  informar_ibscbs: boolean; cst_ibscbs: string /* '000' */; cclass_trib: string /* '000001' */;
  aliq_ibs_uf: number /* 0.1 em 2026 */; aliq_ibs_mun: number /* 0 em 2026 */; aliq_cbs: number /* 0.9 */;
  ibscbs_base_liquida: boolean /* "Tirar ICMS, PIS e COFINS da base", padrão true */ }
type Perfil = PerfilEntrada & { id; empresa_id }
```

## Produtos

| GET | `/api/empresas/:eid/produtos?busca=&ativos=1` | → `Produto[]` |
|---|---|---|
| POST | `/api/empresas/:eid/produtos` | `ProdutoEntrada` → `Produto` |
| PUT | `/api/empresas/:eid/produtos/:id` | `Partial<ProdutoEntrada>` → `Produto` |

```ts
type ProdutoEntrada = { codigo; descricao; ncm /* 8 dígitos */; cest?; ean?; unidade /* 'UN' */;
  preco_cent: number; perfil_id: number; estoque_minimo: number; ativo: boolean }
type Produto = ProdutoEntrada & { id; estoque: number; custo_medio_cent: number; perfil_nome: string }
```

## Clientes e fornecedores (`pessoas`)

| GET | `/api/empresas/:eid/pessoas?tipo=cliente|fornecedor&busca=` | → `Pessoa[]` |
|---|---|---|
| POST | `/api/empresas/:eid/pessoas` | `PessoaEntrada` → `Pessoa` |
| PUT | `/api/empresas/:eid/pessoas/:id` | `Partial<PessoaEntrada>` → `Pessoa` |

```ts
type PessoaEntrada = { tipo: 'cliente'|'fornecedor'|'ambos'; cpf_cnpj; nome; nome_fantasia?;
  ind_ie_dest: '1' /* contribuinte */ | '2' /* isento */ | '9' /* não contribuinte */; ie?;
  email?; fone?; logradouro; numero; complemento?; bairro; cod_municipio; municipio; uf; cep; ativo: boolean }
type Pessoa = PessoaEntrada & { id }
```

## Cálculo (quadro Resumo)

`POST /api/empresas/:eid/calculo`
`{ modelo: '55'|'65', cliente_id?: number, itens: [{ produto_id, quantidade, valor_unitario_cent?, desconto_cent? }] }`
→ `Calculo`

```ts
type ItemCalculado = { produto_id; codigo; descricao; quantidade; valor_unitario_cent; desconto_cent; valor_cent;
  cfop; cst_icms; bc_icms_cent; aliq_icms; icms_cent; icms_st_cent; ipi_cent; pis_cent; cofins_cent;
  bc_ibscbs_cent; ibs_cent; cbs_cent }
type Totais = { produtos_cent; desconto_cent; bc_icms_cent; icms_cent; icms_st_cent; ipi_cent; pis_cent; cofins_cent;
  bc_ibscbs_cent; ibs_cent; cbs_cent; total_cent /* vNF */ }
type Calculo = { interestadual: boolean; consumidor_final: boolean; itens: ItemCalculado[]; totais: Totais }
```

## Pedidos e orçamentos

| GET | `/api/empresas/:eid/pedidos?status=&tipo=&busca=` | → `PedidoResumo[]` |
|---|---|---|
| GET | `/api/empresas/:eid/pedidos/:id` | → `Pedido` |
| POST | `/api/empresas/:eid/pedidos` | `PedidoEntrada & { emitir?: boolean }` → `{ pedido: Pedido, nota?: Nota, erro_emissao?: string }` |
| PUT | `/api/empresas/:eid/pedidos/:id` | `PedidoEntrada & { emitir?: boolean }` → idem (só pedido `aberto`) |
| POST | `/api/empresas/:eid/pedidos/:id/emitir` | — → `{ pedido, nota, erro_emissao? }` |
| POST | `/api/empresas/:eid/pedidos/:id/cancelar` | — → `Pedido` (só sem nota autorizada) |

```ts
type PedidoEntrada = { tipo: 'orcamento'|'pedido'; cliente_id: number;
  itens: { produto_id; quantidade: number; valor_unitario_cent: number; desconto_cent?: number }[];
  forma_pagamento: string /* tPag: '01' dinheiro,'03' crédito,'04' débito,'15' boleto,'17' PIX,'90' sem pagamento */;
  parcelas: number; primeiro_vencimento?: string; intervalo_dias: number; observacoes?: string }
type PedidoResumo = { id; numero; tipo; status: 'aberto'|'faturado'|'cancelado'; cliente_nome; total_cent; criado_em; nota_id; nota_numero }
type Pedido = PedidoEntrada & PedidoResumo & { itens: (PedidoEntrada['itens'][0] & { id; codigo; descricao; unidade })[]; calculo: Calculo }
```

Emitir um orçamento converte em pedido. Com `emitir: true` o pedido é salvo e a NF-e (55) é emitida na mesma chamada;
se a SEFAZ rejeitar, o pedido continua salvo e `erro_emissao` traz o motivo.

## Venda balcão (NFC-e)

`POST /api/empresas/:eid/nfce`
`{ cpf?: string, nome?: string, itens: [{ produto_id, quantidade, valor_unitario_cent? }], pagamentos: [{ tPag, valor_cent }] }`
→ `Nota`. Exige CSC cadastrado (`tem_csc`), senão 422.

## Notas fiscais

| GET | `/api/empresas/:eid/notas?modelo=55|65&status=&busca=&de=&ate=` | → `NotaResumo[]` |
|---|---|---|
| GET | `/api/empresas/:eid/notas/:id` | → `Nota` |
| GET | `/api/empresas/:eid/notas/:id/xml` | arquivo XML (nfeProc se autorizada), `Content-Disposition: attachment` |
| GET | `/api/empresas/:eid/notas/:id/danfe` | página HTML pronta para imprimir (A4 na NF-e, 80 mm na NFC-e) |
| POST | `/api/empresas/:eid/notas/:id/consultar` | → `Nota` |
| POST | `/api/empresas/:eid/notas/:id/reenviar` | → `Nota` (rejeitada / nao_enviada / falha_assinatura) |
| POST | `/api/empresas/:eid/notas/:id/cancelar` | `{ justificativa }` 15–255 caracteres → `Nota` |
| POST | `/api/empresas/:eid/notas/:id/cce` | `{ correcao }` 15–1000 caracteres (só NF-e 55) → `Nota` |

```ts
type StatusNota = 'enviando'|'autorizada'|'rejeitada'|'denegada'|'cancelada'|'pendente'|'nao_enviada'|'falha_assinatura'|'inutilizada'
type NotaResumo = { id; modelo: '55'|'65'; serie; numero; chave; status: StatusNota; ambiente: 1|2;
  destinatario: string; total_cent; emitida_em; c_stat; x_motivo; pedido_id }
type Nota = NotaResumo & { protocolo; natureza; totais: Totais; itens: ItemCalculado[];
  pagamentos: { tPag; valor_cent }[]; eventos: { id; tipo: 'cce'|'cancelamento'; sequencia; texto; protocolo; c_stat; x_motivo; criado_em }[];
  pode: { cancelar: boolean; cce: boolean; reenviar: boolean; consultar: boolean } }
```

Cancelar uma NF-e/NFC-e devolve o estoque, cancela as parcelas a receber e reabre o pedido.
A CC-e exige a ação `emitir`; o cancelamento exige `cancelar_nota`.

## Inutilização de numeração

| GET | `/api/empresas/:eid/inutilizacoes` | → `Inutilizacao[]` (últimas 200) |
|---|---|---|
| POST | `/api/empresas/:eid/inutilizacoes` | ação `cancelar_nota`. `{ modelo: '55'|'65', serie?, numero_inicial, numero_final?, justificativa }` → `Inutilizacao` (200 homologada; 202 sem resposta; 409 recusada pela SEFAZ ou faixa ocupada) |

```ts
type Inutilizacao = { id; modelo; serie; numero_inicial; numero_final; justificativa; ambiente: 1|2;
  status: 'enviando'|'homologada'|'rejeitada'|'sem_resposta'; protocolo; c_stat; x_motivo; usuario_nome; criado_em }
```

- `serie` vazia = série atual do modelo; `numero_final` vazio = só o número inicial; justificativa de 15 a 255 caracteres; até 10.000 números por pedido.
- Bloqueia (409) se a faixa tem nota autorizada, cancelada, denegada, pendente ou em envio, ou se já foi inutilizada.
- Bloqueia (422) faixa que começa depois do próximo número da série (abriria um buraco novo).
- Se a faixa alcança o próximo número, ele avança antes do envio; se a SEFAZ recusar, volta.
- Homologada (cStat 102, ou 563 = a faixa já estava inutilizada): notas rejeitadas / não enviadas da faixa viram `inutilizada`.
- Sem resposta: os números ficam reservados; basta enviar de novo a mesma faixa.

## Estoque

| GET | `/api/empresas/:eid/estoque?busca=` | → `Produto[]` (com `estoque`, `custo_medio_cent`) |
|---|---|---|
| GET | `/api/empresas/:eid/estoque/movimentos?produto_id=` | → `Movimento[]` (100 mais recentes) |
| POST | `/api/empresas/:eid/estoque/ajuste` | `{ produto_id, tipo: 'entrada_manual'|'saida_manual'|'inventario', quantidade, custo_unitario_cent?, observacao? }` → `Movimento` |
| POST | `/api/empresas/:eid/estoque/entrada-xml/ler` | `{ xml }` → `LeituraXml` |
| POST | `/api/empresas/:eid/estoque/entrada-xml/lancar` | `{ xml, itens: ItemLancar[] }` → `{ entrada_id, movimentos: number, fornecedor_id }` |

`inventario`: a quantidade informada vira o saldo (o movimento registra a diferença).

```ts
type Movimento = { id; produto_id; codigo; descricao; tipo: 'entrada_manual'|'saida_manual'|'inventario'|'venda'|'estorno_venda'|'entrada_xml';
  quantidade /* com sinal */; custo_unitario_cent; saldo_apos; nota_id; observacao; usuario_nome; criado_em }
type LeituraXml = { ja_lancada: boolean; chave; numero; serie; emitida_em; total_cent; frete_cent;
  fornecedor: { cnpj; nome; uf; pessoa_id: number|null };
  itens: { indice: number; codigo; descricao; ncm; ean; unidade; quantidade; valor_unitario_cent; valor_cent;
    ipi_cent; icms_st_cent; frete_cent; custo_total_cent /* produto+IPI+ST+frete-desconto */;
    sugestao: { acao: 'vincular'|'criar'; produto_id: number|null; fator: number } }[] }
type ItemLancar = { indice: number; acao: 'vincular'|'criar'|'ignorar'; produto_id?: number; fator: number;
  novo?: { codigo; descricao; unidade; preco_cent; perfil_id } }
```

## Contas a receber

| GET | `/api/empresas/:eid/receber?status=aberta|recebida|cancelada|vencida&de=&ate=` | → `Parcela[]` |
|---|---|---|
| POST | `/api/empresas/:eid/receber/:id/baixar` | `{ valor_recebido_cent, recebida_em, forma? }` → `Parcela` |
| POST | `/api/empresas/:eid/receber/:id/estornar` | — → `Parcela` (volta para aberta) |

```ts
type Parcela = { id; nota_id; nota_numero; pedido_id; cliente_id; cliente_nome; parcela; numero_dup;
  vencimento; valor_cent; status: 'aberta'|'recebida'|'cancelada'; vencida: boolean; recebida_em; valor_recebido_cent; forma }
```

## Entradas para o SPED (ação `estoque`)

A classificação fiscal de cada item da nota de compra decide o que vai para o C170/C190 do SPED.

| GET | `/api/empresas/:eid/entradas?de=AAAA-MM-DD&ate=AAAA-MM-DD&situacao=a_conferir` | → `EntradaResumo[]` (período pela data de entrada) |
|---|---|---|
| GET | `/api/empresas/:eid/entradas/:id` | → `EntradaDetalhe` (cria a classificação sugerida se a nota foi lançada antes do SPED) |
| PUT | `/api/empresas/:eid/entradas/:id/classificacao` | `{ data_entrada, itens: [{ num_item, destino, cfop, cst_icms, credito_icms, credito_ipi }] }` → `EntradaDetalhe` (marca como conferida e lembra por fornecedor) |

```ts
type Destino = 'revenda'|'industrializacao'|'uso_consumo'|'ativo'|'outros'
type Classificacao = { destino: Destino; cfop: string; cst_icms: string; credito_icms: boolean; credito_ipi: boolean }
type EntradaResumo = { id; chave; numero; emitida_em; total_cent; classificada: boolean; data_entrada: 'AAAA-MM-DD';
  fornecedor_nome; fornecedor_cnpj; fornecedor_uf }
type EntradaDetalhe = { id; chave; numero; serie; dt_emissao; data_entrada; classificada;
  fornecedor: { nome; cnpj; uf; simples: boolean }; total_cent;
  itens: { num_item; codigo_fornecedor; descricao; ncm; cfop_emitente; cst_emitente; quantidade; unidade; valor_cent;
    bc_icms_cent; aliq_icms; icms_cent; icms_st_cent; ipi_cent; credito_simples_cent;
    produto: { id; codigo; descricao } | null; classificacao: Classificacao | null }[];
  destinos: { valor: Destino; rotulo; tipo_item; cfop_final; cfop_final_st }[] }
```

- **CFOP de entrada**: o primeiro dígito vem do CFOP do fornecedor (5→1, 6→2, 7→3); os três últimos, do destino
  (revenda 102 / com ST 403; industrialização 101 / 401; uso e consumo 556 / 407; ativo 551 / 406; outras 949).
- **Crédito de ICMS**: só quando há ICMS destacado (o servidor ignora o pedido de crédito sem ICMS). Uso e consumo e ativo
  vêm sem crédito por padrão.
- **CST na entrada**: origem + CST do fornecedor; CSOSN do Simples vira 60 (com ST) ou 90.
- `data_entrada` não pode ser anterior à emissão nem futura.

**Na entrada por XML** (`/estoque/entrada-xml/ler`): cada item traz `classificacao` (sugerida, usando a última classificação
desse item do mesmo fornecedor) e a resposta traz `data_entrada_sugerida`. No `/lancar`, envie `data_entrada` e, em cada
item, `classificacao`. Itens com `acao: "ignorar"` não mexem no estoque mas **são escriturados** (ex.: uso e consumo).
Sem `classificacao` em todos os itens, a nota é gravada com a sugerida e fica "a conferir" (`classificada: false`).

## SPED Fiscal — EFD ICMS/IPI (ação `sped`: admin e equipe)

| GET | `/api/empresas/:eid/sped/config` | → `ConfigSped` |
|---|---|---|
| PUT | `/api/empresas/:eid/sped/config` | `ConfigSped` → `ConfigSped` |
| POST | `/api/empresas/:eid/sped/previa` | `{ periodo: 'AAAA-MM', perfil?: 'A'|'B', finalidade?: '0'|'1', saldo_credor_anterior_cent? }` → `Previa` |
| POST | `/api/empresas/:eid/sped/gerar` | mesmo corpo → `ArquivoSped & { alertas, resumo }`; 422 `{ erro, erros[], alertas[] }` se houver erro |
| GET | `/api/empresas/:eid/sped/arquivos` | → `ArquivoSped[]` (últimos 100) |
| GET | `/api/empresas/:eid/sped/arquivos/:id/download` | arquivo .txt em ISO-8859-1 |

```ts
type ConfigSped = { perfil: 'A'|'B'; atividade: '0'|'1' /* 0 industrial */; ind_classif: string /* 0002, só industrial */;
  contabilista: { nome; cpf; crc; cnpj; cep; logradouro; numero; complemento; bairro; fone; email; cod_municipio };
  cod_receita: string /* E116 */; cod_receita_st: string /* E250 */; cod_receita_difal: string /* E316 */;
  dia_vencimento: number /* 1–28, mês seguinte */; saldo_credor_inicial_cent: number; incluir_homologacao: boolean }
type Apuracao = { debitos_cent; creditos_cent; saldo_credor_anterior_cent; saldo_apurado_cent; deducoes_cent;
  icms_recolher_cent; saldo_credor_transportar_cent;
  st: { uf; retido_cent }[]; difal: { uf; difal_cent; fcp_cent }[];
  ipi: { debitos_cent; creditos_cent; saldo_devedor_cent; saldo_credor_cent } | null }
type Previa = { periodo; erros: string[]; alertas: string[]; saldo_anterior: { cent; origem: string };
  linhas?; contagem?: Record<string, number>; apuracao?: Apuracao;
  resumo?: { perfil; saidas; entradas; participantes; itens; c170 } }   // linhas/apuracao só sem erro
type ArquivoSped = { id; periodo; perfil; finalidade; linhas; apuracao: Apuracao; gerado_em; usuario_nome }
```

- **Perfil A**: C170 em todas as notas. **Perfil B**: C170 só nas entradas (saídas com C100 + C190).
- Saídas: notas autorizadas (C100 00), canceladas (02) e denegadas (04) do período; numeração inutilizada vira um C100
  (05) por número. Notas de homologação ficam fora, salvo `incluir_homologacao` (para testes).
- Entradas: notas com `data_entrada` no período, com a classificação gravada.
- Saldo credor anterior: o transportado pelo último arquivo do mês anterior, senão `saldo_credor_inicial_cent`.
- Erros que bloqueiam: empresa do Simples Nacional, sem IE, contabilista incompleto, nota pendente no período, ICMS a
  recolher sem código de receita, industrial sem `ind_classif`.

## Emissão simplificada (ação `emitir`)

O usuário escolhe produtos já cadastrados e um **card de operação**; CFOP, CST e alíquotas vêm prontos do perfil fiscal
do produto e da operação (use `POST /calculo` com `operacao` para a prévia).

| GET | `/api/operacoes` | → `{ valor, rotulo, descricao, natureza, cobranca: boolean, modelos: ('55'|'65')[] }[]` |
|---|---|---|
| POST | `/api/empresas/:eid/calculo` | aceita também `operacao` (padrão `venda`) |
| POST | `/api/empresas/:eid/emissao-rapida` | `{ operacao, modelo: '55'|'65', cliente_id? (NF-e), cpf?, nome? (NFC-e), itens: [{ produto_id, quantidade, valor_unitario_cent?, desconto_cent? }], pagamentos?: [{ tPag, valor_cent }], observacao? }` → `Nota` |

- Operações: `venda` (CFOP do perfil; NF-e e NFC-e), `bonificacao` (x910), `transferencia` (x152, ou x151 para produção
  própria) e `outras` (x949) — estas três só em NF-e, **sem cobrança** (pagamento 90, sem contas a receber). Todas baixam o estoque.
- O primeiro dígito do CFOP é 5 (mesma UF) ou 6 (outra UF), pela UF do cliente.

## NFS-e — padrão nacional

Modo de envio pela variável `NFSE_MODO`: `simulado` (padrão: autoriza localmente, número e chave no formato nacional,
DANFSe com "SIMULADA - SEM VALOR FISCAL") ou `nacional` (assina a DPS com o A1 e envia ao Sefin Nacional; ainda não conferido).
O ambiente segue o da empresa (2 = produção restrita, 1 = produção).

| GET | `/api/nfse/catalogo` | → serviços sugeridos `{ cod_trib_nac, item_lc116, descricao, nbs, aliq_iss }[]` |
|---|---|---|
| GET/PUT | `/api/empresas/:eid/nfse/config` | `{ mei: boolean, serie_dps }` → `{ mei, regime: 'simples'|'mei'|'normal', serie_dps, proximo_dps, modo, ambiente, im }` (PUT: `gerir_empresas`) |
| GET | `/api/empresas/:eid/nfse/servicos` | → `Servico[]` |
| POST/PUT | `/api/empresas/:eid/nfse/servicos[/:id]` | `{ cod_trib_nac (6 díg.), item_lc116, nbs (9 díg., opcional), descricao, aliq_iss (0–5), iss_retido, ativo }` (`editar_produtos`) |
| POST | `/api/empresas/:eid/nfse/calculo` | `PedidoNfse` → `CalculoNfse` |
| POST | `/api/empresas/:eid/nfse` | `PedidoNfse & { descricao (discriminação, 5–2000) }` → `Nfse` (`emitir`) |
| GET | `/api/empresas/:eid/nfse?de=&ate=&status=` | → `Nfse[]` |
| GET | `/api/empresas/:eid/nfse/:id` · `/xml` · `/danfse` | nota · XML (NFS-e ou DPS) · DANFSe HTML |
| POST | `/api/empresas/:eid/nfse/:id/cancelar` | `{ motivo }` 15–255 caracteres (`cancelar_nota`) |

```ts
type PedidoNfse = { servico_id; tomador_id /* pessoas */; valor_servico_cent; deducoes_cent?; desconto_incond_cent?;
  competencia?: 'AAAA-MM-DD'; iss_retido?: boolean; reter_irrf?: boolean; reter_csrf?: boolean; reter_inss?: boolean; aliq_inss? }
type CalculoNfse = { valor_servico_cent; deducoes_cent; desconto_incond_cent; base_calculo_cent; aliq_iss; iss_cent; iss_retido;
  irrf_cent; pis_cent; cofins_cent; csll_cent; inss_cent; cbs_cent; ibs_uf_cent; ibs_mun_cent; aliq_cbs; aliq_ibs_uf; aliq_ibs_mun;
  retencoes_cent; liquido_cent; regras: { ano; fase: string } }
type Nfse = { id; serie_dps; numero_dps; numero_nfse; chave /* 50 díg. */; modo: 'simulado'|'nacional'; ambiente: 1|2;
  status: 'enviando'|'autorizada'|'rejeitada'|'cancelada'|'pendente'; tomador_id; tomador_nome; servico_id; competencia;
  valor_cent; valores: CalculoNfse; descricao; servico: { cod_trib_nac; item_lc116; nbs; descricao };
  mensagem; motivo_cancelamento; emitida_em; cancelada_em }
```

Regras (portadas do sistema-nfse): retenções federais só com prestador fora do Simples/MEI e tomador PJ — IRRF 1,5%
(dispensado abaixo de R$ 10,00), PIS 0,65%, COFINS 3% (até 2026), CSLL 1%; INSS opcional. IBS/CBS 2026 informativos:
CBS 0,9%, IBS 0,1% estadual e 0% municipal; não destacados para Simples/MEI. MEI não tem alíquota de ISS na DPS.
