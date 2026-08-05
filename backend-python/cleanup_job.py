"""
Exclusão automática de PDFs e planilhas Excel após o prazo de retenção,
conforme regra do sistema.

Roda como job agendado (APScheduler) dentro do próprio processo
FastAPI, verificando periodicamente a idade dos arquivos em
storage/pdf e storage/excel.
"""
import os
import time
import logging

logger = logging.getLogger("cleanup_job")

RETENCAO_PDF_SEGUNDOS = 2 * 24 * 60 * 60      # 2 dias
RETENCAO_EXCEL_SEGUNDOS = 3 * 24 * 60 * 60    # 3 dias

PASTAS_MONITORADAS = [
    (os.path.join(os.path.dirname(__file__), "storage", "pdf"), RETENCAO_PDF_SEGUNDOS),
    (os.path.join(os.path.dirname(__file__), "storage", "excel"), RETENCAO_EXCEL_SEGUNDOS),
]


def limpar_arquivos_expirados():
    agora = time.time()
    total_removidos = 0

    for pasta, retencao_segundos in PASTAS_MONITORADAS:
        if not os.path.isdir(pasta):
            continue
        for nome_arquivo in os.listdir(pasta):
            caminho = os.path.join(pasta, nome_arquivo)
            if not os.path.isfile(caminho):
                continue
            idade = agora - os.path.getmtime(caminho)
            if idade > retencao_segundos:
                try:
                    os.remove(caminho)
                    total_removidos += 1
                    logger.info(f"Arquivo expirado removido: {caminho}")
                except OSError as e:
                    logger.error(f"Falha ao remover {caminho}: {e}")

    if total_removidos:
        logger.info(f"Limpeza concluída: {total_removidos} arquivo(s) removido(s).")

    return total_removidos
