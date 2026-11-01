/**
 * GHANIMA CLOUD POS - Tables Management Module (ES6)
 * Plano táctil de mesas por zonas, transiciones de estado ACID,
 * apertura de comensales/sesión y CRUD completo.
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { showToast, openModal, closeModal, escapeHtml } from '../utils.js';

export function setupTablesModule({ onNavigateToPos, onNavigateToBilling }) {
  const btnNewTable = document.getElementById('btn-new-table');
  const zoneButtons = document.querySelectorAll('.zone-btn');
  const formTable = document.getElementById('form-table-manage');
  const btnConfirmOpen = document.getElementById('btn-confirm-open-table');

  if (btnNewTable) {
    btnNewTable.addEventListener('click', () => openNewTableModal());
  }

  zoneButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      zoneButtons.forEach(b => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
      });
      btn.classList.add('active', 'bg-indigo-600', 'text-white');
      btn.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');

      state.activeZone = btn.dataset.zone || 'ALL';
      renderTablesGrid({ onNavigateToPos, onNavigateToBilling });
    });
  });

  if (formTable) {
    formTable.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSaveTableForm();
    });
  }

  if (btnConfirmOpen) {
    btnConfirmOpen.addEventListener('click', () => handleConfirmOpenTable());
  }
}

export async function loadTables({ onNavigateToPos, onNavigateToBilling } = {}) {
  try {
    const res = await apiFetch('/api/tables');
    if (res.ok) {
      state.tables = await res.json();
      renderTablesGrid({ onNavigateToPos, onNavigateToBilling });
      return;
    }
  } catch (_) {
    // Modo Offline
  }

  const db = initOfflineDb();
  state.tables = db.tables || [];
  renderTablesGrid({ onNavigateToPos, onNavigateToBilling });
}

export function renderTablesGrid({ onNavigateToPos, onNavigateToBilling } = {}) {
  const grid = document.getElementById('tables-grid');
  if (!grid) return;

  const currentZone = state.activeZone || 'ALL';
  const tables = (state.tables || []).filter(t => currentZone === 'ALL' || t.zone === currentZone);

  if (tables.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900">
        No hay mesas registradas en esta zona.
      </div>
    `;
    return;
  }

  grid.innerHTML = tables.map(t => {
    const statusConfig = {
      AVAILABLE: {
        badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
        cardBorder: 'border-slate-200 dark:border-slate-800 hover:border-emerald-500',
        statusLabel: 'Disponible',
        dotColor: 'bg-emerald-500'
      },
      OCCUPIED: {
        badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300 dark:border-rose-800',
        cardBorder: 'border-rose-200 dark:border-rose-900/60 hover:border-rose-500',
        statusLabel: 'Ocupada',
        dotColor: 'bg-rose-500'
      },
      PAYING: {
        badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800',
        cardBorder: 'border-amber-200 dark:border-amber-900/60 hover:border-amber-500',
        statusLabel: 'En Cobro',
        dotColor: 'bg-amber-500'
      },
      RESERVED: {
        badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300 dark:border-purple-800',
        cardBorder: 'border-purple-200 dark:border-purple-900/60 hover:border-purple-500',
        statusLabel: 'Reservada',
        dotColor: 'bg-purple-500'
      },
      CLEANING: {
        badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-800',
        cardBorder: 'border-blue-200 dark:border-blue-900/60 hover:border-blue-500',
        statusLabel: 'Limpieza',
        dotColor: 'bg-blue-500'
      }
    };

    const conf = statusConfig[t.status] || statusConfig.AVAILABLE;

    let actionButtonsHtml = '';
    if (t.status === 'AVAILABLE') {
      actionButtonsHtml = `
        <button type="button" class="btn-open-table w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition active:scale-95" data-table-id="${t.id}" data-table-number="${t.number}">
          Abrir Mesa
        </button>
      `;
    } else if (t.status === 'OCCUPIED') {
      actionButtonsHtml = `
        <div class="grid grid-cols-2 gap-2 w-full">
          <button type="button" class="btn-go-pos py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition active:scale-95" data-table-id="${t.id}">
            📝 Comanda
          </button>
          <button type="button" class="btn-go-billing py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm transition active:scale-95" data-table-id="${t.id}">
            🧾 Facturar
          </button>
        </div>
      `;
    } else if (t.status === 'PAYING') {
      actionButtonsHtml = `
        <button type="button" class="btn-go-billing w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm transition active:scale-95" data-table-id="${t.id}">
          🧾 Cobrar Mesa
        </button>
      `;
    } else if (t.status === 'CLEANING') {
      actionButtonsHtml = `
        <button type="button" class="btn-mark-available w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm transition active:scale-95" data-table-id="${t.id}">
          ✅ Marcar Lista
        </button>
      `;
    } else {
      actionButtonsHtml = `
        <button type="button" class="btn-open-table w-full py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-sm transition active:scale-95" data-table-id="${t.id}" data-table-number="${t.number}">
          Activar Reserva
        </button>
      `;
    }

    return `
      <div class="p-5 rounded-3xl bg-white dark:bg-slate-900 border ${conf.cardBorder} shadow-sm space-y-3 flex flex-col justify-between hover:shadow-md transition">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="w-2.5 h-2.5 rounded-full ${conf.dotColor} animate-pulse"></span>
            <div class="flex items-center gap-1">
              <button type="button" class="btn-edit-tbl p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs rounded-lg" data-table-id="${t.id}" title="Editar">
                ✏️
              </button>
              <button type="button" class="btn-del-tbl p-1 text-slate-400 hover:text-red-600 text-xs rounded-lg" data-table-id="${t.id}" title="Eliminar">
                🗑️
              </button>
            </div>
          </div>

          <div class="text-center space-y-1">
            <div class="text-3xl font-extrabold font-display text-slate-900 dark:text-white">
              #${escapeHtml(String(t.number))}
            </div>
            <div class="text-xs font-semibold text-slate-500 dark:text-slate-400">
              ${escapeHtml(t.zone || 'Salón')} &middot; ${t.capacity || 4} pers
            </div>
            <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${conf.badgeClass}">
              ${conf.statusLabel}
            </span>
          </div>
        </div>

        <div class="pt-2 border-t border-slate-100 dark:border-slate-800">
          ${actionButtonsHtml}
        </div>
      </div>
    `;
  }).join('');

  // Vincular eventos de botones
  grid.querySelectorAll('.btn-open-table').forEach(btn => {
    btn.addEventListener('click', () => {
      openOpenTableModal(btn.dataset.tableId, btn.dataset.tableNumber);
    });
  });

  grid.querySelectorAll('.btn-mark-available').forEach(btn => {
    btn.addEventListener('click', async () => {
      await updateTableStatus(btn.dataset.tableId, 'AVAILABLE', null);
      loadTables({ onNavigateToPos, onNavigateToBilling });
    });
  });

  grid.querySelectorAll('.btn-go-pos').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedTableId = btn.dataset.tableId;
      if (typeof onNavigateToPos === 'function') {
        onNavigateToPos(btn.dataset.tableId);
      }
    });
  });

  grid.querySelectorAll('.btn-go-billing').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedTableId = btn.dataset.tableId;
      if (typeof onNavigateToBilling === 'function') {
        onNavigateToBilling(btn.dataset.tableId);
      }
    });
  });

  grid.querySelectorAll('.btn-edit-tbl').forEach(btn => {
    btn.addEventListener('click', () => {
      const table = (state.tables || []).find(x => x.id === btn.dataset.tableId);
      if (table) openEditTableModal(table);
    });
  });

  grid.querySelectorAll('.btn-del-tbl').forEach(btn => {
    btn.addEventListener('click', () => {
      handleDeleteTable(btn.dataset.tableId);
    });
  });
}

function openOpenTableModal(tableId, tableNumber) {
  const modalSpan = document.getElementById('modal-table-number-span');
  const modalIdInput = document.getElementById('modal-open-table-id');
  const waiterInput = document.getElementById('modal-waiter-name');
  const dinerInput = document.getElementById('modal-diner-count');

  if (modalSpan) modalSpan.textContent = tableNumber;
  if (modalIdInput) modalIdInput.value = tableId;
  if (waiterInput) waiterInput.value = state.currentUser?.name || 'Mesero de Turno';
  if (dinerInput) dinerInput.value = '2';

  openModal('modal-open-table');
}

async function handleConfirmOpenTable() {
  const tableId = document.getElementById('modal-open-table-id')?.value;
  const waiterName = document.getElementById('modal-waiter-name')?.value.trim() || 'Mesero de Turno';
  const dinerCount = Number(document.getElementById('modal-diner-count')?.value) || 2;
  const waiterId = state.currentUser?.id || 'usr-admin-ghanima';

  if (!tableId) return;

  try {
    const resSession = await apiFetch('/api/sessions', {
      method: 'POST',
      body: {
        tableId,
        waiterId,
        waiterName,
        dinerCount
      }
    });

    if (!resSession.ok) {
      const err = await resSession.json().catch(() => ({}));
      showToast(err.error || 'Error al abrir mesa', 'alert');
      return;
    }

    const session = await resSession.json();
    const sessionId = session.id;

    await updateTableStatus(tableId, 'OCCUPIED', sessionId);
    closeModal('modal-open-table');
    showToast(`Mesa abierta con éxito (${dinerCount} personas)`, 'success');
    loadTables();
  } catch (err) {
    showToast(err.message || 'Error al abrir mesa', 'alert');
  }
}

async function updateTableStatus(tableId, status, currentSessionId = null) {
  try {
    await apiFetch(`/api/tables/${tableId}/status`, {
      method: 'PATCH',
      body: { status, currentSessionId }
    });
  } catch (_) {}

  // Actualizar estado local
  const tbl = (state.tables || []).find(t => t.id === tableId);
  if (tbl) {
    tbl.status = status;
    tbl.currentSessionId = currentSessionId;
  }

  const db = initOfflineDb();
  const dbTbl = (db.tables || []).find(t => t.id === tableId);
  if (dbTbl) {
    dbTbl.status = status;
    dbTbl.currentSessionId = currentSessionId;
  }
  saveOfflineDb(db);
}

function openNewTableModal() {
  const form = document.getElementById('form-table-manage');
  if (form) form.reset();
  const idInput = document.getElementById('table-form-id');
  if (idInput) idInput.value = '';
  const title = document.getElementById('modal-table-form-title');
  if (title) title.textContent = '➕ Nueva Mesa';
  openModal('modal-table-form');
}

function openEditTableModal(table) {
  const idInput = document.getElementById('table-form-id');
  const numInput = document.getElementById('table-form-number');
  const zoneInput = document.getElementById('table-form-zone');
  const capInput = document.getElementById('table-form-capacity');
  const title = document.getElementById('modal-table-form-title');

  if (idInput) idInput.value = table.id || '';
  if (numInput) numInput.value = table.number || '';
  if (zoneInput) zoneInput.value = table.zone || 'Salón Principal';
  if (capInput) capInput.value = table.capacity || 4;
  if (title) title.textContent = `✏️ Editar Mesa #${table.number}`;

  openModal('modal-table-form');
}

async function handleSaveTableForm() {
  const id = document.getElementById('table-form-id')?.value;
  const number = Number(document.getElementById('table-form-number')?.value);
  const zone = document.getElementById('table-form-zone')?.value;
  const capacity = Number(document.getElementById('table-form-capacity')?.value);

  if (!number || number <= 0) {
    showToast('El número de mesa es inválido', 'alert');
    return;
  }

  const payload = { number, zone, capacity };

  try {
    if (id) {
      await apiFetch(`/api/tables/${id}`, {
        method: 'PUT',
        body: payload
      });
    } else {
      await apiFetch('/api/tables', {
        method: 'POST',
        body: payload
      });
    }
  } catch (_) {}

  // Actualizar DB local
  const db = initOfflineDb();
  if (id) {
    const idx = (db.tables || []).findIndex(t => t.id === id);
    if (idx >= 0) db.tables[idx] = { ...db.tables[idx], ...payload };
  } else {
    const newT = {
      id: `tab-${Date.now()}`,
      status: 'AVAILABLE',
      currentSessionId: null,
      ...payload
    };
    if (!Array.isArray(db.tables)) db.tables = [];
    db.tables.push(newT);
  }
  saveOfflineDb(db);

  closeModal('modal-table-form');
  showToast('Mesa guardada exitosamente', 'success');
  loadTables();
}

async function handleDeleteTable(tableId) {
  if (!confirm('¿Seguro que deseas eliminar esta mesa?')) return;

  try {
    await apiFetch(`/api/tables/${tableId}`, {
      method: 'DELETE'
    });
  } catch (_) {}

  const db = initOfflineDb();
  db.tables = (db.tables || []).filter(t => t.id !== tableId);
  saveOfflineDb(db);

  showToast('Mesa eliminada', 'info');
  loadTables();
}
