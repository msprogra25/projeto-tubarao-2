const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { autenticar } = require('../middleware/auth');

const router = express.Router();
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

const uploadXml = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'backend-python', 'storage', 'xml_uploads'),
    filename: (req, file, cb) => cb(null, `nfe_${Date.now()}_${file.originalname}`)
  })
});

// GET /api/fornecedores?busca=
router.get('/', autenticar, (req, res) => {
  const { busca } = req.query;
  let sql = 'SELECT * FROM fornecedores WHERE 1=1';
  const params = [];
  if (busca) {
    sql += ' AND (nome LIKE ? OR cnpj LIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`);
  }
  res.json(db.prepare(sql + ' ORDER BY nome').all(...params));
});

// POST /api/fornecedores
router.post('/', autenticar, (req, res) => {
  const { nome, cnpj, telefone, email, endereco } = req.body;
  if (!nome || !cnpj) return res.status(400).json({ erro: 'Nome e CNPJ são obrigatórios' });

  const info = db.prepare(
    'INSERT INTO fornecedores (nome, cnpj, telefone, email, endereco) VALUES (?,?,?,?,?)'
  ).run(nome, cnpj, telefone, email, endereco);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/fornecedores/:id
router.put('/:id', autenticar, (req, res) => {
  const { nome, cnpj, telefone, email, endereco } = req.body;
  db.prepare(
    'UPDATE fornecedores SET nome=?, cnpj=?, telefone=?, email=?, endereco=? WHERE id=?'
  ).run(nome, cnpj, telefone, email, endereco, req.params.id);
  res.json({ id: Number(req.params.id) });
});

// DELETE /api/fornecedores/:id
router.delete('/:id', autenticar, (req, res) => {
  db.prepare('DELETE FROM fornecedores WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

// GET /api/fornecedores/:id/produtos — produtos vinculados
router.get('/:id/produtos', autenticar, (req, res) => {
  res.json(db.prepare('SELECT * FROM produtos WHERE fornecedor_id = ?').all(req.params.id));
});

// GET /api/fornecedores/:id/pdf — gera um PDF com os produtos do fornecedor (data/hora inclusas)
router.get('/:id/pdf', autenticar, async (req, res) => {
  const fornecedor = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(req.params.id);
  if (!fornecedor) return res.status(404).json({ erro: 'Fornecedor não encontrado' });

  const produtos = db.prepare('SELECT * FROM produtos WHERE fornecedor_id = ?').all(req.params.id);

  try {
    const respPy = await fetch(`${PYTHON_SERVICE_URL}/pdf/gerar-produtos-fornecedor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fornecedor_nome: fornecedor.nome,
        fornecedor_cnpj: fornecedor.cnpj,
        produtos: produtos.map(p => ({
          nome: p.nome, codigo_barras: p.codigo_barras,
          quantidade: p.quantidade, preco_compra: p.preco_compra, preco_venda: p.preco_venda,
        })),
      }),
    });
    if (!respPy.ok) return res.status(502).json({ erro: 'Falha ao gerar PDF' });
    const data = await respPy.json();
    res.json({ pdf_url: data.pdf_url.replace('/storage', '/api/storage') });
  } catch (err) {
    res.status(502).json({ erro: 'Serviço Python indisponível', detalhe: err.message });
  }
});

// POST /api/fornecedores/importar-xml — envia XML da NF-e para o serviço Python
// e aplica as atualizações de estoque/financeiro retornadas.
router.post('/importar-xml', autenticar, uploadXml.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

  try {
    const respPy = await fetch(`${PYTHON_SERVICE_URL}/xml/processar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caminho_arquivo: req.file.path })
    });

    if (!respPy.ok) {
      const erro = await respPy.json();
      return res.status(422).json({ erro: erro.detail || 'Falha ao processar XML' });
    }

    const dados = await respPy.json();

    // Atualiza estoque com base nos itens extraídos do XML
    const atualizar = db.transaction((itens) => {
      const atualizados = [];
      for (const item of itens) {
        const existente = db.prepare('SELECT * FROM produtos WHERE codigo_barras = ?').get(item.codigo_barras);
        if (existente) {
          db.prepare('UPDATE produtos SET quantidade = quantidade + ?, preco_compra = ? WHERE id = ?')
            .run(item.quantidade, item.valor_unitario, existente.id);
          atualizados.push({ ...item, status: 'estoque_atualizado' });
        } else {
          atualizados.push({ ...item, status: 'produto_nao_cadastrado' });
        }
      }
      return atualizados;
    });

    const resultado = atualizar(dados.itens || []);
    res.json({ fornecedor: dados.fornecedor, itens: resultado });
  } catch (err) {
    res.status(502).json({ erro: 'Serviço de processamento fiscal indisponível', detalhe: err.message });
  }
});

module.exports = router;
