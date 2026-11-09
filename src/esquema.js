// Esquema do banco. Idempotente: roda a cada início (CREATE ... IF NOT EXISTS).
// Dinheiro em centavos (bigint). Quantidades e custos médios em numeric.
export const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id serial PRIMARY KEY,
  nome text NOT NULL,
  email text NOT NULL UNIQUE,
  senha_hash text NOT NULL,
  papel text NOT NULL CHECK (papel IN ('admin','equipe','vendedor','financeiro')),
  empresas int[],
  ativo boolean NOT NULL DEFAULT true,
  trocar_senha boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS empresas (
  id serial PRIMARY KEY,
  cnpj text NOT NULL UNIQUE,
  razao_social text NOT NULL,
  nome_fantasia text NOT NULL DEFAULT '',
  ie text NOT NULL DEFAULT '',
  im text NOT NULL DEFAULT '',
  crt text NOT NULL CHECK (crt IN ('1','2','3')),
  cnae text NOT NULL DEFAULT '',
  logradouro text NOT NULL, numero text NOT NULL, complemento text NOT NULL DEFAULT '',
  bairro text NOT NULL, cod_municipio text NOT NULL, municipio text NOT NULL,
  uf text NOT NULL, cep text NOT NULL, fone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
  ambiente int NOT NULL DEFAULT 2 CHECK (ambiente IN (1,2)),
  serie_nfe int NOT NULL DEFAULT 1, proximo_nfe int NOT NULL DEFAULT 1,
  serie_nfce int NOT NULL DEFAULT 1, proximo_nfce int NOT NULL DEFAULT 1,
  csc_id text, csc_cifrado text,
  cert_cifrado text, cert_senha_cifrada text, cert_titular text, cert_validade timestamptz,
  proximo_pedido int NOT NULL DEFAULT 1,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS perfis_fiscais (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  cfop_interno text NOT NULL, cfop_interestadual text NOT NULL, cfop_nfce text NOT NULL,
  origem text NOT NULL DEFAULT '0',
  cst_icms text NOT NULL,
  aliq_icms_interna numeric(7,4) NOT NULL DEFAULT 0,
  aliq_icms_interestadual numeric(7,4) NOT NULL DEFAULT 0,
  reducao_bc_icms numeric(7,4) NOT NULL DEFAULT 0,
  mva_st numeric(7,4) NOT NULL DEFAULT 0,
  aliq_icms_st numeric(7,4) NOT NULL DEFAULT 0,
  cst_pis text NOT NULL, aliq_pis numeric(7,4) NOT NULL DEFAULT 0,
  cst_cofins text NOT NULL, aliq_cofins numeric(7,4) NOT NULL DEFAULT 0,
  cst_ipi text, aliq_ipi numeric(7,4) NOT NULL DEFAULT 0,
  informar_ibscbs boolean NOT NULL DEFAULT true,
  cst_ibscbs text NOT NULL DEFAULT '000',
  cclass_trib text NOT NULL DEFAULT '000001',
  aliq_ibs_uf numeric(7,4) NOT NULL DEFAULT 0.1,
  aliq_ibs_mun numeric(7,4) NOT NULL DEFAULT 0,
  aliq_cbs numeric(7,4) NOT NULL DEFAULT 0.9,
  ibscbs_base_liquida boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS produtos (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  codigo text NOT NULL,
  descricao text NOT NULL,
  ncm text NOT NULL,
  cest text NOT NULL DEFAULT '',
  ean text NOT NULL DEFAULT '',
  unidade text NOT NULL DEFAULT 'UN',
  preco_cent bigint NOT NULL DEFAULT 0,
  perfil_id int NOT NULL REFERENCES perfis_fiscais(id),
  estoque numeric(15,4) NOT NULL DEFAULT 0,
  estoque_minimo numeric(15,4) NOT NULL DEFAULT 0,
  custo_medio_cent numeric(15,4) NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS pessoas (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  tipo text NOT NULL CHECK (tipo IN ('cliente','fornecedor','ambos')),
  cpf_cnpj text NOT NULL,
  nome text NOT NULL,
  nome_fantasia text NOT NULL DEFAULT '',
  ind_ie_dest text NOT NULL DEFAULT '9' CHECK (ind_ie_dest IN ('1','2','9')),
  ie text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '', fone text NOT NULL DEFAULT '',
  logradouro text NOT NULL DEFAULT '', numero text NOT NULL DEFAULT '', complemento text NOT NULL DEFAULT '',
  bairro text NOT NULL DEFAULT '', cod_municipio text NOT NULL DEFAULT '', municipio text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '', cep text NOT NULL DEFAULT '',
  ativo boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS pessoas_doc ON pessoas (empresa_id, cpf_cnpj);

CREATE TABLE IF NOT EXISTS pedidos (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  numero int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('orcamento','pedido')),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','faturado','cancelado')),
  cliente_id int NOT NULL REFERENCES pessoas(id),
  vendedor_id int REFERENCES usuarios(id),
  forma_pagamento text NOT NULL DEFAULT '01',
  parcelas int NOT NULL DEFAULT 1,
  primeiro_vencimento date,
  intervalo_dias int NOT NULL DEFAULT 30,
  observacoes text NOT NULL DEFAULT '',
  total_cent bigint NOT NULL DEFAULT 0,
  nota_id int,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id serial PRIMARY KEY,
  pedido_id int NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id int NOT NULL REFERENCES produtos(id),
  quantidade numeric(15,4) NOT NULL,
  valor_unitario_cent bigint NOT NULL,
  desconto_cent bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notas (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  modelo text NOT NULL CHECK (modelo IN ('55','65')),
  serie int NOT NULL,
  numero int NOT NULL,
  chave text,
  status text NOT NULL,
  ambiente int NOT NULL,
  cliente_id int REFERENCES pessoas(id),
  destinatario text NOT NULL DEFAULT '',
  pedido_id int REFERENCES pedidos(id),
  natureza text NOT NULL DEFAULT 'VENDA',
  total_cent bigint NOT NULL DEFAULT 0,
  totais jsonb NOT NULL DEFAULT '{}',
  dados jsonb NOT NULL DEFAULT '{}',
  xml_assinado text,
  xml_autorizado text,
  protocolo text,
  c_stat text, x_motivo text,
  efeitos_aplicados boolean NOT NULL DEFAULT false,
  emitida_em timestamptz NOT NULL DEFAULT now(),
  autorizada_em timestamptz,
  cancelada_em timestamptz,
  UNIQUE (empresa_id, modelo, serie, numero)
);

CREATE TABLE IF NOT EXISTS nota_eventos (
  id serial PRIMARY KEY,
  nota_id int NOT NULL REFERENCES notas(id),
  tipo text NOT NULL CHECK (tipo IN ('cce','cancelamento')),
  sequencia int NOT NULL,
  texto text NOT NULL,
  protocolo text, c_stat text, x_motivo text,
  registrado boolean NOT NULL DEFAULT false,
  xml text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notas ADD COLUMN IF NOT EXISTS enviando_desde timestamptz;

-- Tentativas de login recusadas (limite por e-mail e por IP, válido entre instâncias do servidor).
CREATE TABLE IF NOT EXISTS tentativas_login (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tentativas_login_email ON tentativas_login (email, criado_em);
CREATE INDEX IF NOT EXISTS tentativas_login_ip ON tentativas_login (ip, criado_em);

-- Faixas de numeração inutilizadas na SEFAZ (números pulados que nunca viraram nota autorizada).
CREATE TABLE IF NOT EXISTS inutilizacoes (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  modelo text NOT NULL CHECK (modelo IN ('55','65')),
  serie int NOT NULL,
  numero_inicial int NOT NULL,
  numero_final int NOT NULL,
  justificativa text NOT NULL,
  ambiente int NOT NULL,
  status text NOT NULL CHECK (status IN ('enviando','homologada','rejeitada','sem_resposta')),
  protocolo text, c_stat text, x_motivo text,
  xml text,
  usuario_id int REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entradas_xml (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  chave text NOT NULL,
  fornecedor_id int REFERENCES pessoas(id),
  numero text, emitida_em timestamptz,
  total_cent bigint NOT NULL DEFAULT 0,
  xml text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, chave)
);

CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  produto_id int NOT NULL REFERENCES produtos(id),
  tipo text NOT NULL CHECK (tipo IN ('entrada_manual','saida_manual','inventario','venda','estorno_venda','entrada_xml')),
  quantidade numeric(15,4) NOT NULL,
  custo_unitario_cent numeric(15,4) NOT NULL DEFAULT 0,
  saldo_apos numeric(15,4) NOT NULL,
  nota_id int REFERENCES notas(id),
  entrada_id int REFERENCES entradas_xml(id),
  observacao text NOT NULL DEFAULT '',
  usuario_id int REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mov_produto ON estoque_movimentos (produto_id, id DESC);

CREATE TABLE IF NOT EXISTS vinculos_fornecedor (
  empresa_id int NOT NULL REFERENCES empresas(id),
  fornecedor_cnpj text NOT NULL,
  codigo_fornecedor text NOT NULL,
  produto_id int NOT NULL REFERENCES produtos(id),
  fator numeric(15,4) NOT NULL DEFAULT 1,
  PRIMARY KEY (empresa_id, fornecedor_cnpj, codigo_fornecedor)
);

CREATE TABLE IF NOT EXISTS contas_receber (
  id serial PRIMARY KEY,
  empresa_id int NOT NULL REFERENCES empresas(id),
  nota_id int REFERENCES notas(id),
  pedido_id int REFERENCES pedidos(id),
  cliente_id int REFERENCES pessoas(id),
  parcela int NOT NULL,
  numero_dup text NOT NULL,
  vencimento date NOT NULL,
  valor_cent bigint NOT NULL,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','recebida','cancelada')),
  recebida_em date,
  valor_recebido_cent bigint,
  forma text
);
CREATE INDEX IF NOT EXISTS receber_empresa ON contas_receber (empresa_id, status, vencimento);
`;
