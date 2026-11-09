# Como montar o seu sistema de emissão de NF-e no seu computador

Este guia leva você do zero até a primeira NF-e **autorizada pela SEFAZ em homologação** (ambiente de teste, sem valor fiscal), com o sistema rodando no seu computador.

O que você vai ter no final:

- Emissão de NF-e e NFC-e direto na SEFAZ, sem API de terceiros
- Cadastro de produtos com perfil fiscal (CFOP, ICMS, PIS/COFINS, IBS e CBS calculados sozinhos)
- Pedidos e orçamentos que viram nota com um clique
- Estoque com baixa automática e entrada pelo XML de compra
- Contas a receber geradas a partir das duplicatas
- Login por usuário (equipe do escritório, administrador, vendedor e financeiro)

Tempo médio: **30 a 40 minutos** na primeira vez.

---

## 1. O que você precisa antes de começar

| Item | Para que serve | Onde conseguir |
|---|---|---|
| **Docker Desktop** | Roda o sistema e o banco de dados sem instalar mais nada | docker.com/products/docker-desktop |
| **Git** | Baixar o repositório | git-scm.com (no Mac já vem instalado) |
| **Certificado A1 (.pfx) e a senha** | Assinar as notas e conversar com a SEFAZ | De uma empresa sua ou de um cliente, com autorização dele |
| **Inscrição estadual da empresa** | Vai na nota | Cadastro da empresa |

**Computador:** Mac (Intel ou Apple Silicon), Windows 10/11 ou Linux, com pelo menos 8 GB de memória.

**No Windows:** durante a instalação do Docker Desktop, deixe marcada a opção **"Use WSL 2"**. Se o Docker pedir para reiniciar o computador, reinicie.

Depois de instalar, **abra o Docker Desktop** e espere aparecer "Engine running" no canto da janela. Ele precisa estar aberto sempre que você for usar o sistema.

---

## 2. Baixar o repositório

Abra o **Terminal** (Mac) ou o **Git Bash** (Windows, vem junto com o Git) e rode:

```bash
cd ~
git clone URL-DO-REPOSITORIO pac-faturamento
cd pac-faturamento
```

Troque `URL-DO-REPOSITORIO` pelo link que você recebeu.

Para conferir se está na pasta certa, rode `ls`. Você deve ver `Dockerfile`, `docker-compose.yml`, `src`, `web` e `.env.example`.

---

## 3. Criar o arquivo de configuração (.env)

O `.env` guarda as chaves do seu sistema. **Ele é só seu: nunca mande para ninguém e nunca suba para o GitHub.**

### 3.1 Copiar o modelo

```bash
cp .env.example .env
```

### 3.2 Gerar as chaves

Rode este comando **três vezes**. Cada vez ele mostra um código diferente:

```bash
openssl rand -hex 32
```

Se o comando `openssl` não funcionar, use este (funciona em qualquer sistema com Docker aberto):

```bash
docker run --rm alpine sh -c "head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; echo"
```

### 3.3 Preencher o .env

Abra o `.env` num editor de texto (no Mac: `open -e .env`; no Windows: `notepad .env`) e preencha:

```env
DB_SENHA=cole-aqui-o-1o-codigo
MASTER_KEY=cole-aqui-o-2o-codigo
JWT_SECRET=cole-aqui-o-3o-codigo

ADMIN_NOME=Seu Nome
ADMIN_EMAIL=seu@email.com
ADMIN_SENHA=uma-senha-forte-com-12-caracteres-ou-mais

RESP_TEC_CNPJ=CNPJ do seu escritório (responsável técnico que vai na nota)
RESP_TEC_CONTATO=Seu Nome
RESP_TEC_EMAIL=seu@email.com
RESP_TEC_FONE=62999999999

HOST_PORT=3000
```

Salve o arquivo.

> ⚠️ **Guarde a MASTER_KEY em um lugar seguro, fora do computador** (gerenciador de senhas, por exemplo). É ela que criptografa os certificados digitais. Se você perder essa chave, os certificados cadastrados não abrem mais e precisam ser cadastrados de novo.

> 💡 **Porta ocupada?** Se você já usa a porta 3000 em outro sistema, troque `HOST_PORT=3000` por outra, como `HOST_PORT=3099`. Aí o endereço do sistema passa a ser `http://127.0.0.1:3099`.

---

## 4. Subir o sistema

Com o Docker Desktop aberto, rode na pasta do projeto:

```bash
docker compose up -d --build
```

Na primeira vez demora de **3 a 8 minutos** (ele baixa e monta tudo). Nas próximas, segundos.

Ao terminar, confira se os 3 containers estão de pé:

```bash
docker ps
```

Você deve ver:

| Container | O que é |
|---|---|
| `emissor-nfe` | O sistema (precisa aparecer **healthy**) |
| `emissor-banco` | O banco de dados Postgres |
| `emissor-backup` | Faz backup do banco uma vez por dia e guarda 14 dias |

Se o `emissor-nfe` não aparecer, veja o que aconteceu com:

```bash
docker logs emissor-nfe
```

---

## 5. Primeiro acesso

1. Abra no navegador: **http://127.0.0.1:3000** (ou a porta que você colocou no `HOST_PORT`).
2. Entre com o `ADMIN_EMAIL` e a `ADMIN_SENHA` do `.env`.
3. Vá em **Configurações → Minha senha** e troque a senha.
4. Depois de trocar, apague a linha `ADMIN_SENHA` do `.env` e salve. Ela só serve para o primeiro acesso.

> 💡 Use **127.0.0.1** em vez de **localhost**. Em alguns computadores, `localhost` cai em outro sistema que esteja rodando na mesma porta.

---

## 6. Cadastrar a primeira empresa

Menu **Empresas da carteira → + Cadastrar empresa**.

1. Digite o **CNPJ** e clique fora do campo: razão social, endereço e regime vêm sozinhos da Receita.
2. Confira e preencha a **inscrição estadual**.
3. Confira o **regime (CRT)**: 1 = Simples Nacional, 3 = Regime normal.
4. Confira o **código IBGE do município** (7 dígitos).
5. **Série** e **próximo número da NF-e**: em homologação pode deixar série 1 e número 1.
6. Escolha o arquivo do **certificado A1 (.pfx)** e digite a **senha** dele.
7. Clique em **Cadastrar**.

A empresa sempre entra em **HOMOLOGAÇÃO** (faixa amarela no topo da tela). Nada do que você emitir aqui tem valor fiscal.

O sistema já cria **3 perfis fiscais padrão** de acordo com o regime da empresa.

---

## 7. Ajustar os perfis fiscais (a parte do contador)

Menu **Configurações → Perfis fiscais**.

O perfil fiscal é a **regra tributária**. Cada produto aponta para um perfil e a nota sai com CFOP, CST e alíquotas certos, sem o vendedor digitar nada.

Para cada perfil, confira:

- **CFOP dentro e fora do estado** (ex.: 5102/6102 revenda, 5101/6101 produção própria, 5405/6404 com ST)
- **CST ou CSOSN do ICMS** e as **alíquotas interna e interestadual**
- **CST e alíquotas de PIS/COFINS**
- **IBS e CBS:** CST, cClassTrib e alíquotas. Em 2026 o padrão é **IBS 0,1% e CBS 0,9%**
- **Base do IBS/CBS:** a opção "Tirar ICMS, PIS e COFINS da base" vem marcada. Confira se é a regra que você quer aplicar

> Essa é a parte que diferencia o seu sistema: **a inteligência tributária fica com você**, não com o cliente.

---

## 8. Emitir a primeira NF-e (homologação)

### 8.1 Cadastre um produto

Menu **Produtos → + Novo produto**: código, descrição, NCM (8 dígitos), unidade, preço e **perfil fiscal**.

### 8.2 Dê entrada no estoque

Menu **Estoque → Ajuste / inventário**: escolha o produto, tipo **Entrada manual**, quantidade e custo.

### 8.3 Cadastre um cliente

Menu **Clientes e fornecedores → + Novo cadastro**: digite o CNPJ e o endereço vem sozinho. Marque se ele é **contribuinte do ICMS** e preencha a IE se for.

> 💡 Para o primeiro teste, você pode usar **a própria empresa** como cliente, marcada como "Não contribuinte".

### 8.4 Faça o pedido e emita

1. Menu **Pedidos e orçamentos → + Novo pedido**.
2. Escolha o cliente e adicione os produtos.
3. Escolha a forma de pagamento. Em **boleto**, informe parcelas e 1º vencimento.
4. Veja no quadro **Resumo** o ICMS, o IBS, a CBS e o total.
5. Clique em **Salvar e emitir NF-e**.

Se aparecer **"NF-e autorizada"**, parabéns: seu sistema conversou com a SEFAZ. 🎉

Confira o que aconteceu sozinho:

- **Notas fiscais:** a nota com DANFE e XML
- **Estoque:** a quantidade baixou
- **Contas a receber:** as parcelas, se foi a prazo

### 8.5 Teste o resto

Em **Notas fiscais**, na nota emitida:

- **CC-e:** envie uma carta de correção
- **Cancelar:** cancele a nota. Confira que o estoque voltou, as parcelas foram canceladas e o pedido reabriu

---

## 9. NFC-e (venda balcão)

Para emitir NFC-e a empresa precisa do **CSC** (Código de Segurança do Contribuinte):

1. Gere o CSC de **homologação** no portal da SEFAZ do seu estado.
2. Cadastre em **Configurações → Empresa → NFC-e (CSC)**: o ID (ex.: `000001`) e o código.
3. Use o menu **Venda balcão (NFC-e)**.

---

## 10. Entrada de mercadoria pelo XML de compra

Menu **Estoque → Entrada por XML**:

1. Escolha o XML da nota do fornecedor.
2. Para cada item, escolha **Vincular** a um produto seu, **Criar produto novo** ou **Não lançar**.
3. **Fator:** quantas unidades suas vêm em 1 unidade do fornecedor (caixa com 12 = 12).
4. Clique em **Lançar no estoque**.

O custo médio é recalculado com IPI, ST e frete. Na próxima nota do mesmo fornecedor, o vínculo já vem sugerido.

---

## 11. Comandos do dia a dia

Rode sempre na pasta do projeto.

| O que fazer | Comando |
|---|---|
| Ligar o sistema | `docker compose up -d` |
| Desligar | `docker compose down` |
| Ver o que está acontecendo | `docker logs -f emissor-nfe` (Ctrl+C para sair) |
| Atualizar para a versão nova do repositório | `git pull` e depois `docker compose up -d --build` |
| Ver os backups do banco | `docker run --rm -v pac-faturamento_emissor-backups:/b alpine ls -lh /b` |

> ⚠️ **Nunca rode `docker compose down -v`**. O `-v` apaga os volumes: banco de dados, XMLs e backups. Os dados só ficam guardados enquanto os volumes existirem.

---

## 12. Problemas comuns

| O que aparece | O que fazer |
|---|---|
| `Cannot connect to the Docker daemon` | O Docker Desktop está fechado. Abra e espere "Engine running". |
| `port is already allocated` | A porta está em uso. Troque o `HOST_PORT` no `.env` e rode `docker compose up -d` de novo. |
| A página abre **outro sistema** | Use `127.0.0.1` em vez de `localhost`, na porta do `HOST_PORT`. |
| "Não foi possível abrir o certificado: senha incorreta" | Confira a senha do .pfx (maiúsculas e minúsculas contam). |
| "O certificado é de outro CNPJ" | O .pfx não é da empresa que você está cadastrando. |
| Rejeição **696** (não contribuinte deve indicar consumidor final) | O sistema já corrige sozinho. Se aparecer, confira se o cliente está marcado como "Não contribuinte". |
| Rejeição **209 ou 230** (IE do emitente) | Inscrição estadual errada ou não habilitada para NF-e. Corrija em Configurações → Empresa. |
| Rejeição **539** (duplicidade) | Esse número já foi usado em homologação. Aumente o "Próximo nº NF-e" em Configurações → Empresa. |
| "A nota não passou na validação do leiaute" | Algum campo está no formato errado (NCM, CFOP, CEP...). A mensagem diz qual. Nada foi enviado e o número não foi gasto. |
| Esqueci a senha do admin | Peça para outro usuário da equipe trocar em Configurações → Usuários. |

---

## 13. Antes de pensar em produção

O sistema roda em **homologação** até você liberar a produção (Configurações → Empresa → Liberar produção). Antes de liberar para qualquer cliente:

- [ ] Emita, corrija e cancele várias notas em homologação, com todos os cenários do cliente (dentro e fora do estado, contribuinte e não contribuinte, ST, devolução)
- [ ] Revise **todos os perfis fiscais** com o seu conhecimento tributário
- [ ] Coloque **série e próximo número** corretos de produção. Se o cliente já emitia em outro sistema, continue a numeração dele ou use outra série
- [ ] Coloque o sistema num **servidor (VPS) com HTTPS**, não no seu computador pessoal
- [ ] Garanta **backup fora do servidor** (banco e pasta de XMLs). O XML precisa ser guardado por 5 anos
- [ ] Guarde a **MASTER_KEY** em lugar seguro

> ⚠️ Em produção a nota tem **valor fiscal**. A responsabilidade pelas regras tributárias configuradas e pelo uso do certificado é de quem configura e de quem emite. Teste bastante antes.

---

## 14. Segurança, sempre

- **Nunca** suba o `.env`, certificados `.pfx` ou a pasta `teste` para o GitHub (o `.gitignore` já bloqueia, não remova).
- **Nunca** mande certificado ou senha por WhatsApp ou e-mail. Cadastre direto na tela do sistema: lá eles ficam criptografados.
- Cada cliente acessa **só a empresa dele**: crie o usuário em Configurações → Usuários e marque apenas a empresa daquele cliente.
- Ao sair do computador, saia do sistema (menu lateral → Sair).

---

Dúvidas? Traga no encontro ao vivo com o print da tela e a mensagem completa do erro.

**Siga @franklim.contador**
