"""
Regras fiscais e de formação de preço.

Custo Real       = Preço de Compra + IPI + Despesas DRI - Crédito de ICMS
Markup Divisor   = (100 - (DF% + DO% + L%)) / 100
Preço de Venda   = Custo Real / Markup Divisor
"""

ORIGENS_MERCADORIA = {
    0: "Nacional",
    1: "Estrangeira (Importação Direta)",
    2: "Estrangeira (Mercado Interno)",
}


def validar_cest(cest: str) -> bool:
    """CEST deve ter exatamente 7 dígitos numéricos."""
    return bool(cest) and cest.isdigit() and len(cest) == 7


def calcular_custo_real(preco_compra: float, ipi: float, despesas_dri: float, credito_icms: float) -> float:
    return round(preco_compra + ipi + despesas_dri - credito_icms, 2)


def calcular_markup_divisor(df_pct: float, do_pct: float, lucro_pct: float) -> float:
    soma = df_pct + do_pct + lucro_pct
    divisor = (100 - soma) / 100
    if divisor <= 0:
        raise ValueError("A soma de DF% + DO% + L% deve ser menor que 100%")
    return divisor


def calcular_preco_venda(
    preco_compra: float,
    ipi: float,
    despesas_dri: float,
    credito_icms: float,
    despesas_faturamento_pct: float,
    despesas_operacionais_pct: float,
    lucro_desejado_pct: float,
) -> dict:
    custo_real = calcular_custo_real(preco_compra, ipi, despesas_dri, credito_icms)
    markup_divisor = calcular_markup_divisor(
        despesas_faturamento_pct, despesas_operacionais_pct, lucro_desejado_pct
    )
    preco_venda = round(custo_real / markup_divisor, 2)
    return {
        "custo_real": custo_real,
        "markup_divisor": round(markup_divisor, 4),
        "preco_venda": preco_venda,
    }
