const express = require('express');
const db = require('../db');
const fs = require('fs');
const path = require('path');
const { autenticar } = require('../middleware/auth');

const router = express.Router();
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

const FORMAS_PAGAMENTO_VALIDAS = ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito'];

// POST /api/vendas — concluir venda (transação atômica: baixa estoque + grava venda)
router.post('/', autenticar, async (req, res) => {
  const { itens, forma_pagamento, valor_recebido } = req.body; // [{ produto_id, quantidade }]
  if (!itens || !itens.length) {
    return res.status(400).json({ erro: 'O carrinho está vazio' });
  }
  const formaPagamento = FORMAS_PAGAMENTO_VALIDAS.includes(forma_pagamento) ? forma_pagamento : 'dinheiro';

  const transacao = db.transaction((itens) => {
    let total = 0;
    const itensProcessados = [];

    for (const item of itens) {
      const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(item.produto_id);
      if (!produto) throw new Error(`Produto ${item.produto_id} não encontrado`);
      if (produto.quantidade < item.quantidade) {
        throw new Error(`Estoque insuficiente para "${produto.nome}" (disponível: ${produto.quantidade})`);
      }

      const subtotal = produto.preco_venda * item.quantidade;
      total += subtotal;

      db.prepare('UPDATE produtos SET quantidade = quantidade - ? WHERE id = ?')
        .run(item.quantidade, produto.id);

      itensProcessados.push({
        produto_id: produto.id,
        nome: produto.nome,
        categoria: produto.categoria_id,
        codigo_barras: produto.codigo_barras,
        quantidade: item.quantidade,
        valor_unitario: produto.preco_venda,
        subtotal,
        ncm: produto.ncm,
        cest: produto.cest,
        origem: produto.origem,
      });
    }

    let valorRecebidoNum = valor_recebido !== undefined && valor_recebido !== null && valor_recebido !== ''
      ? Number(valor_recebido) : null;
    let troco = null;
    if (valorRecebidoNum !== null) {
      if (isNaN(valorRecebidoNum) || valorRecebidoNum < 0) {
        throw new Error('Valor pago inválido');
      }
      if (valorRecebidoNum < total) {
        throw new Error(`Valor pago (${valorRecebidoNum.toFixed(2)}) é menor que o total da venda (${total.toFixed(2)})`);
      }
      troco = Number((valorRecebidoNum - total).toFixed(2));
    }

    const infoVenda = db.prepare(
      "INSERT INTO vendas (vendedor_id, total, forma_pagamento, valor_recebido, troco, pdf_expira_em) VALUES (?, ?, ?, ?, ?, datetime('now', '+2 days'))"
    ).run(req.usuario.id, total, formaPagamento, valorRecebidoNum, troco);

    const vendaId = infoVenda.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO venda_itens (venda_id, produto_id, nome, categoria, codigo_barras, quantidade, valor_unitario, subtotal, ncm, cest, origem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const it of itensProcessados) {
      insertItem.run(vendaId, it.produto_id, it.nome, it.categoria, it.codigo_barras, it.quantidade, it.valor_unitario, it.subtotal, it.ncm, it.cest, it.origem);
    }

    return { vendaId, total, itens: itensProcessados, valorRecebido: valorRecebidoNum, troco };
  });

  try {
    const resultado = transacao(itens);

    // Solicita ao serviço Python a geração do PDF da nota/comprovante
    let pdfUrl = null;
    try {
      const empresa = db.prepare('SELECT * FROM empresa WHERE id = 1').get();
      const vendedor = db.prepare('SELECT * FROM vendedores WHERE id = ?').get(req.usuario.id);

      let logoBase64 = null;
      if (empresa.logo_path) {
        const caminhoLogo = path.join(__dirname, '..', empresa.logo_path.replace(/^\/uploads/, 'uploads'));
        if (fs.existsSync(caminhoLogo)) {
          logoBase64 = fs.readFileSync(caminhoLogo).toString('base64');
        }
      }

      const respPdf = await fetch(`${PYTHON_SERVICE_URL}/pdf/gerar-venda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venda_id: resultado.vendaId,
          itens: resultado.itens,
          total: resultado.total,
          empresa_nome: empresa.nome,
          forma_pagamento: formaPagamento,
          valor_recebido: resultado.valorRecebido,
          troco: resultado.troco,
          logo_base64: logoBase64,
          vendedor_cnpj: vendedor?.cnpj || null,
          vendedor_endereco: vendedor?.endereco || null,
          vendedor_cep: vendedor?.cep || null,
          vendedor_telefone: vendedor?.telefone || null,
        })
      });
      if (respPdf.ok) {
        const data = await respPdf.json();
        pdfUrl = data.pdf_url;
        db.prepare('UPDATE vendas SET pdf_path = ? WHERE id = ?').run(pdfUrl, resultado.vendaId);
      }
    } catch (e) {
      console.error('Falha ao gerar PDF (serviço Python indisponível):', e.message);
    }

    res.status(201).json({ ...resultado, pdf_url: pdfUrl, forma_pagamento: formaPagamento });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// GET /api/vendas — histórico (com busca)
router.get('/', autenticar, (req, res) => {
  const { busca } = req.query;
  let sql = `
    SELECT v.id, v.total, v.pdf_path, v.criado_em,
           GROUP_CONCAT(vi.nome, ', ') AS produtos,
           SUM(vi.quantidade) AS quantidade_itens
    FROM vendas v
    LEFT JOIN venda_itens vi ON vi.venda_id = v.id
  `;
  const params = [];
  if (busca) {
    sql += ' WHERE vi.nome LIKE ?';
    params.push(`%${busca}%`);
  }
  sql += ' GROUP BY v.id ORDER BY v.criado_em DESC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/vendas/carteira — somatória de todas as compras por dia, últimos 30 dias
// (precisa vir ANTES de /:id, senão "carteira" seria capturado como um ID)
router.get('/carteira', autenticar, (req, res) => {
  const porDia = db.prepare(`
    SELECT date(criado_em) AS dia, SUM(total) AS total, COUNT(*) AS quantidade_vendas
    FROM vendas
    WHERE criado_em >= date('now', '-30 days')
    GROUP BY dia
    ORDER BY dia DESC
  `).all();

  const totalGeral = porDia.reduce((acc, d) => acc + d.total, 0);

  res.json({ dias: porDia, total_geral: Number(totalGeral.toFixed(2)) });
});

// GET /api/vendas/:id — detalhe de uma venda
router.get('/:id', autenticar, (req, res) => {
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(req.params.id);
  if (!venda) return res.status(404).json({ erro: 'Venda não encontrada' });
  const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(req.params.id);
  res.json({ ...venda, itens });
});

// GET /api/vendas/dashboard/resumo — dados do gráfico financeiro (vendas x custos)
router.get('/dashboard/resumo', autenticar, (req, res) => {
  const vendasPorDia = db.prepare(`
    SELECT date(criado_em) AS dia, SUM(total) AS vendas
    FROM vendas
    WHERE criado_em >= date('now', '-30 days')
    GROUP BY dia ORDER BY dia ASC
  `).all();

  const custosPorDia = db.prepare(`
    SELECT date(v.criado_em) AS dia, SUM(vi.quantidade * p.preco_compra) AS custos
    FROM venda_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    JOIN produtos p ON p.id = vi.produto_id
    WHERE v.criado_em >= date('now', '-30 days')
    GROUP BY dia ORDER BY dia ASC
  `).all();

  res.json({ vendas: vendasPorDia, custos: custosPorDia });
});

// GET /api/vendas/dashboard/por-produto — para o gráfico de pizza/rosca
router.get('/dashboard/por-produto', autenticar, (req, res) => {
  const dados = db.prepare(`
    SELECT vi.nome, SUM(vi.subtotal) AS total, SUM(vi.quantidade) AS quantidade
    FROM venda_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    WHERE v.criado_em >= date('now', '-30 days')
    GROUP BY vi.nome
    ORDER BY total DESC
    LIMIT 8
  `).all();
  res.json(dados);
});

module.exports = router;
