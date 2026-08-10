require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const produtosRoutes = require('./routes/produtos');
const vendasRoutes = require('./routes/vendas');
const fornecedoresRoutes = require('./routes/fornecedores');
const empresaRoutes = require('./routes/empresa');
const driveRoutes = require('./routes/drive');

const app = express();
const PORT = process.env.PORT || 3000;

// Segurança e performance básicas.
// OBS: o frontend usa <script> inline em todas as páginas (sem build step),
// então o CSP padrão do Helmet (que bloqueia scripts inline) precisa ser
// ajustado — do contrário, NENHUM JavaScript da aplicação executa no
// navegador (login, busca, carrinho, gráfico etc. ficam mudos).
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'https:', 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(compression()); // reduz payload, importante sob carga
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting: protege contra abuso e picos, mantendo headroom para
// os 300+ usuários simultâneos legítimos.
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Arquivos estáticos (imagens de produto, logos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Frontend estático (servido pelo mesmo processo em modo simples;
// em produção recomenda-se servir via Nginx/CDN)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/produtos', produtosRoutes);
app.use('/api/vendas', vendasRoutes);
app.use('/api/fornecedores', fornecedoresRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/drive', driveRoutes);

app.get('/', (req, res) => {
  res.status(200).json({ mensagem: 'API do PDV está online e funcionando!' });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Proxy para arquivos gerados pelo serviço Python (PDF/Excel). O frontend
// nunca precisa conhecer a URL real do serviço Python — apenas chama esta
// rota relativa, o que funciona tanto em localhost quanto em produção
// (ex: Render), onde os dois serviços têm URLs públicas diferentes.
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
app.get('/api/storage/:tipo/:filename', async (req, res) => {
  const { tipo, filename } = req.params;
  if (!['pdf', 'excel'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido' });

  try {
    const respPy = await fetch(`${PYTHON_SERVICE_URL}/storage/${tipo}/${filename}`);
    if (!respPy.ok) return res.status(respPy.status).json({ erro: 'Arquivo não encontrado ou expirado' });

    res.setHeader('Content-Type', respPy.headers.get('content-type') || 'application/octet-stream');
    const buffer = Buffer.from(await respPy.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ erro: 'Serviço de documentos indisponível' });
  }
});

// Tratamento de erro genérico
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ erro: err.message || 'Erro interno do servidor' });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ API PDV rodando em http://localhost:${PORT}`);
    console.log(`   Frontend: http://localhost:${PORT}/index.html`);
  });
}

module.exports = app;

/*
 * ---------------------------------------------------------------
 * ESCALANDO PARA +300 USUÁRIOS SIMULTÂNEOS
 * ---------------------------------------------------------------
 * Este server.js roda em um único processo Node. Para produção:
 *
 * 1) Cluster: use o módulo `cluster` nativo ou PM2
 *    (`pm2 start server.js -i max`) para usar todos os núcleos de CPU.
 * 2) Load balancer (Nginx) na frente de várias instâncias.
 * 3) Banco: migrar de SQLite para PostgreSQL com pool de conexões
 *    (ver db.js) — SQLite serializa escritas e não escala bem
 *    para muitas escritas concorrentes.
 * 4) Sessão/token: JWT já é stateless, então múltiplas instâncias
 *    não precisam de sticky sessions.
 * 5) Uploads/PDF/Excel: mover para armazenamento compartilhado
 *    (S3, GCS) se rodar múltiplas instâncias, em vez de disco local.
 */
