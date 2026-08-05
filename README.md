# Sistema PDV — Gestão de Vendas e Estoque

Sistema completo de ponto de venda e automação comercial: PDV com leitura de
código de barras, formação de preço com regras fiscais, controle de estoque,
fornecedores/XML de NF-e, histórico de vendas, relatórios em Excel/PDF e
identidade visual customizável (logo + nome da empresa), com modo escuro.

## Arquitetura

```
pdv-system/
├── backend-node/       # API principal (Express): auth, produtos, vendas, fornecedores, empresa
│   ├── server.js
│   ├── db.js            # SQLite (WAL mode) — pronto para migrar para PostgreSQL
│   ├── middleware/auth.js
│   ├── routes/
│   │   ├── auth.js       # login, registro, contas de vendedor
│   │   ├── produtos.js   # CRUD + cálculo de preço (markup)
│   │   ├── vendas.js     # PDV, histórico, dashboard
│   │   ├── fornecedores.js
│   │   └── empresa.js    # logo/nome + planilha de vendas
│   └── uploads/          # imagens de produto e logo
├── backend-python/      # Serviço fiscal/documentos (FastAPI)
│   ├── main.py
│   ├── fiscal.py         # mesma regra de cálculo de preço, como microserviço
│   ├── pdf_generator.py  # comprovante de venda em PDF (reportlab)
│   ├── excel_generator.py# planilha de vendas (openpyxl)
│   ├── xml_processor.py  # leitura de XML de NF-e de fornecedor
│   ├── cleanup_job.py    # exclusão automática após 2 dias (APScheduler)
│   └── storage/          # pdf/, excel/, xml_uploads/
├── database/
│   └── schema.sql        # schema completo (SQLite)
└── frontend/             # HTML5 + CSS3 + JS puro, paleta verde/azul, dark mode
    ├── index.html         # login
    ├── dashboard.html      # tela inicial + gráfico financeiro
    ├── pdv.html             # Efetuar Venda (câmera de código de barras)
    ├── estoque.html         # Registro de Estoque
    ├── nota-fiscal.html     # Origem/CEST (referência e validador)
    ├── fornecedores.html    # cadastro + importação de XML
    ├── historico.html       # histórico de vendas
    ├── planilha.html        # gera relatório Excel
    ├── conta.html           # conta do vendedor
    ├── config.html          # logo/nome da empresa
    ├── css/style.css
    └── js/{api.js, theme.js}
```

## Como rodar localmente

Pré-requisitos: Node.js 18+, Python 3.10+.

**1) Serviço Python (fiscal, PDF, Excel, XML, limpeza automática)**
```bash
cd backend-python
pip install -r requirements.txt --break-system-packages   # ou use um virtualenv
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**2) API Node (backend principal + serve o frontend)**
```bash
cd backend-node
cp .env.example .env      # ajuste o JWT_SECRET
npm install
npm start
```

**3) Acesse**
```
http://localhost:3000/index.html
```

No primeiro acesso, clique em "Criar conta" na tela de login para cadastrar o
primeiro usuário (e-mail + senha). O banco SQLite (`backend-node/pdv.db`) é
criado automaticamente na primeira execução, com a tabela `empresa` já
populada com um registro padrão.

- **Logo com fundo removido**: em Configurações da Empresa, o botão "🪄 Remover
  fundo da logo" envia a imagem ao serviço Python, que usa o modelo `u2net`
  (via `rembg`) para apagar o fundo e devolver um PNG com transparência real.
  O botão "👁️ Visualizar PDF de exemplo" gera na hora um comprovante de
  amostra com o nome/logo que estão no formulário, **antes** de salvar —
  assim dá pra conferir como vai ficar no PDF de verdade.
  ⚠️ Na primeira chamada de remoção de fundo, o serviço Python baixa o
  modelo `u2net.onnx` (~176MB) do GitHub — isso leva alguns segundos a mais
  só na primeira vez; nas chamadas seguintes já fica em cache local.
- **Logo nos PDFs de venda**: a logo é lida do disco pelo Node e enviada em
  base64 para o serviço Python a cada PDF gerado (não um caminho de arquivo
  compartilhado) — assim funciona mesmo com os dois serviços rodando em
  hosts separados, como no Render.

## Regras de negócio já implementadas

- **Formação de preço**: `Custo Real = Preço de Compra + IPI + Desp. DRI − Crédito de ICMS`,
  `Markup Divisor = (100 − (DF% + DO% + L%)) / 100`, `Preço de Venda = Custo Real / Markup Divisor`.
  Implementado de forma idêntica em Node (`routes/produtos.js`) e Python (`fiscal.py`).
- **Estoque**: alerta de reposição quando quantidade ≤ estoque mínimo (padrão 10);
  aviso de teto quando atinge o estoque máximo.
- **CEST**: validação de exatamente 7 dígitos numéricos.
- **Origem da mercadoria**: 0 Nacional, 1 Estrangeira (Importação Direta), 2 Estrangeira (Mercado Interno).
- **Retenção de arquivos**: PDFs de venda e planilhas Excel expiram e são
  excluídos automaticamente após 2 dias (job do APScheduler, roda a cada 6h).
- **Identidade da empresa**: logo e nome atualizados em `config.html` refletem
  automaticamente no dashboard e podem ser usados nos PDFs gerados.

## Deploy no Render

O projeto **é compatível com o Render**, mas como são dois serviços (Node +
Python), suba como **dois Web Services separados** no mesmo projeto:

**Serviço 1 — API Node (público)**
- Root Directory: `backend-node`
- Build Command: `npm install`
- Start Command: `npm start`
- Variáveis de ambiente:
  - `JWT_SECRET` → um valor forte e aleatório
  - `PYTHON_SERVICE_URL` → a URL interna/pública do Serviço 2 no Render
    (ex: `https://pdv-python.onrender.com`)

**Serviço 2 — Serviço Python (pode ficar privado, só o Node precisa chamá-lo)**
- Root Directory: `backend-python`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

O frontend já foi ajustado para **nunca falar diretamente com o serviço
Python** — todo PDF/planilha passa por um proxy em `/api/storage/...` dentro
da própria API Node (ver `server.js`). Assim, só o Serviço 1 precisa de URL
pública; o Serviço 2 pode ficar acessível apenas internamente entre os
serviços do Render.

**⚠️ Ponto de atenção — armazenamento em disco:**
O Render usa **sistema de arquivos efêmero** por padrão nos planos
gratuito/starter: tudo que for salvo em disco (o arquivo `pdv.db` do SQLite,
os uploads de logo/produto, os PDFs e planilhas gerados) **é apagado a cada
deploy ou reinício do serviço**. Para persistir esses dados em produção,
duas opções:

1. **Mais simples**: adicionar um [Render Disk](https://render.com/docs/disks)
   (disco persistente pago) montado em `backend-node/` (para `pdv.db` e
   `uploads/`) e em `backend-python/storage/` (para PDFs/Excel).
2. **Mais robusto** (recomendado para produção real): migrar o banco para
   PostgreSQL gerenciado (o próprio Render oferece isso) e mover uploads/
   PDFs/Excel para um bucket S3-compatível (ex: Cloudflare R2, AWS S3).

Sem um desses ajustes, o sistema funciona normalmente enquanto o serviço
está no ar, mas os dados não sobrevivem a um redeploy.

## Migração para PostgreSQL (produção / +300 usuários simultâneos)

O projeto usa SQLite por padrão para rodar sem infraestrutura extra. Para
produção com alta concorrência real:

1. Troque `backend-node/db.js` por um pool de conexões `pg` (exemplo comentado
   no próprio arquivo).
2. Troque as chamadas síncronas `db.prepare(sql).get/all/run(...)` por
   `await pool.query(sql, params)` nas rotas — a lógica de negócio não muda.
3. Rode a API Node em cluster (`pm2 start server.js -i max`) atrás de um
   load balancer (Nginx).
4. Rode o serviço Python com múltiplos workers:
   `uvicorn main:app --workers 4`.
5. Mova uploads/PDF/Excel para armazenamento compartilhado (S3/GCS) se usar
   múltiplas instâncias, em vez de disco local.
6. Adicione monitoramento (logs estruturados, health checks, rate limiting
   já incluso via `express-rate-limit`).

Isso não foi testado sob carga real nesta entrega — depende do ambiente de
hospedagem escolhido — mas o código já está estruturado para essa migração
sem reescrever a lógica de negócio.

## Segurança

- Senhas com Bcrypt (10 rounds).
- Autenticação via JWT (expira em 12h).
- Helmet + rate limiting (300 req/min por IP) na API Node.
- Upload de imagens restrito a PNG/JPG, 5MB.

**Antes de ir para produção**: troque `JWT_SECRET` no `.env` por um valor
forte e aleatório, e sirva a aplicação atrás de HTTPS.
