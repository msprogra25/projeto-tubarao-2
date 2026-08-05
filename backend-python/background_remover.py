"""
Remoção de fundo de imagens, usado para "limpar" a logo da empresa antes de
salvá-la (remove fundos brancos/quadriculados/coloridos, deixando apenas o
elemento principal sobre fundo transparente).

Usa o modelo u2net via rembg (baixado uma única vez, na primeira chamada).
"""
import io
from PIL import Image

_sessao = None


def _obter_sessao():
    """Carrega o modelo sob demanda (evita atraso na inicialização do serviço)."""
    global _sessao
    if _sessao is None:
        from rembg import new_session
        _sessao = new_session("u2net")
    return _sessao


def remover_fundo(conteudo_imagem: bytes) -> bytes:
    from rembg import remove

    imagem = Image.open(io.BytesIO(conteudo_imagem)).convert("RGBA")
    resultado = remove(imagem, session=_obter_sessao())

    buffer_saida = io.BytesIO()
    resultado.save(buffer_saida, format="PNG")
    return buffer_saida.getvalue()
