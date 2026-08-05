"""
Extração de dados de arquivos XML de NF-e (modelo padrão SEFAZ) para
atualização automática de estoque e financeiro.

Este parser cobre a estrutura básica de uma NF-e (tags <det>, <prod>,
<emit>). NF-es reais variam em detalhes de layout entre versões de
schema; para produção, valide contra o XSD oficial da SEFAZ.
"""
from lxml import etree

NS = {"nfe": "http://www.portalfiscal.inf.br/nfe"}


def processar_xml_nfe(caminho_arquivo: str) -> dict:
    tree = etree.parse(caminho_arquivo)
    root = tree.getroot()

    def buscar(el, xpath):
        r = el.find(xpath, NS)
        return r.text if r is not None else None

    emit = root.find(".//nfe:emit", NS)
    fornecedor = {
        "nome": buscar(emit, "nfe:xNome") if emit is not None else None,
        "cnpj": buscar(emit, "nfe:CNPJ") if emit is not None else None,
    }

    itens = []
    for det in root.findall(".//nfe:det", NS):
        prod = det.find("nfe:prod", NS)
        if prod is None:
            continue
        itens.append({
            "codigo_barras": buscar(prod, "nfe:cEAN") or buscar(prod, "nfe:cProd"),
            "nome": buscar(prod, "nfe:xProd"),
            "ncm": buscar(prod, "nfe:NCM"),
            "quantidade": float(buscar(prod, "nfe:qCom") or 0),
            "valor_unitario": float(buscar(prod, "nfe:vUnCom") or 0),
        })

    if not itens:
        raise ValueError("Nenhum item <det>/<prod> encontrado no XML. Verifique se é uma NF-e válida.")

    return {"fornecedor": fornecedor, "itens": itens}
