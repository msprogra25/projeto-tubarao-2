-- ============================================================
-- SCHEMA DO SISTEMA PDV
-- Compatível com SQLite (padrão do projeto, zero-config).
-- Para produção com +300 usuários simultâneos, migrar para
-- PostgreSQL (ver README > "Migração para PostgreSQL").
-- ============================================================

CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- linha única (singleton)
  nome TEXT NOT NULL DEFAULT 'Minha Empresa',
  logo_path TEXT
);

INSERT OR IGNORE INTO empresa (id, nome, logo_path) VALUES (1, 'Minha Empresa', NULL);

CREATE TABLE IF NOT EXISTS vendedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  cnpj TEXT,
  endereco TEXT,
  cep TEXT,
  telefone TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT UNIQUE NOT NULL,
  localizacao TEXT,              -- ex: "Estante 5" ou "5, 4" (múltiplas estantes)
  cor TEXT DEFAULT '#0e9f6e'     -- cor de destaque da categoria (badge)
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cnpj TEXT UNIQUE NOT NULL,
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  codigo_barras TEXT UNIQUE,
  categoria_id INTEGER REFERENCES categorias(id),
  fornecedor_id INTEGER REFERENCES fornecedores(id),
  imagem TEXT,

  -- Estoque
  quantidade INTEGER NOT NULL DEFAULT 0,
  estoque_minimo INTEGER NOT NULL DEFAULT 10,
  estoque_maximo INTEGER NOT NULL DEFAULT 100,

  -- Fiscal / NCM / CEST / Origem
  ncm TEXT,
  cest TEXT,           -- exatamente 7 dígitos
  origem INTEGER DEFAULT 0, -- 0 nacional, 1 estrangeira (direta), 2 estrangeira (mercado interno)

  -- Formação de preço
  preco_compra REAL NOT NULL DEFAULT 0,
  ipi REAL NOT NULL DEFAULT 0,
  despesas_dri REAL NOT NULL DEFAULT 0,
  credito_icms REAL NOT NULL DEFAULT 0,
  despesas_faturamento_pct REAL NOT NULL DEFAULT 0, -- DF%
  despesas_operacionais_pct REAL NOT NULL DEFAULT 0, -- DO%
  lucro_desejado_pct REAL NOT NULL DEFAULT 0,        -- L%
  preco_venda REAL NOT NULL DEFAULT 0,               -- calculado

  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendedor_id INTEGER REFERENCES vendedores(id),
  total REAL NOT NULL DEFAULT 0,
  forma_pagamento TEXT DEFAULT 'dinheiro', -- dinheiro | pix | cartao_credito | cartao_debito
  valor_recebido REAL,  -- quanto o cliente pagou (relevante p/ dinheiro)
  troco REAL,           -- valor_recebido - total
  pdf_path TEXT,
  pdf_expira_em TEXT, -- data/hora de exclusão automática (criado_em + 2 dias)
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venda_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER REFERENCES vendas(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id),
  nome TEXT NOT NULL,
  categoria TEXT,
  codigo_barras TEXT,
  quantidade INTEGER NOT NULL,
  valor_unitario REAL NOT NULL,
  subtotal REAL NOT NULL,
  ncm TEXT,       -- snapshot do produto no momento da venda (histórico fiscal)
  cest TEXT,
  origem INTEGER
);

CREATE TABLE IF NOT EXISTS integracoes (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- singleton, uma integração por instalação
  google_drive_access_token TEXT,
  google_drive_refresh_token TEXT,
  google_drive_expiry_date INTEGER,
  google_drive_pasta_id TEXT,     -- pasta "PDV - Comprovantes e Fotos" no Drive do usuário
  google_drive_conectado_em TEXT
);
INSERT OR IGNORE INTO integracoes (id) VALUES (1);

CREATE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_produtos_nome ON produtos(nome);
CREATE INDEX IF NOT EXISTS idx_vendas_criado_em ON vendas(criado_em);
