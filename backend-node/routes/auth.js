const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { autenticar, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------
// Validação de senha forte — roda no BACKEND, não só no front-end, pois
// o front pode ser contornado por quem chama a API diretamente.
// Regra: mínimo 8 caracteres, 1 maiúscula, 1 minúscula, 1 número e 1
// caractere especial.
// ---------------------------------------------------------------------
function validarSenhaForte(senha) {
  if (!senha || senha.length < 8) {
    return 'A senha deve ter no mínimo 8 caracteres';
  }
  if (!/[A-Z]/.test(senha)) {
    return 'A senha deve ter ao menos uma letra maiúscula';
  }
  if (!/[a-z]/.test(senha)) {
    return 'A senha deve ter ao menos uma letra minúscula';
  }
  if (!/[0-9]/.test(senha)) {
    return 'A senha deve ter ao menos um número';
  }
  if (!/[^A-Za-z0-9]/.test(senha)) {
    return 'A senha deve ter ao menos um caractere especial (ex: ! @ # $ %)';
  }
  return null; // válida
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios' });
  }

  const vendedor = db.prepare('SELECT * FROM vendedores WHERE email = ?').get(email);
  if (!vendedor) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  const senhaOk = bcrypt.compareSync(senha, vendedor.senha_hash);
  if (!senhaOk) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  const token = jwt.sign(
    { id: vendedor.id, email: vendedor.email },
    JWT_SECRET,
    { expiresIn: '2h' } // sessão curta — reduz janela de uso indevido se o token vazar
  );

  res.json({ token, vendedor: { id: vendedor.id, email: vendedor.email } });
});

// POST /api/auth/registrar (cria a primeira conta / novas contas de vendedor)
router.post('/registrar', (req, res) => {
  const { email, senha, confirmar_senha, cnpj, endereco, cep, telefone } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios' });
  }
  const erroSenha = validarSenhaForte(senha);
  if (erroSenha) {
    return res.status(400).json({ erro: erroSenha });
  }
  if (confirmar_senha !== undefined && senha !== confirmar_senha) {
    return res.status(400).json({ erro: 'As senhas não coincidem' });
  }

  const existente = db.prepare('SELECT id FROM vendedores WHERE email = ?').get(email);
  if (existente) {
    return res.status(409).json({ erro: 'E-mail já cadastrado' });
  }

  const hash = bcrypt.hashSync(senha, 10);
  const info = db.prepare(
    'INSERT INTO vendedores (email, senha_hash, cnpj, endereco, cep, telefone) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(email, hash, cnpj || null, endereco || null, cep || null, telefone || null);
  res.status(201).json({ id: info.lastInsertRowid, email });
});

// GET /api/auth/contas — lista de contas cadastradas (módulo "Conta do Vendedor")
router.get('/contas', autenticar, (req, res) => {
  const contas = db.prepare('SELECT id, email, cnpj, endereco, cep, telefone, criado_em FROM vendedores').all();
  res.json(contas);
});

// PUT /api/auth/contas/:id — edita e-mail/senha/CNPJ/endereço/CEP/telefone
router.put('/contas/:id', autenticar, (req, res) => {
  const { email, senha, cnpj, endereco, cep, telefone } = req.body;
  const { id } = req.params;

  const conta = db.prepare('SELECT * FROM vendedores WHERE id = ?').get(id);
  if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });

  const novoEmail = email || conta.email;
  if (senha) {
    const erroSenha = validarSenhaForte(senha);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });
  }
  const novoHash = senha ? bcrypt.hashSync(senha, 10) : conta.senha_hash;
  const novoCnpj = cnpj !== undefined ? cnpj : conta.cnpj;
  const novoEndereco = endereco !== undefined ? endereco : conta.endereco;
  const novoCep = cep !== undefined ? cep : conta.cep;
  const novoTelefone = telefone !== undefined ? telefone : conta.telefone;

  db.prepare('UPDATE vendedores SET email = ?, senha_hash = ?, cnpj = ?, endereco = ?, cep = ?, telefone = ? WHERE id = ?')
    .run(novoEmail, novoHash, novoCnpj, novoEndereco, novoCep, novoTelefone, id);

  res.json({ id: Number(id), email: novoEmail, cnpj: novoCnpj, endereco: novoEndereco, cep: novoCep, telefone: novoTelefone });
});

// DELETE /api/auth/contas/:id — exclui conta
router.delete('/contas/:id', autenticar, (req, res) => {
  db.prepare('DELETE FROM vendedores WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
