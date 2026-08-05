import os
import io
import base64
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler

from fiscal import calcular_preco_venda, validar_cest, ORIGENS_MERCADORIA
from pdf_generator import gerar_pdf_venda, gerar_pdf_produtos_fornecedor
from excel_generator import gerar_planilha_vendas
from xml_processor import processar_xml_nfe
from cleanup_job import limpar_arquivos_expirados
from background_remover import remover_fundo

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pdv-python-service")

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Roda a limpeza a cada 6h e uma vez no início
    scheduler.add_job(limpar_arquivos_expirados, "interval", hours=6, id="cleanup")
    scheduler.start()
    limpar_arquivos_expirados()
    logger.info("Serviço Python iniciado. Job de limpeza agendado a cada 6h.")
    yield
    scheduler.shutdown()


app = FastAPI(title="PDV - Serviço Fiscal/Documentos", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")


# ---------------------------------------------------------------
# Modelos de request
# ---------------------------------------------------------------
class CalculoFiscalRequest(BaseModel):
    preco_compra: float
    ipi: float = 0
    despesas_dri: float = 0
    credito_icms: float = 0
    despesas_faturamento_pct: float = 0
    despesas_operacionais_pct: float = 0
    lucro_desejado_pct: float = 0


class ItemVenda(BaseModel):
    nome: str
    quantidade: float
    valor_unitario: float
    subtotal: float
    ncm: str | None = None
    cest: str | None = None
    origem: int | None = None


class PdfVendaRequest(BaseModel):
    venda_id: int | str
    itens: list[ItemVenda]
    total: float
    empresa_nome: str = "Comprovante de Venda"
    logo_base64: str | None = None  # imagem já processada (PNG/JPG), sem cabeçalho data:URI
    forma_pagamento: str | None = None
    valor_recebido: float | None = None
    troco: float | None = None
    vendedor_cnpj: str | None = None
    vendedor_endereco: str | None = None
    vendedor_cep: str | None = None
    vendedor_telefone: str | None = None


class VendaExcel(BaseModel):
    nome: str
    valor_unitario: float
    quantidade: float
    subtotal: float
    criado_em: str


class ExcelRequest(BaseModel):
    vendas: list[VendaExcel]


class XmlRequest(BaseModel):
    caminho_arquivo: str


class CestRequest(BaseModel):
    cest: str


# ---------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/fiscal/calcular")
def calcular(req: CalculoFiscalRequest):
    try:
        return calcular_preco_venda(**req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/fiscal/validar-cest")
def validar_cest_endpoint(req: CestRequest):
    return {"valido": validar_cest(req.cest)}


@app.get("/fiscal/origens")
def origens():
    return ORIGENS_MERCADORIA


@app.post("/pdf/gerar-venda")
def gerar_pdf(req: PdfVendaRequest):
    logo_bytes = base64.b64decode(req.logo_base64) if req.logo_base64 else None
    filepath, filename = gerar_pdf_venda(
        venda_id=req.venda_id,
        itens=[i.model_dump() for i in req.itens],
        total=req.total,
        empresa_nome=req.empresa_nome,
        logo_bytes=logo_bytes,
        forma_pagamento=req.forma_pagamento,
        valor_recebido=req.valor_recebido,
        troco=req.troco,
        vendedor_cnpj=req.vendedor_cnpj,
        vendedor_endereco=req.vendedor_endereco,
        vendedor_cep=req.vendedor_cep,
        vendedor_telefone=req.vendedor_telefone,
    )
    return {"pdf_url": f"/storage/pdf/{filename}", "expira_em_dias": 2}


class ProdutoFornecedor(BaseModel):
    nome: str
    codigo_barras: str | None = None
    quantidade: float
    preco_compra: float
    preco_venda: float


class PdfFornecedorRequest(BaseModel):
    fornecedor_nome: str
    fornecedor_cnpj: str
    produtos: list[ProdutoFornecedor]


@app.post("/pdf/gerar-produtos-fornecedor")
def gerar_pdf_fornecedor(req: PdfFornecedorRequest):
    filepath, filename = gerar_pdf_produtos_fornecedor(
        fornecedor_nome=req.fornecedor_nome,
        fornecedor_cnpj=req.fornecedor_cnpj,
        produtos=[p.model_dump() for p in req.produtos],
    )
    return {"pdf_url": f"/storage/pdf/{filename}"}


@app.post("/imagem/remover-fundo")
async def remover_fundo_endpoint(arquivo: UploadFile = File(...)):
    conteudo = await arquivo.read()
    try:
        resultado = remover_fundo(conteudo)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Não foi possível processar a imagem: {e}")
    return StreamingResponse(io.BytesIO(resultado), media_type="image/png")


@app.post("/excel/gerar-relatorio")
def gerar_excel(req: ExcelRequest):
    filepath, filename = gerar_planilha_vendas([v.model_dump() for v in req.vendas])
    return {"url": f"/storage/excel/{filename}", "expira_em_dias": 3}


@app.post("/xml/processar")
def processar_xml(req: XmlRequest):
    if not os.path.exists(req.caminho_arquivo):
        raise HTTPException(status_code=404, detail="Arquivo XML não encontrado")
    try:
        resultado = processar_xml_nfe(req.caminho_arquivo)
        return resultado
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao processar XML: {e}")


@app.post("/manutencao/limpar-agora")
def limpar_agora():
    removidos = limpar_arquivos_expirados()
    return {"arquivos_removidos": removidos}


# Executar com: uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
