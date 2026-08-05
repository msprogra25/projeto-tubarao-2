// theme.js — injeção do menu lateral (usado em todas as páginas internas)
// Obs: o modo escuro/claro foi removido — o sistema usa um único tema
// (dourado sobre cinza escuro) fixo, sem alternância.

const ITENS_MENU = [
  { href: 'dashboard.html', icone: '🏠', label: 'Início' },
  { href: 'pdv.html', icone: '🛒', label: 'Efetuar Venda' },
  { href: 'estoque.html', icone: '📦', label: 'Registro de Estoque' },
  { href: 'nota-fiscal.html', icone: '🧾', label: 'Nota Fiscal / Tributação' },
  { href: 'fornecedores.html', icone: '🚚', label: 'Fornecedores' },
  { href: 'historico.html', icone: '📜', label: 'Histórico de Vendas' },
  { href: 'planilha.html', icone: '📊', label: 'Planilha de Vendas' },
  { href: 'conta.html', icone: '👤', label: 'Conta do Vendedor' },
  { href: 'config.html', icone: '⚙️', label: 'Configurações da Empresa' },
];

function montarMenuLateral() {
  const paginaAtual = location.pathname.split('/').pop();
  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay';
  overlay.onclick = fecharMenu;

  const nav = document.createElement('nav');
  nav.className = 'menu-lateral';
  nav.innerHTML = `
    <h3 style="margin-bottom:1.2rem;">Menu</h3>
    ${ITENS_MENU.map(i => `
      <a href="${i.href}" style="${i.href === paginaAtual ? 'background:var(--verde-100); font-weight:700;' : ''}">
        <span>${i.icone}</span> ${i.label}
      </a>`).join('')}
    <a href="#" onclick="sair(); return false;" style="margin-top:1rem; color:var(--vermelho);">
      <span>🚪</span> Sair
    </a>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(nav);
}

function abrirMenu() {
  document.querySelector('.menu-lateral')?.classList.add('aberto');
  document.querySelector('.menu-overlay')?.classList.add('aberto');
}
function fecharMenu() {
  document.querySelector('.menu-lateral')?.classList.remove('aberto');
  document.querySelector('.menu-overlay')?.classList.remove('aberto');
}
function sair() {
  localStorage.removeItem('pdv_token');
  location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', montarMenuLateral);
