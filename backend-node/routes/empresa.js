const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { autenticar } = require('../middleware/auth');

const router = express.Router();
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

const uploadLogo = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads', 'logos'),
    filename: (req, file, cb) => cb(null, `logo_${Date.now()}${path.extname(file.originalname)}`)
  }),
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg'].includes(file.mimetype);
    cb(ok ? null : new Error('Apenas PNG ou JPG são permitidos'), ok);
  }
});

// multer em memória (não grava em disco) — usado para operações que só
// precisam repassar o arquivo adiante (remover fundo, gerar prévia de PDF)
const uploadMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg'].includes(file.mimetype);
    cb(ok ? null : new Error('Apenas PNG ou JPG são permitidos'), ok);
  }
});

// POST /api/empresa/remover-fundo-logo — envia a imagem ao serviço Python,
// que remove o fundo (deixa transparente) e devolve o PNG processado.
// Não salva nada ainda: o usuário confirma com "Salvar Alterações" depois.
router.post('/remover-fundo-logo', autenticar, uploadMemoria.single('imagem'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada' });

  try {
    const formParaPython = new FormData();
    formParaPython.append('arquivo', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

    const respPy = await fetch(`${PYTHON_SERVICE_URL}/imagem/remover-fundo`, {
      method: 'POST',
      body: formParaPython,
    });

    if (!respPy.ok) {
      const erro = await respPy.json().catch(() => ({}));
      return res.status(422).json({ erro: erro.detail || 'Falha ao remover o fundo da imagem' });
    }

    res.setHeader('Content-Type', 'image/png');
    const buffer = Buffer.from(await respPy.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ erro: 'Serviço de processamento de imagem indisponível', detalhe: err.message });
  }
});

// POST /api/empresa/pdf-exemplo — gera um PDF de amostra com o nome/logo
// que estão no formulário (ainda não salvos), para o usuário conferir o
// resultado antes de clicar em "Salvar Alterações".
router.post('/pdf-exemplo', autenticar, uploadMemoria.single('logo'), async (req, res) => {
  try {
    const nome = req.body.nome || 'Comprovante de Venda';
    const logoBase64 = req.file ? req.file.buffer.toString('base64') : null;

    const itensExemplo = [
      { nome: 'Produto de exemplo', quantidade: 2, valor_unitario: 16.46, subtotal: 32.92 },
      { nome: 'Outro produto', quantidade: 3, valor_unitario: 5.50, subtotal: 16.50 },
    ];

    const respPy = await fetch(`${PYTHON_SERVICE_URL}/pdf/gerar-venda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venda_id: 'exemplo',
        itens: itensExemplo,
        total: 49.42,
        empresa_nome: nome,
        logo_base64: logoBase64,
      }),
    });

    if (!respPy.ok) return res.status(502).json({ erro: 'Falha ao gerar PDF de exemplo' });
    const data = await respPy.json();
    res.json({ pdf_url: data.pdf_url.replace('/storage', '/api/storage') });
  } catch (err) {
    res.status(502).json({ erro: 'Serviço Python indisponível', detalhe: err.message });
  }
});

// GET /api/empresa
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM empresa WHERE id = 1').get());
});

// PUT /api/empresa — atualiza nome e/ou logo (reflete em cabeçalhos, PDFs e notas)
router.put('/', autenticar, uploadLogo.single('logo'), (req, res) => {
  const atual = db.prepare('SELECT * FROM empresa WHERE id = 1').get();
  const nome = req.body.nome || atual.nome;
  const logo_path = req.file ? `/uploads/logos/${req.file.filename}` : atual.logo_path;

  db.prepare('UPDATE empresa SET nome = ?, logo_path = ? WHERE id = 1').run(nome, logo_path);
  res.json({ nome, logo_path });
});

// GET /api/empresa/planilha — gera e retorna link da planilha de vendas (via serviço Python)
router.get('/relatorios/planilha', autenticar, async (req, res) => {
  try {
    const vendas = db.prepare(`
      SELECT vi.nome, vi.valor_unitario, vi.subtotal, vi.quantidade, v.criado_em
      FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id
      ORDER BY v.criado_em DESC
    `).all();

    const resp = await fetch(`${PYTHON_SERVICE_URL}/excel/gerar-relatorio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendas })
    });

    if (!resp.ok) return res.status(502).json({ erro: 'Falha ao gerar planilha' });
    const data = await resp.json();
    res.json(data); // { url: '/storage/excel/relatorio_xxx.xlsx', expira_em: ... }
  } catch (err) {
    res.status(502).json({ erro: 'Serviço Python indisponível', detalhe: err.message });
  }
});

module.exports = router;
