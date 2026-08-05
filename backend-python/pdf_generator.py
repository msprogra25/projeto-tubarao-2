"""Geração do PDF de comprovante/nota de venda usando reportlab."""
import os
import io
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.utils import ImageReader

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage", "pdf")
os.makedirs(STORAGE_DIR, exist_ok=True)

VERDE = colors.HexColor("#1DB954")
AZUL = colors.HexColor("#1565C0")
CINZA_TEXTO = colors.HexColor("#4c635a")

ORIGENS = {0: "Nacional", 1: "Estrangeira (Imp. Direta)", 2: "Estrangeira (Merc. Interno)"}
FORMAS_PAGAMENTO = {
    "dinheiro": "Dinheiro",
    "pix": "PIX",
    "cartao_credito": "Cartão de Crédito",
    "cartao_debito": "Cartão de Débito",
}


def gerar_pdf_venda(venda_id, itens: list, total: float, empresa_nome: str, logo_bytes: bytes | None = None, forma_pagamento: str | None = None, valor_recebido: float | None = None, troco: float | None = None, vendedor_cnpj: str | None = None, vendedor_endereco: str | None = None, vendedor_cep: str | None = None, vendedor_telefone: str | None = None) -> tuple[str, str]:
    """
    logo_bytes: conteúdo binário da imagem (PNG/JPG), já em memória — não um
    caminho de disco. Isso permite que o serviço Python gere o PDF mesmo
    quando roda como processo/host separado do backend Node (ex: no Render).
    """
    filename = f"venda_{venda_id}_{int(datetime.now().timestamp())}.pdf"
    filepath = os.path.join(STORAGE_DIR, filename)

    doc = SimpleDocTemplate(filepath, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm)
    styles = getSampleStyleSheet()
    titulo_style = ParagraphStyle("Titulo", parent=styles["Heading1"], textColor=AZUL)
    aviso_style = ParagraphStyle("Aviso", parent=styles["Normal"], fontSize=8, textColor=CINZA_TEXTO, leading=11)
    elementos = []

    if logo_bytes:
        buffer_logo = io.BytesIO(logo_bytes)
        largura_original, altura_original = ImageReader(buffer_logo).getSize()
        altura_alvo = 2.6 * cm
        largura_alvo = altura_alvo * (largura_original / altura_original)
        largura_maxima = 6 * cm
        if largura_alvo > largura_maxima:
            largura_alvo = largura_maxima
            altura_alvo = largura_alvo * (altura_original / largura_original)
        buffer_logo.seek(0)
        elementos.append(Image(buffer_logo, width=largura_alvo, height=altura_alvo))

    elementos.append(Paragraph(empresa_nome or "Comprovante de Venda", titulo_style))
    elementos.append(Paragraph(f"Venda #{venda_id} — {datetime.now().strftime('%d/%m/%Y %H:%M')}", styles["Normal"]))
    if forma_pagamento:
        nome_forma = FORMAS_PAGAMENTO.get(forma_pagamento, forma_pagamento)
        elementos.append(Paragraph(f"<b>Forma de pagamento:</b> {nome_forma}", styles["Normal"]))
    if valor_recebido is not None:
        elementos.append(Paragraph(f"<b>Valor pago:</b> R$ {valor_recebido:.2f}", styles["Normal"]))
    if troco is not None:
        elementos.append(Paragraph(f"<b>Troco:</b> R$ {troco:.2f}", styles["Normal"]))

    dados_vendedor = []
    if vendedor_cnpj:
        dados_vendedor.append(f"CNPJ: {vendedor_cnpj}")
    if vendedor_endereco:
        endereco_completo = vendedor_endereco
        if vendedor_cep:
            endereco_completo += f" — CEP {vendedor_cep}"
        dados_vendedor.append(endereco_completo)
    if vendedor_telefone:
        dados_vendedor.append(f"Tel: {vendedor_telefone}")
    if dados_vendedor:
        elementos.append(Paragraph(" | ".join(dados_vendedor), aviso_style))

    elementos.append(Spacer(1, 0.5 * cm))

    dados_tabela = [["Produto", "Qtd", "Valor Unit.", "Subtotal"]]
    for item in itens:
        dados_tabela.append([
            item["nome"],
            str(item["quantidade"]),
            f"R$ {item['valor_unitario']:.2f}",
            f"R$ {item['subtotal']:.2f}",
        ])
    dados_tabela.append(["", "", "TOTAL", f"R$ {total:.2f}"])

    tabela = Table(dados_tabela, colWidths=[8 * cm, 2 * cm, 3.5 * cm, 3.5 * cm])
    tabela.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), VERDE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("LINEBELOW", (0, 0), (-1, 0), 1, colors.grey),
        ("LINEABOVE", (0, -1), (-1, -1), 1, colors.grey),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F2F7F5")]),
    ]))
    elementos.append(tabela)

    # ---- Dados fiscais por item (NCM / CEST / Origem), quando disponíveis ----
    itens_com_fiscal = [i for i in itens if i.get("ncm") or i.get("cest")]
    if itens_com_fiscal:
        elementos.append(Spacer(1, 0.6 * cm))
        elementos.append(Paragraph("Dados fiscais dos itens", ParagraphStyle(
            "SubTitulo", parent=styles["Heading3"], textColor=AZUL, fontSize=11
        )))
        dados_fiscais = [["Produto", "NCM", "CEST", "Origem"]]
        for item in itens_com_fiscal:
            dados_fiscais.append([
                item["nome"],
                item.get("ncm") or "—",
                item.get("cest") or "—",
                ORIGENS.get(item.get("origem"), "—"),
            ])
        tabela_fiscal = Table(dados_fiscais, colWidths=[6 * cm, 3 * cm, 2.5 * cm, 5 * cm])
        tabela_fiscal.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), AZUL),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#EEF4F5")]),
        ]))
        elementos.append(tabela_fiscal)

    # ---- Aviso legal: este é um comprovante interno, não uma NF-e/NFC-e ----
    elementos.append(Spacer(1, 0.8 * cm))
    elementos.append(Paragraph(
        "Este documento é um <b>comprovante interno de venda</b> gerado pelo sistema PDV e "
        "não substitui a Nota Fiscal Eletrônica (NF-e/NFC-e) exigida pela legislação fiscal "
        "brasileira. A emissão de nota fiscal válida requer certificado digital e integração "
        "com um provedor homologado pela SEFAZ.",
        aviso_style
    ))

    doc.build(elementos)
    return filepath, filename


def gerar_pdf_produtos_fornecedor(fornecedor_nome: str, fornecedor_cnpj: str, produtos: list) -> tuple[str, str]:
    filename = f"produtos_fornecedor_{int(datetime.now().timestamp())}.pdf"
    filepath = os.path.join(STORAGE_DIR, filename)

    doc = SimpleDocTemplate(filepath, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm)
    styles = getSampleStyleSheet()
    titulo_style = ParagraphStyle("Titulo", parent=styles["Heading1"], textColor=AZUL)
    elementos = []

    elementos.append(Paragraph(fornecedor_nome, titulo_style))
    elementos.append(Paragraph(f"CNPJ: {fornecedor_cnpj}", styles["Normal"]))
    elementos.append(Paragraph(f"Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}", styles["Normal"]))
    elementos.append(Spacer(1, 0.5 * cm))

    if not produtos:
        elementos.append(Paragraph("Nenhum produto vinculado a este fornecedor ainda.", styles["Normal"]))
    else:
        dados_tabela = [["Produto", "Código", "Estoque", "Preço Compra", "Preço Venda"]]
        for p in produtos:
            dados_tabela.append([
                p["nome"],
                p.get("codigo_barras") or "—",
                str(p["quantidade"]),
                f"R$ {p['preco_compra']:.2f}",
                f"R$ {p['preco_venda']:.2f}",
            ])
        tabela = Table(dados_tabela, colWidths=[5.5 * cm, 3.5 * cm, 2 * cm, 3 * cm, 3 * cm])
        tabela.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), AZUL),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F7F5")]),
        ]))
        elementos.append(tabela)

    doc.build(elementos)
    return filepath, filename
