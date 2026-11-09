# Argus Emissor

Emissão de **NF-e (55) e NFC-e (65) direto na SEFAZ**, sem API de terceiros, para a carteira de empresas do escritório.

- Várias empresas, cada uma com o seu certificado A1 (guardado cifrado com a `MASTER_KEY`) e o CSC da NFC-e
- **Perfis fiscais**: o produto aponta para um perfil e a nota sai com CFOP, CST/CSOSN e alíquotas certos —
  ICMS próprio, redução de base, ST por MVA, DIFAL para não contribuinte, IPI, PIS/COFINS (com o ICMS fora da base)
  e **IBS/CBS** (2026: IBS 0,1% e CBS 0,9%, base sem ICMS/PIS/COFINS)
- Pedidos e orçamentos que viram NF-e com um clique (boleto parcelado gera as duplicatas)
- Venda balcão (NFC-e) com QR Code e troco
- Notas: DANFE (A4 e 80 mm), XML (nfeProc), consulta, reenvio com o mesmo número, CC-e e cancelamento
- Inutilização de numeração (faixa de números pulados ou de notas rejeitadas que não vão mais sair)
- Estoque com baixa automática, ajuste/inventário e **entrada pelo XML de compra** (custo médio com IPI, ST e frete;
  vínculo produto x fornecedor lembrado)
- Contas a receber geradas pelas duplicatas (baixa e estorno)
- Login por usuário: `admin`, `equipe` (escritório), `vendedor` e `financeiro`

O guia de instalação para o usuário está em **[COMO-INSTALAR-PAC-FATURAMENTO.md](COMO-INSTALAR-PAC-FATURAMENTO.md)**
(Docker + Postgres). O contrato da API está em **[docs/API.md](docs/API.md)**.

## Rodar

**Com Docker (como no guia):** `cp .env.example .env`, preencha e `docker compose up -d --build`.
Sobem `emissor-nfe` (sistema), `emissor-banco` (Postgres 16) e `emissor-backup` (backup diário, 14 dias).
Endereço: http://127.0.0.1:3000.

**Sem Docker (desenvolvimento):** sem `DATABASE_URL` o sistema usa o **PGlite** (o próprio Postgres rodando dentro
do Node, numa pasta), então não precisa instalar banco.

```bash
npm install
npm run web:build          # compila o front (web/) em web/dist
npm run dev:simulado       # usa .env.dev: SEFAZ simulada + PGlite, em http://127.0.0.1:3077
npm test                   # 35 testes (PGlite em memória, SEFAZ simulada, XSD oficial)
```

Para o front com recarga automática: `npm --prefix web run dev` (Vite em 5173, com proxy de `/api` para a porta 3000).

`SEFAZ_MODO=simulado` autoriza tudo localmente (sem certificado, e produção fica bloqueada). Serve para testar telas.

## Garantias da emissão

- **Número reservado em transação.** Monta, assina e **valida no schema oficial (PL_010b, com IBS/CBS)** antes de gravar.
  Se algo falha, nada é enviado e o número não é gasto. A validação usa o libxml2 em WASM (não depende de xmllint).
- **XML assinado gravado antes do envio.** Se a conexão cair, a nota fica `pendente` e só a consulta resolve
  (não reenvia às cegas: evita duplicidade). Servidor caiu no meio do envio: ao subir, `enviando` vira `pendente`.
- **Rejeição não gasta número:** o reenvio (ou emitir de novo o mesmo pedido) reaproveita a mesma nota.
- **Efeitos uma vez só:** a autorização baixa o estoque, cria as parcelas e fatura o pedido; o cancelamento desfaz tudo
  (estoque volta, parcelas canceladas, pedido reaberto).
- **Homologação:** destinatário e 1º item da NFC-e com os textos exigidos pela SEFAZ; marca d'água no DANFE.
- **Venda interestadual:** `idDest` 2, CFOP 5xxx → 6xxx do perfil, 6102 → 6108 para não contribuinte, alíquota
  interestadual automática (4% importado, 7%/12% pela UF) e DIFAL (regime normal).
- **Dinheiro em centavos** (inteiros) no banco.

## Situações da nota

| Situação | Significado | Próximo passo |
|---|---|---|
| `autorizada` | tem protocolo e nfeProc | DANFE, XML, CC-e, cancelar |
| `rejeitada` | a SEFAZ recusou (`c_stat`/`x_motivo`) | corrigir cadastro e reenviar (mesmo número) |
| `pendente` | o envio caiu sem resposta | **consultar antes de qualquer coisa** |
| `nao_enviada` | a consulta confirmou que a SEFAZ não recebeu | reenviar |
| `denegada` | uso denegado | o número fica consumido |
| `inutilizada` | o número foi inutilizado na SEFAZ | — |
| `cancelada` | cancelamento homologado | — |

## Estrutura

```
src/
  config.js  db.js  esquema.js     configuração, Postgres/PGlite, tabelas
  seguranca.js  acesso.js          senhas (scrypt), sessão (cookie HMAC), cofre AES-GCM, papéis
  certificado.js  receita.js       leitura do .pfx (OpenSSL) e consulta de CNPJ (BrasilAPI)
  fiscal/                          perfis padrão e motor de cálculo dos tributos
  nfe/                             montagem do XML, SEFAZ (real/simulada), retorno, XSD, DANFE
  servicos/                        emissão, estoque, entrada por XML, carregamento
  rotas/                           sessão, empresas, cadastros, vendas, estoque, financeiro
  app.js  server.js
web/                               front-end React (padrão visual Argus Captura)
test/                              testes (node:test)
```

## Pontos para revisar antes de produção

- Perfis fiscais padrão são ponto de partida: revise CST, alíquotas e CFOP de cada empresa.
- A tabela de alíquota interna por UF (DIFAL) fica em `src/fiscal/perfis-padrao.js`; confira a legislação vigente.
- Ainda não implementado: contingência (SVC/EPEC), devolução (finNFe 4), frete e transportadora.
