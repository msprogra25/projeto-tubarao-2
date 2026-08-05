const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { autenticar } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads', 'produtos'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `produto_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg'].includes(file.mimetype);
    cb(ok ? null : new Error('Apenas PNG ou JPG são permitidos'), ok);
  }
});

// ---------------------------------------------------------------
// Cálculo de formação de preço (regras do módulo PDV)
//   Custo Real = Preço de Compra + IPI + Desp. DRI - Crédito de ICMS
//   Markup Divisor = (100 - (DF% + DO% + L%)) / 100
//   Preço de Venda = Custo Real / Markup Divisor
// ---------------------------------------------------------------
function calcularPrecoVenda({ preco_compra, ipi, despesas_dri, credito_icms, despesas_faturamento_pct, despesas_operacionais_pct, lucro_desejado_pct }) {
  const custoReal = Number(preco_compra || 0) + Number(ipi || 0) + Number(despesas_dri || 0) - Number(credito_icms || 0);
  const somaPercentuais = Number(despesas_faturamento_pct || 0) + Number(despesas_operacionais_pct || 0) + Number(lucro_desejado_pct || 0);
  const markupDivisor = (100 - somaPercentuais) / 100;

  if (markupDivisor <= 0) {
    throw new Error('A soma de DF% + DO% + L% deve ser menor que 100%');
  }

  const precoVenda = custoReal / markupDivisor;
  return {
    custoReal: Number(custoReal.toFixed(2)),
    precoVenda: Number(precoVenda.toFixed(2)),
    markupDivisor: Number(markupDivisor.toFixed(4)),
  };
}

// POST /api/produtos/calcular-preco — usado ao vivo no formulário/PDV
router.post('/calcular-preco', autenticar, (req, res) => {
  try {
    const resultado = calcularPrecoVenda(req.body);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/produtos?busca=&categoria_id=&codigo_barras=
router.get('/', autenticar, (req, res) => {
  const { busca, categoria_id, codigo_barras } = req.query;
  let sql = 'SELECT p.*, c.nome AS categoria_nome, c.cor AS categoria_cor, c.localizacao AS categoria_localizacao FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id WHERE 1=1';
  const params = [];

  if (busca) {
    sql += ' AND (p.nome LIKE ? OR p.codigo_barras LIKE ? OR c.nome LIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  if (categoria_id) {
    sql += ' AND p.categoria_id = ?';
    params.push(categoria_id);
  }
  if (codigo_barras) {
    sql += ' AND p.codigo_barras = ?';
    params.push(codigo_barras);
  }
  sql += ' ORDER BY p.nome ASC';

  const produtos = db.prepare(sql).all(...params);
  res.json(produtos);
});

// GET /api/produtos/codigo/:codigo — leitura via câmera/scanner no PDV
router.get('/codigo/:codigo', autenticar, (req, res) => {
  const produto = db.prepare('SELECT * FROM produtos WHERE codigo_barras = ?').get(req.params.codigo);
  if (!produto) {
    return res.status(404).json({ erro: 'Produto não cadastrado. Cadastre-o em Registro de Estoque antes de vendê-lo.' });
  }
  res.json(produto);
});

// POST /api/produtos — cria produto (com cálculo automático de preço de venda)
router.post('/', autenticar, upload.single('imagem'), (req, res) => {
  const b = req.body;
  try {
    const { custoReal, precoVenda: precoCalculado } = calcularPrecoVenda(b);
    // Se o formulário enviou um preço de venda válido, respeita esse valor
    // (pode ser o calculado automaticamente, já sincronizado pelo frontend,
    // ou um valor que o usuário ajustou manualmente por cima do cálculo).
    const precoVenda = (b.preco_venda !== undefined && b.preco_venda !== '' && !isNaN(Number(b.preco_venda)))
      ? Number(b.preco_venda)
      : precoCalculado;

    const info = db.prepare(`
      INSERT INTO produtos (
        nome, codigo_barras, categoria_id, fornecedor_id, imagem,
        quantidade, estoque_minimo, estoque_maximo,
        ncm, cest, origem,
        preco_compra, ipi, despesas_dri, credito_icms,
        despesas_faturamento_pct, despesas_operacionais_pct, lucro_desejado_pct,
        preco_venda
      ) VALUES (?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?)
    `).run(
      b.nome, b.codigo_barras || null, b.categoria_id || null, b.fornecedor_id || null,
      req.file ? `/uploads/produtos/${req.file.filename}` : (b.imagem_url || null),
      Number(b.quantidade || 0), Number(b.estoque_minimo || 10), Number(b.estoque_maximo || 100),
      b.ncm || null, b.cest || null, Number(b.origem || 0),
      Number(b.preco_compra || 0), Number(b.ipi || 0), Number(b.despesas_dri || 0), Number(b.credito_icms || 0),
      Number(b.despesas_faturamento_pct || 0), Number(b.despesas_operacionais_pct || 0), Number(b.lucro_desejado_pct || 0),
      precoVenda
    );

    res.status(201).json({ id: info.lastInsertRowid, custoReal, precoVenda });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// PUT /api/produtos/:id — edita produto e recalcula preço de venda
router.put('/:id', autenticar, upload.single('imagem'), (req, res) => {
  const b = req.body;
  const { id } = req.params;
  const existente = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
  if (!existente) return res.status(404).json({ erro: 'Produto não encontrado' });

  try {
    const merged = { ...existente, ...b };
    const { precoVenda: precoCalculado } = calcularPrecoVenda(merged);
    const precoVenda = (b.preco_venda !== undefined && b.preco_venda !== '' && !isNaN(Number(b.preco_venda)))
      ? Number(b.preco_venda)
      : precoCalculado;
    const imagem = req.file ? `/uploads/produtos/${req.file.filename}` : (b.imagem_url || existente.imagem);

    db.prepare(`
      UPDATE produtos SET
        nome=?, codigo_barras=?, categoria_id=?, fornecedor_id=?, imagem=?,
        quantidade=?, estoque_minimo=?, estoque_maximo=?,
        ncm=?, cest=?, origem=?,
        preco_compra=?, ipi=?, despesas_dri=?, credito_icms=?,
        despesas_faturamento_pct=?, despesas_operacionais_pct=?, lucro_desejado_pct=?,
        preco_venda=?, atualizado_em=datetime('now')
      WHERE id=?
    `).run(
      merged.nome, merged.codigo_barras, merged.categoria_id, merged.fornecedor_id, imagem,
      Number(merged.quantidade), Number(merged.estoque_minimo), Number(merged.estoque_maximo),
      merged.ncm, merged.cest, Number(merged.origem),
      Number(merged.preco_compra), Number(merged.ipi), Number(merged.despesas_dri), Number(merged.credito_icms),
      Number(merged.despesas_faturamento_pct), Number(merged.despesas_operacionais_pct), Number(merged.lucro_desejado_pct),
      precoVenda, id
    );

    res.json({ id: Number(id), precoVenda });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// PATCH /api/produtos/:id/estoque — edição rápida só da quantidade,
// usada na lista principal (sem precisar abrir o formulário completo).
router.patch('/:id/estoque', autenticar, (req, res) => {
  const { quantidade } = req.body;
  if (quantidade === undefined || isNaN(Number(quantidade)) || Number(quantidade) < 0) {
    return res.status(400).json({ erro: 'Quantidade inválida' });
  }
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado' });

  db.prepare("UPDATE produtos SET quantidade = ?, atualizado_em = datetime('now') WHERE id = ?")
    .run(Number(quantidade), req.params.id);

  const atualizado = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
  res.json({
    id: atualizado.id,
    quantidade: atualizado.quantidade,
    falta_estoque: atualizado.quantidade < atualizado.estoque_minimo,
  });
});

// DELETE /api/produtos/:id
router.delete('/:id', autenticar, (req, res) => {
  db.prepare('DELETE FROM produtos WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

// ---- Categorias ----
router.get('/categorias/listar', autenticar, (req, res) => {
  res.json(db.prepare('SELECT * FROM categorias ORDER BY nome').all());
});

router.post('/categorias/criar', autenticar, (req, res) => {
  const { nome, localizacao, cor } = req.body;
  const info = db.prepare('INSERT OR IGNORE INTO categorias (nome, localizacao, cor) VALUES (?, ?, ?)')
    .run(nome, localizacao || null, cor || '#0e9f6e');
  res.status(201).json({ id: info.lastInsertRowid, nome, localizacao, cor });
});

router.put('/categorias/:id', autenticar, (req, res) => {
  const atual = db.prepare('SELECT * FROM categorias WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Categoria não encontrada' });
  const nome = req.body.nome ?? atual.nome;
  const localizacao = req.body.localizacao ?? atual.localizacao;
  const cor = req.body.cor ?? atual.cor;
  db.prepare('UPDATE categorias SET nome = ?, localizacao = ?, cor = ? WHERE id = ?').run(nome, localizacao, cor, req.params.id);
  res.json({ id: Number(req.params.id), nome, localizacao, cor });
});

// GET /api/produtos/categorias/localizacoes — para o card "Localização no estoque" do dashboard
router.get('/categorias/localizacoes', autenticar, (req, res) => {
  const dados = db.prepare(`
    SELECT c.nome, c.localizacao, c.cor,
           COALESCE(SUM(p.quantidade), 0) AS quantidade_total,
           COUNT(p.id) AS numero_produtos
    FROM categorias c
    LEFT JOIN produtos p ON p.categoria_id = c.id
    WHERE c.localizacao IS NOT NULL AND TRIM(c.localizacao) != ''
    GROUP BY c.id
    ORDER BY c.nome
  `).all();
  res.json(dados);
});

router.delete('/categorias/:id', autenticar, (req, res) => {
  // Produtos vinculados ficam sem categoria (não são apagados) — evita
  // violar a chave estrangeira categoria_id -> categorias(id).
  const transacao = db.transaction((id) => {
    db.prepare('UPDATE produtos SET categoria_id = NULL WHERE categoria_id = ?').run(id);
    db.prepare('DELETE FROM categorias WHERE id = ?').run(id);
  });
  try {
    transacao(req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao excluir categoria', detalhe: err.message });
  }
});

module.exports = router;
