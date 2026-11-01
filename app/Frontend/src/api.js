/**
 * HERA CLOUD POS - API Client & SSE Event Stream (ES6)
 * Gestión de URL Base, peticiones seguras con JWT + TenantId,
 * eventos en tiempo real (SSE) y configuración de servidor API.
 */

import { state, setState } from './state.js';
import { showToast, openModal, closeModal } from './utils.js';

export const DEFAULT_PROD_API_URL = 'https://restaurante-bar-backend.onrender.com';

export function getApiBase() {
  let custom = null;
  try {
    custom = localStorage.getItem('comanda_api_url');
  } catch (_) {}

  if (custom && custom.trim()) {
    const trimmed = custom.trim().replace(/\/+$/, '');
    // Si estamos en un dominio en vivo (como vercel.app) y el valor apunta a localhost, descartarlo
    if (typeof window !== 'undefined' && window.location && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      if (trimmed.includes('localhost') || trimmed.includes('127.0.0.1')) {
        try { localStorage.removeItem('comanda_api_url'); } catch (_) {}
        return DEFAULT_PROD_API_URL;
      }
    }
    return trimmed;
  }
  if (typeof window !== 'undefined' && window.ENV_API_URL && typeof window.ENV_API_URL === 'string' && window.ENV_API_URL.trim()) {
    return window.ENV_API_URL.trim().replace(/\/+$/, '');
  }
  return (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    ? 'http://localhost:3001'
    : DEFAULT_PROD_API_URL;
}

export let API_BASE = getApiBase();

export function setApiBase(url) {
  if (!url || !url.trim()) {
    localStorage.removeItem('comanda_api_url');
  } else {
    localStorage.setItem('comanda_api_url', url.trim().replace(/\/+$/, ''));
  }
  API_BASE = getApiBase();
}

/**
 * Cliente HTTP unificado para el backend
 */
export async function apiFetch(path, options = {}) {
  const url = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

  const headers = new Headers(options.headers || {});

  // Adjuntar token JWT si existe en estado
  if (state.token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  // Adjuntar tenant activo si existe
  if (state.currentTenant && state.currentTenant.id && !headers.has('x-tenant-id')) {
    headers.set('x-tenant-id', state.currentTenant.id);
  }

  // Si hay body y no es FormData, fijar Content-Type JSON por defecto
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData) && !(options.body instanceof Blob)) {
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(options.body);
  }

  try {
    const res = await fetch(url, { ...options, headers });
    
    // Si la respuesta fue exitosa o respondió el backend con estado HTTP conocido
    updateServerStatusBadge(true);
    return res;
  } catch (err) {
    updateServerStatusBadge(false);
    throw err;
  }
}

/**
 * Actualiza el indicador visual de conexión del servidor
 */
export function updateServerStatusBadge(isOnline) {
  state.isBackendOnline = isOnline;

  const sseBadge = document.getElementById('sse-status-badge');
  const sseText = document.getElementById('sse-status-text');
  const loginBadge = document.getElementById('login-api-status-badge');

  if (sseBadge) {
    if (isOnline) {
      sseBadge.classList.remove('opacity-50', 'bg-red-50', 'text-red-700', 'border-red-200');
      sseBadge.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-200');
      if (sseText) sseText.textContent = 'En Línea';
    } else {
      sseBadge.classList.remove('bg-emerald-50', 'text-emerald-700', 'border-emerald-200');
      sseBadge.classList.add('opacity-75', 'bg-red-50', 'text-red-700', 'border-red-200');
      if (sseText) sseText.textContent = 'Modo Local';
    }
  }

  if (loginBadge) {
    const statusSpan = loginBadge.querySelector('span:last-child');
    if (statusSpan) {
      statusSpan.textContent = isOnline ? 'Listo' : 'Desconectado';
      statusSpan.className = isOnline
        ? 'font-mono text-emerald-600 dark:text-emerald-400 font-semibold'
        : 'font-mono text-amber-600 dark:text-amber-400 font-semibold';
    }
  }
}

/**
 * Conexión en Tiempo Real SSE (Server-Sent Events)
 */
export function initSSE(onEvent) {
  if (state.sseEventSource) {
    try {
      state.sseEventSource.close();
    } catch (_) {}
    state.sseEventSource = null;
  }

  const sseUrl = new URL(`${API_BASE}/api/events`);
  if (state.token) sseUrl.searchParams.set('token', state.token);
  if (state.currentTenant && state.currentTenant.id) sseUrl.searchParams.set('tenantId', state.currentTenant.id);

  try {
    const eventSource = new EventSource(sseUrl.toString());
    state.sseEventSource = eventSource;

    eventSource.onopen = () => {
      updateServerStatusBadge(true);
    };

    const sseEventTypes = ['ORDER_CREATED', 'ORDER_STATUS_CHANGED', 'TABLE_STATUS_CHANGED', 'STOCK_ALERT', 'SALE_COMPLETED', 'SALE_CANCELLED', 'PRODUCT_STOCK_UPDATED', 'TENANT_UPDATED'];
    sseEventTypes.forEach(eventType => {
      eventSource.addEventListener(eventType, (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (typeof onEvent === 'function') {
            onEvent({
              type: eventType,
              tenantId: payload?.tenantId || (eventType === 'TENANT_UPDATED' ? payload?.id : null),
              data: payload
            });
          }
        } catch (err) {
          console.warn(`Error parseando evento SSE ${eventType}:`, err);
        }
      });
    });

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (typeof onEvent === 'function') {
          onEvent(data);
        }
      } catch (err) {
        console.warn('Error parseando evento SSE:', err);
      }
    };

    eventSource.onerror = () => {
      updateServerStatusBadge(false);
      try {
        eventSource.close();
      } catch (_) {}
      state.sseEventSource = null;
      // Reintentar reconexión en 8 segundos
      setTimeout(() => {
        if (!state.sseEventSource) {
          initSSE(onEvent);
        }
      }, 8000);
    };
  } catch (err) {
    updateServerStatusBadge(false);
  }
}

/**
 * Configuración del Modal de URL de Backend
 */
export function setupBackendConfigModal(onConfigChange) {
  const modal = document.getElementById('modal-backend-config');
  const input = document.getElementById('backend-url-input');
  const display = document.getElementById('backend-current-url-display');
  const btnSave = document.getElementById('btn-save-backend-url');
  const btnReset = document.getElementById('btn-reset-backend-url');
  const form = document.getElementById('form-backend-config');

  const configButtons = [
    document.getElementById('btn-backend-config'),
    document.getElementById('btn-login-backend-config'),
    document.getElementById('btn-ceo-backend-config')
  ];

  function openConfig() {
    if (input) input.value = API_BASE;
    if (display) display.textContent = API_BASE;
    openModal('modal-backend-config');
  }

  configButtons.forEach(btn => {
    if (btn) btn.addEventListener('click', openConfig);
  });

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save();
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', (e) => {
      e.preventDefault();
      save();
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      localStorage.removeItem('comanda_api_url');
      API_BASE = getApiBase();
      if (input) input.value = API_BASE;
      if (display) display.textContent = API_BASE;
      showToast('URL restablecida por defecto', 'info');
      closeModal('modal-backend-config');
      if (typeof onConfigChange === 'function') onConfigChange(API_BASE);
    });
  }

  function save() {
    if (!input) return;
    const val = input.value.trim();
    if (!val) {
      localStorage.removeItem('comanda_api_url');
    } else {
      localStorage.setItem('comanda_api_url', val.replace(/\/+$/, ''));
    }
    API_BASE = getApiBase();
    if (display) display.textContent = API_BASE;
    closeModal('modal-backend-config');
    showToast(`Conectando a: ${API_BASE}`, 'success');
    if (typeof onConfigChange === 'function') onConfigChange(API_BASE);
  }
}
