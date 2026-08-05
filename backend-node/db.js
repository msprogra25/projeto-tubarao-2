// db.js — Conexão SQLite com WAL mode (melhora concorrência de leitura/escrita)
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'pdv.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');

const db = new Database(DB_PATH);

// WAL = Write-Ahead Logging: permite múltiplas leituras concorrentes
// enquanto uma escrita acontece. Essencial para suportar muitos
// usuários simultâneos consultando estoque/vendas.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// Aplica o schema na primeira execução
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

// -----------------------------------------------------------------
// Migração leve: bancos criados antes desta versão não têm as colunas
// novas de localização/cor da categoria. CREATE TABLE IF NOT EXISTS
// não adiciona colunas em tabelas já existentes, então fazemos isso
// manualmente aqui, ignorando o erro se a coluna já existir.
// -----------------------------------------------------------------
function adicionarColunaSeNaoExistir(tabela, coluna, definicao) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
  if (!colunas.includes(coluna)) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  }
}
adicionarColunaSeNaoExistir('categorias', 'localizacao', 'TEXT');
adicionarColunaSeNaoExistir('categorias', 'cor', "TEXT DEFAULT '#0e9f6e'");
adicionarColunaSeNaoExistir('venda_itens', 'ncm', 'TEXT');
adicionarColunaSeNaoExistir('venda_itens', 'cest', 'TEXT');
adicionarColunaSeNaoExistir('venda_itens', 'origem', 'INTEGER');
adicionarColunaSeNaoExistir('vendas', 'forma_pagamento', "TEXT DEFAULT 'dinheiro'");
adicionarColunaSeNaoExistir('vendas', 'valor_recebido', 'REAL');
adicionarColunaSeNaoExistir('vendas', 'troco', 'REAL');
adicionarColunaSeNaoExistir('vendedores', 'cnpj', 'TEXT');
adicionarColunaSeNaoExistir('vendedores', 'endereco', 'TEXT');
adicionarColunaSeNaoExistir('vendedores', 'cep', 'TEXT');
adicionarColunaSeNaoExistir('vendedores', 'telefone', 'TEXT');

module.exports = db;

/*
 * ---------------------------------------------------------------
 * MIGRAÇÃO PARA POSTGRESQL (produção / +300 usuários simultâneos)
 * ---------------------------------------------------------------
 * SQLite é ótimo para desenvolvimento e cargas moderadas, mas para
 * alta concorrência real (centenas de conexões simultâneas de
 * escrita) o recomendado é PostgreSQL com um pool de conexões.
 *
 * Troque este arquivo por algo como:
 *
 *   const { Pool } = require('pg');
 *   const pool = new Pool({
 *     host: process.env.DB_HOST,
 *     user: process.env.DB_USER,
 *     password: process.env.DB_PASSWORD,
 *     database: process.env.DB_NAME,
 *     max: 50,              // conexões no pool
 *     idleTimeoutMillis: 30000,
 *   });
 *   module.exports = pool;
 *
 * As rotas usam `db.prepare(sql).get/all/run(...)` (estilo
 * better-sqlite3, síncrono). Para portar ao `pg`, troque essas
 * chamadas por `await pool.query(sql, params)` (assíncrono) —
 * a lógica de negócio (cálculos fiscais, validações) não muda.
 */
