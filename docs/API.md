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
