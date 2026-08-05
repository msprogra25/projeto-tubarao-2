// api.js — camada de acesso à API, compartilhada por todas as páginas
const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('pdv_token');
}

function exigirLogin() {
  if (!getToken() && !location.pathname.endsWith('index.html') && location.pathname !== '/') {
    location.href = 'index.html';
  }
}

async function api(caminho, { method = 'GET', body, isFormData = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData && body) headers['Content-Type'] = 'application/json';

  const resp = await fetch(`${API_BASE}${caminho}`, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
  });

  if (resp.status === 401) {
    localStorage.removeItem('pdv_token');
    location.href = 'index.html';
    return;
  }

  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await resp.json().catch(() => ({})) : null;

  if (!resp.ok) {
    throw new Error((data && data.erro) || `Erro ${resp.status}`);
  }
  return data;
}

function mostrarToast(mensagem, tipo = 'ok') {
  let toast = document.getElementById('toast-global');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-global';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = mensagem;
  toast.className = `toast mostrar ${tipo === 'erro' ? 'erro' : ''}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('mostrar'), 3200);
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR');
}
