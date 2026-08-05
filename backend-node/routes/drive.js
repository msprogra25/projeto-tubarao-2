const express = require('express');
const { google } = require('googleapis');
const db = require('../db');
const { autenticar } = require('../middleware/auth');

const router = express.Router();
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

/*
 * ---------------------------------------------------------------------
 * IMPORTANTE — leia antes de usar este módulo
 * ---------------------------------------------------------------------
 * Esta integração precisa de credenciais OAuth do Google Cloud que só
 * você pode gerar (não é possível fazer isso por você):
 *
 *   1. Crie um projeto em https://console.cloud.google.com
 *   2. Ative a "Google Drive API"
 *   3. Em "Credenciais", crie um "ID do cliente OAuth 2.0" do tipo
 *      "Aplicativo da Web"
 *   4. Adicione esta URL de redirecionamento autorizada:
 *      http://localhost:3000/api/drive/callback
 *      (troque pelo domínio real quando for para produção)
 *   5. Copie o Client ID e o Client Secret para o .env:
 *      GOOGLE_CLIENT_ID=...
 *      GOOGLE_CLIENT_SECRET=...
 *      GOOGLE_REDIRECT_URI=http://localhost:3000/api/drive/callback
 *
 * Sem essas variáveis configuradas, as rotas abaixo respondem com um
 * erro claro em vez de travar o servidor.
 */

function obterClienteOAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) return null;
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

function clienteConfigurado(req, res) {
  const oauth2Client = obterClienteOAuth();
  if (!oauth2Client) {
    res.status(503).json({
      erro: 'Integração com Google Drive não configurada. Defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI no .env (veja routes/drive.js para o passo a passo).',
    });
    return null;
  }
  return oauth2Client;
}

// GET /api/drive/status — a conta já está conectada?
router.get('/status', autenticar, (req, res) => {
  const integracao = db.prepare('SELECT * FROM integracoes WHERE id = 1').get();
  res.json({
    conectado: !!integracao?.google_drive_refresh_token,
    conectado_em: integracao?.google_drive_conectado_em || null,
    configurado: !!obterClienteOAuth(),
  });
});

// GET /api/drive/conectar — redireciona para a tela de consentimento do Google
router.get('/conectar', autenticar, (req, res) => {
  const oauth2Client = clienteConfigurado(req, res);
  if (!oauth2Client) return;

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // garante que o refresh_token venha mesmo em reconexões
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });
  res.redirect(url);
});

// GET /api/drive/callback — o Google volta pra cá com o código de autorização
router.get('/callback', async (req, res) => {
  const oauth2Client = clienteConfigurado(req, res);
  if (!oauth2Client) return;

  const { code } = req.query;
  if (!code) return res.status(400).send('Código de autorização ausente.');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    db.prepare(`
      UPDATE integracoes SET
        google_drive_access_token = ?,
        google_drive_refresh_token = COALESCE(?, google_drive_refresh_token),
        google_drive_expiry_date = ?,
        google_drive_conectado_em = datetime('now')
      WHERE id = 1
    `).run(tokens.access_token, tokens.refresh_token, tokens.expiry_date);

    res.send(`
      <html><body style="font-family:sans-serif; text-align:center; padding:3rem;">
        <h2>✅ Google Drive conectado!</h2>
        <p>Pode fechar esta aba e voltar para o sistema.</p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`Falha ao conectar: ${err.message}`);
  }
});

// DELETE /api/drive/desconectar
router.delete('/desconectar', autenticar, (req, res) => {
  db.prepare(`
    UPDATE integracoes SET google_drive_access_token = NULL, google_drive_refresh_token = NULL,
      google_drive_expiry_date = NULL, google_drive_conectado_em = NULL WHERE id = 1
  `).run();
  res.status(204).send();
});

async function obterClienteDriveAutenticado() {
  const oauth2Client = obterClienteOAuth();
  if (!oauth2Client) throw new Error('Integração com Google Drive não configurada.');

  const integracao = db.prepare('SELECT * FROM integracoes WHERE id = 1').get();
  if (!integracao?.google_drive_refresh_token) throw new Error('Google Drive não conectado ainda.');

  oauth2Client.setCredentials({
    access_token: integracao.google_drive_access_token,
    refresh_token: integracao.google_drive_refresh_token,
    expiry_date: integracao.google_drive_expiry_date,
  });

  // renova o token automaticamente se tiver expirado, e salva o novo
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      db.prepare('UPDATE integracoes SET google_drive_access_token = ?, google_drive_expiry_date = ? WHERE id = 1')
        .run(tokens.access_token, tokens.expiry_date);
    }
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function obterOuCriarPastaPdv(drive) {
  const integracao = db.prepare('SELECT * FROM integracoes WHERE id = 1').get();
  if (integracao?.google_drive_pasta_id) return integracao.google_drive_pasta_id;

  const resposta = await drive.files.create({
    requestBody: { name: 'PDV - Comprovantes e Fotos', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  db.prepare('UPDATE integracoes SET google_drive_pasta_id = ? WHERE id = 1').run(resposta.data.id);
  return resposta.data.id;
}

// POST /api/drive/enviar-venda/:id — envia o PDF de uma venda para o Drive
router.post('/enviar-venda/:id', autenticar, async (req, res) => {
  try {
    const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(req.params.id);
    if (!venda || !venda.pdf_path) return res.status(404).json({ erro: 'PDF da venda não encontrado' });

    const respPdf = await fetch(`${PYTHON_SERVICE_URL}${venda.pdf_path}`);
    if (!respPdf.ok) return res.status(502).json({ erro: 'Não foi possível baixar o PDF do serviço Python' });
    const bufferPdf = Buffer.from(await respPdf.arrayBuffer());

    const drive = await obterClienteDriveAutenticado();
    const pastaId = await obterOuCriarPastaPdv(drive);

    const { Readable } = require('stream');
    const resposta = await drive.files.create({
      requestBody: { name: `Venda_${venda.id}_${venda.criado_em.replace(/[: ]/g, '-')}.pdf`, parents: [pastaId] },
      media: { mimeType: 'application/pdf', body: Readable.from(bufferPdf) },
      fields: 'id, webViewLink',
    });

    res.json({ drive_url: resposta.data.webViewLink });
  } catch (err) {
    res.status(502).json({ erro: err.message });
  }
});

// POST /api/drive/enviar-foto-produto/:id — envia a foto/código de barras do
// produto para o Drive, com o título sendo o nome do produto
router.post('/enviar-foto-produto/:id', autenticar, async (req, res) => {
  try {
    const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(req.params.id);
    if (!produto || !produto.imagem) return res.status(404).json({ erro: 'Produto sem imagem cadastrada' });

    const path = require('path');
    const fs = require('fs');
    const caminhoLocal = path.join(__dirname, '..', produto.imagem.replace(/^\/uploads/, 'uploads'));
    if (!fs.existsSync(caminhoLocal)) return res.status(404).json({ erro: 'Arquivo de imagem não encontrado no servidor' });

    const drive = await obterClienteDriveAutenticado();
    const pastaId = await obterOuCriarPastaPdv(drive);
    const extensao = path.extname(caminhoLocal) || '.png';

    const resposta = await drive.files.create({
      requestBody: { name: `${produto.nome}${extensao}`, parents: [pastaId] },
      media: { mimeType: extensao === '.jpg' || extensao === '.jpeg' ? 'image/jpeg' : 'image/png', body: fs.createReadStream(caminhoLocal) },
      fields: 'id, webViewLink',
    });

    res.json({ drive_url: resposta.data.webViewLink });
  } catch (err) {
    res.status(502).json({ erro: err.message });
  }
});

module.exports = router;
