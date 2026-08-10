// db.js — Conexão com Neon em produção, fallback para SQLite em desenvolvimento.
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

if (process.env.DATABASE_URL) {
  const sql = neon(process.env.DATABASE_URL);
  module.exports = sql;
  return;
}

// Fallback local para desenvolvimento sem DATABASE_URL.
const Database = require('better-sqlite3');
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
 * Neon + DATABASE_URL (produção)
 * ---------------------------------------------------------------
 * Quando DATABASE_URL estiver definido, este módulo exporta o cliente
 * Neon via `const sql = neon(process.env.DATABASE_URL);`.
 *
 * Para rotas que hoje usam SQLite (`db.prepare(...).get/all/run(...)`),
 * a migração real para Neon exige trocar para queries assíncronas em
 * template literals, por exemplo:
 *
 *   const produtos = await sql`SELECT * FROM produtos`;
 *
 * Isso mantém o backend compatível com SQLite local e com Neon em produção.
 */
