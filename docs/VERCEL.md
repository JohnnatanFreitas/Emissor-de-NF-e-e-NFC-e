# Publicar na Vercel

O front (telas) é servido pela CDN da Vercel e a API roda numa função Node (`api/index.js`) na
região de São Paulo (`gru1`). Tudo já está configurado no `vercel.json`.

## 1. Banco de dados (obrigatório)

A Vercel não tem disco permanente, então o banco embutido (PGlite) não serve. Use um Postgres externo:

1. No projeto da Vercel: **Storage → Create Database → Neon (Postgres)**.
2. Escolha a região **São Paulo (sa-east-1)**, perto da função e das SEFAZ.
3. Conecte o banco ao projeto. A Vercel cria `DATABASE_URL` e `DATABASE_URL_UNPOOLED` sozinha.

O sistema usa a `DATABASE_URL_UNPOOLED` (conexão direta) quando ela existe. As tabelas são criadas
no primeiro acesso.

Outro Postgres (Supabase, RDS...) também serve: informe só `DATABASE_URL` com `sslmode=require`.

## 2. Variáveis de ambiente

Em **Settings → Environment Variables** (marque Production e, se usar, Preview):

| Variável | Valor |
|---|---|
| `MASTER_KEY` | 64 caracteres hex (`openssl rand -hex 32`). Cifra os certificados A1 e os CSC. **Guarde uma cópia fora da Vercel**: perdê-la obriga a cadastrar todos os certificados de novo. |
| `JWT_SECRET` | outros 64 caracteres hex, diferentes da `MASTER_KEY`. Trocar derruba todas as sessões. |
| `ADMIN_NOME`, `ADMIN_EMAIL`, `ADMIN_SENHA` | primeiro administrador. **Apague `ADMIN_SENHA` depois do primeiro login** e faça um novo deploy. |
| `RESP_TEC_CNPJ`, `RESP_TEC_CONTATO`, `RESP_TEC_EMAIL`, `RESP_TEC_FONE` | responsável técnico das notas (infRespTec). |
| `SEFAZ_MODO` | `sefaz` (padrão). Use `simulado` só num ambiente de demonstração. |

Não precisa informar `COOKIE_SEGURO`, `PORT` nem `HOST`: na Vercel o cookie já sai com `Secure`.

**Ambientes de Preview** (um site por branch/PR) usam as mesmas variáveis marcadas para Preview.
Recomendado: um banco separado para Preview, ou desmarcar as variáveis de Preview para que só a
produção tenha acesso aos certificados.

## 3. Importar o repositório

**Add New → Project → Import** o repositório do GitHub. O `vercel.json` define tudo
(instalação, build do front, pasta `web/dist`, função da API, região e cabeçalhos). Não mude
"Framework Preset" (fica **Other**) nem os comandos de build.

Depois do deploy, confira `https://SEU-SITE.vercel.app/api/saude`: deve responder `{"ok":true,...}`.

## 4. Proteção do site

- **Deployment Protection** (Settings → Deployment Protection): ligue **Vercel Authentication**
  para os Previews. Assim só quem é do time da Vercel abre as versões de teste.
- **Domínio próprio** (Settings → Domains): a Vercel emite o certificado HTTPS sozinha.
- Repositório no GitHub **privado**.

## Limites conhecidos

| Ponto | Efeito |
|---|---|
| Tempo máximo da função: 60 s | A SEFAZ responde em até 30 s (`SEFAZ_TIMEOUT`). Se a função for encerrada no meio do envio, a nota fica "pendente" e a consulta resolve. |
| Pedido de no máximo 4,5 MB | Certificado e XML de compra ficam bem abaixo disso. |
| Várias instâncias ao mesmo tempo | Numeração, limite de login e criação das tabelas usam travas no banco, não na memória. |
| Sem backup automático do Docker | O Neon guarda histórico (restauração por ponto no tempo) conforme o plano. Confira o plano antes de colocar em produção. |
