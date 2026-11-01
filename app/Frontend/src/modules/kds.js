/**
 * HERA CLOUD POS - Kitchen Display System (KDS) Module (ES6)
 * Pantalla táctil de comandas para Cocina y Barra con cronómetro en vivo,
 * alertas por demoras (>15m) y flujo de estados (PENDING -> IN_PREP -> READY -> SERVED).
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { showToast, playNotificationSound, escapeHtml } from '../utils.js';

let kdsTimerInterval = null;

export function setupKdsModule() {
  const filterButtons = document.querySelectorAll('.kds-filter-btn');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
      });
      btn.classList.add('active', 'bg-indigo-600', 'text-white');
      btn.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');

      state.activeKdsStation = btn.dataset.station || 'ALL';
      loadKdsOrders();
    });
  });

  // Iniciar cronómetro de KDS cada segundo
  if (kdsTimerInterval) clearInterval(kdsTimerInterval);
  kdsTimerInterval = setInterval(updateAllElapsedTimers, 1000);
}

export async function loadKdsOrders() {
  const station = state.activeKdsStation || 'ALL';
  try {
    const res = await apiFetch(`/api/orders/station?station=${station}`);
    if (res.ok) {
      state.kdsOrders = await res.json();
      renderKdsGrid();
      updateKdsPendingBadge();
      return;
    }
  } catch (_) {
    // Modo Offline
  }

  const db = initOfflineDb();
  state.kdsOrders = db.kdsOrders || [];
  renderKdsGrid();
  updateKdsPendingBadge();
}

function updateKdsPendingBadge() {
  const badge = document.getElementById('kds-pending-badge');
  if (!badge) return;

  const pendingCount = (state.kdsOrders || []).filter(o => o.status === 'PENDING' || o.status === 'IN_PREP' || o.status === 'IN_PREPARATION').length;
  badge.textContent = pendingCount;
  if (pendingCount > 0) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderKdsGrid() {
  const grid = document.getElementById('kds-orders-grid');
  if (!grid) return;

  const station = state.activeKdsStation || 'ALL';
  const orders = (state.kdsOrders || []).filter(o => {
    const matchStation = station === 'ALL' || o.station === station;
    const matchStatus = o.status !== 'SERVED' && o.status !== 'CANCELLED';
    return matchStation && matchStatus;
  });

  if (orders.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900">
        <div class="text-3xl mb-2">👨‍🍳</div>
        <div class="text-sm font-semibold">No hay comandas pendientes de preparación en este momento.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = orders.map(ord => {
    const isLate = getElapsedMinutes(ord.createdAt) >= 15;
    const isPrep = ord.status === 'IN_PREP' || ord.status === 'IN_PREPARATION';
    const stationBadge = ord.station === 'BAR'
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">🍸 BARRA</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">🍳 COCINA</span>';

    const statusBadge = isPrep
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 animate-pulse">En Cocción</span>'
      : (ord.status === 'READY'
        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">Listo</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">Nuevo</span>');

    const cardBorder = isLate
      ? 'border-2 border-red-500 shadow-md shadow-red-500/10'
      : (ord.status === 'READY' ? 'border-2 border-emerald-500' : 'border border-slate-200 dark:border-slate-800');

    // Botones según estado
    let actionButtons = '';
    if (ord.status === 'PENDING') {
      actionButtons = `
        <button type="button" class="btn-kds-action w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition active:scale-95 flex items-center justify-center gap-1.5" data-order-id="${ord.id}" data-next-status="IN_PREP">
          <span>👨‍🍳</span> <span>Iniciar Preparación</span>
        </button>
      `;
    } else if (isPrep) {
      actionButtons = `
        <button type="button" class="btn-kds-action w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition active:scale-95 flex items-center justify-center gap-1.5" data-order-id="${ord.id}" data-next-status="READY">
          <span>✅</span> <span>Marcar Listo</span>
        </button>
      `;
    } else if (ord.status === 'READY') {
      actionButtons = `
        <button type="button" class="btn-kds-action w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-black text-white font-bold text-xs shadow-sm transition active:scale-95 flex items-center justify-center gap-1.5" data-order-id="${ord.id}" data-next-status="SERVED">
          <span>🚀</span> <span>Despachar a Mesa</span>
        </button>
      `;
    }

    const resolvedTableNum = ord.tableNumber || (state.tables || []).find(t => t.id === ord.tableId)?.number || null;

    const itemsHtml = (ord.items || []).map(it => {
      const mods = it.modifiers ? `<div class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 pl-3">↳ ${escapeHtml(it.modifiers)}</div>` : '';
      const notes = it.notes ? `<div class="text-[10px] text-amber-600 dark:text-amber-400 italic pl-3">Nota: ${escapeHtml(it.notes)}</div>` : '';

      return `
        <div class="py-1 border-b border-slate-100 dark:border-slate-800/60 last:border-0 text-xs">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold text-slate-800 dark:text-slate-100 flex items-center justify-center flex-shrink-0 text-xs">
              ${it.quantity}
            </span>
            <span class="font-bold text-slate-900 dark:text-slate-100 flex-1 leading-snug">
              ${escapeHtml(it.productName || it.name)}
            </span>
          </div>
          ${mods}
          ${notes}
        </div>
      `;
    }).join('');

    return `
      <div class="p-4 sm:p-5 rounded-3xl bg-white dark:bg-slate-900 ${cardBorder} shadow-sm space-y-3 flex flex-col justify-between" id="kds-card-${ord.id}">
        <!-- Header del Ticket -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-base font-extrabold font-display text-slate-900 dark:text-white">
                ${resolvedTableNum ? `Mesa #${escapeHtml(String(resolvedTableNum))}` : '⚡ Mostrador'}
              </span>
              ${stationBadge}
            </div>
            ${statusBadge}
          </div>

          <!-- Cronómetro Dinámico -->
          <div class="flex items-center justify-between text-xs py-1 px-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
            <span class="text-slate-400 text-[11px]">Ticket #${ord.orderNumber || ord.id.slice(-4)}</span>
            <span class="font-mono font-bold kds-timer-text ${isLate ? 'text-red-500 font-extrabold animate-pulse' : 'text-slate-700 dark:text-slate-300'}" data-created-at="${ord.createdAt}">
              ${formatElapsed(ord.createdAt)}
            </span>
          </div>
        </div>

        <!-- Lista de Artículos -->
        <div class="space-y-1 py-1 max-h-56 overflow-y-auto pr-1">
          ${itemsHtml}
        </div>

        <!-- Acciones -->
        <div class="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
          ${actionButtons}
          <div class="flex justify-end">
            <button type="button" class="btn-kds-cancel text-[10px] text-slate-400 hover:text-red-500 font-medium" data-order-id="${ord.id}">
              Anular Comanda
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Eventos de botones
  grid.querySelectorAll('.btn-kds-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.orderId;
      const nextStatus = btn.dataset.nextStatus;
      await updateOrderStatus(orderId, nextStatus);
    });
  });

  grid.querySelectorAll('.btn-kds-cancel').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Deseas cancelar esta comanda?')) return;
      await updateOrderStatus(btn.dataset.orderId, 'CANCELLED');
    });
  });
}

async function updateOrderStatus(orderId, status) {
  const normalizedStatus = status === 'IN_PREPARATION' ? 'IN_PREP' : status;
  try {
    await apiFetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      body: { status: normalizedStatus }
    });
    playNotificationSound(normalizedStatus === 'READY' ? 'alert' : 'success');
  } catch (_) {}

  // Actualizar memoria local
  const ord = (state.kdsOrders || []).find(o => o.id === orderId);
  if (ord) ord.status = normalizedStatus;

  const db = initOfflineDb();
  const dbOrd = (db.kdsOrders || []).find(o => o.id === orderId);
  if (dbOrd) dbOrd.status = normalizedStatus;
  saveOfflineDb(db);

  showToast(`Comanda actualizada a: ${normalizedStatus}`, 'info');
  loadKdsOrders();
}

function getElapsedMinutes(createdAt) {
  if (!createdAt) return 0;
  const diffMs = Date.now() - new Date(createdAt).getTime();
  return Math.floor(diffMs / 60000);
}

function formatElapsed(createdAt) {
  if (!createdAt) return '00:00 min';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} min`;
}

function updateAllElapsedTimers() {
  document.querySelectorAll('.kds-timer-text').forEach(el => {
    const created = el.dataset.createdAt;
    if (created) {
      el.textContent = formatElapsed(created);
      const isLate = getElapsedMinutes(created) >= 15;
      if (isLate) {
        el.className = 'font-mono text-red-500 font-extrabold animate-pulse kds-timer-text';
      }
    }
  });
}
