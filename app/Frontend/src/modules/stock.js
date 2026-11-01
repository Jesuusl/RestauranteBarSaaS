/**
 * HERA CLOUD POS - Stock & Inventory Module (ES6)
 * Módulo 9: Control de Inventario y Stock Simple
 * Monitoreo de existencias, alertas de stock mínimo, switches de seguimiento
 * y modal de ajuste rápido (Entradas, Salidas, Fijar stock).
 * 100% Tailwind CSS, CERO estilos en línea.
 */

import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, showToast, openModal, closeModal, escapeHtml } from '../utils.js';

let currentFilter = 'ALL';
let currentSearch = '';

export function setupStockModule() {
  const refreshBtn = document.getElementById('btn-refresh-stock');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadStockView();
      showToast('Inventario actualizado', 'info');
    });
  }

  // Buscador reactivo
  const searchInput = document.getElementById('stock-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearch = (e.target.value || '').toLowerCase().trim();
      renderStockTable();
    });
  }

  // Filtros de estado (.stock-filter-btn)
  const filterBtns = document.querySelectorAll('.stock-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => {
        b.classList.remove('active', 'bg-slate-900', 'text-white', 'dark:bg-white', 'dark:text-slate-900');
        b.classList.add('bg-slate-100', 'hover:bg-slate-200', 'dark:bg-slate-800', 'dark:hover:bg-slate-700', 'text-slate-700', 'dark:text-slate-300');
      });
      btn.classList.add('active', 'bg-slate-900', 'text-white', 'dark:bg-white', 'dark:text-slate-900');
      btn.classList.remove('bg-slate-100', 'hover:bg-slate-200', 'dark:bg-slate-800', 'dark:hover:bg-slate-700', 'text-slate-700', 'dark:text-slate-300');

      currentFilter = btn.getAttribute('data-stock-filter') || 'ALL';
      renderStockTable();
    });
  });

  // Delegación de eventos en la tabla (Ajustar stock o Toggle switch)
  const tbody = document.getElementById('stock-products-tbody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const adjustBtn = e.target.closest('[data-stock-adjust-id]');
      if (adjustBtn) {
        const prodId = adjustBtn.getAttribute('data-stock-adjust-id');
        openStockAdjustModal(prodId);
        return;
      }

      const toggleInput = e.target.closest('.stock-toggle-track');
      if (toggleInput) {
        const prodId = toggleInput.getAttribute('data-prod-id');
        const nextState = toggleInput.checked;
        handleToggleTrackStock(prodId, nextState);
      }
    });
  }

  // Botón confirmar ajuste dentro de modal
  const btnConfirmAdjust = document.getElementById('btn-confirm-stock-adjust');
  if (btnConfirmAdjust) {
    btnConfirmAdjust.addEventListener('click', handleConfirmStockAdjust);
  }
}

export async function loadStockView() {
  const tbody = document.getElementById('stock-products-tbody');
  if (tbody && (!state.products || state.products.length === 0)) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-8 text-center text-slate-400">
          Cargando inventario de productos...
        </td>
      </tr>
    `;
  }

  try {
    const res = await apiFetch('/api/products');
    if (res.ok) {
      const data = await res.json();
      state.products = Array.isArray(data) ? data : (data.products || []);
    }
  } catch (err) {
    console.warn('Error cargando inventario desde API, usando estado local:', err);
  }

  updateStockKPIs();
  renderStockTable();
}

function updateStockKPIs() {
  const products = state.products || [];
  
  let trackedCount = 0;
  let lowCount = 0;
  let outCount = 0;

  products.forEach(p => {
    if (p.trackStock) {
      trackedCount++;
      const current = Number(p.stockUnits !== undefined ? p.stockUnits : (p.stock !== undefined ? p.stock : 0));
      const minStock = Number(p.minStockUnits || 5);
      if (current <= 0) {
        outCount++;
      } else if (current <= minStock) {
        lowCount++;
      }
    }
  });

  const kpiTracked = document.getElementById('stock-kpi-tracked');
  const kpiLow = document.getElementById('stock-kpi-low');
  const kpiOut = document.getElementById('stock-kpi-out');

  if (kpiTracked) kpiTracked.textContent = trackedCount;
  if (kpiLow) kpiLow.textContent = lowCount;
  if (kpiOut) kpiOut.textContent = outCount;
}

function renderStockTable() {
  const tbody = document.getElementById('stock-products-tbody');
  const emptyState = document.getElementById('stock-empty-state');
  if (!tbody) return;

  const products = state.products || [];

  const filtered = products.filter(p => {
    // Filtro de búsqueda
    const nameMatch = (p.name || '').toLowerCase().includes(currentSearch);
    const catMatch = (p.category || '').toLowerCase().includes(currentSearch);
    if (!nameMatch && !catMatch) return false;

    const isTracked = !!p.trackStock;
    const current = Number(p.stockUnits !== undefined ? p.stockUnits : (p.stock !== undefined ? p.stock : 0));
    const minStock = Number(p.minStockUnits || 5);

    if (currentFilter === 'LOW') {
      return isTracked && current > 0 && current <= minStock;
    }
    if (currentFilter === 'OUT') {
      return isTracked && current <= 0;
    }
    if (currentFilter === 'UNTRACKED') {
      return !isTracked;
    }
    return true; // 'ALL'
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  tbody.innerHTML = filtered.map(p => {
    const isTracked = !!p.trackStock;
    const current = Number(p.stockUnits !== undefined ? p.stockUnits : (p.stock !== undefined ? p.stock : 0));
    const minStock = Number(p.minStockUnits || 5);

    let statusBadge = '';
    let stockDisplay = '';

    if (!isTracked) {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">⚪ Sin Control</span>';
      stockDisplay = '<span class="text-slate-400 font-mono italic">--</span>';
    } else if (current <= 0) {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300">🚫 Agotado</span>';
      stockDisplay = `<span class="font-mono font-extrabold text-rose-600 dark:text-rose-400">${current}</span>`;
    } else if (current <= minStock) {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300">⚠️ Stock Bajo</span>';
      stockDisplay = `<span class="font-mono font-bold text-amber-600 dark:text-amber-400">${current}</span>`;
    } else {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300">✅ En Stock</span>';
      stockDisplay = `<span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">${current}</span>`;
    }

    return `
      <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
        <td class="py-3 px-4">
          <div class="font-bold text-slate-900 dark:text-white">${escapeHtml(p.name)}</div>
          <div class="text-[11px] text-slate-400">${escapeHtml(p.category || 'General')} &middot; ${formatCOP(p.salePriceCOP ?? p.priceCOP ?? p.price ?? 0)}</div>
        </td>
        <td class="py-3 px-3 text-center">
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer stock-toggle-track" data-prod-id="${escapeHtml(p.id)}" ${isTracked ? 'checked' : ''}>
            <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </td>
        <td class="py-3 px-4 text-center text-sm">
          ${stockDisplay}
        </td>
        <td class="py-3 px-4 text-center font-mono text-slate-600 dark:text-slate-400">
          ${isTracked ? minStock : '<span class="text-slate-400 italic">--</span>'}
        </td>
        <td class="py-3 px-4 text-center">
          ${statusBadge}
        </td>
        <td class="py-3 px-4 text-right">
          <button type="button" data-stock-adjust-id="${escapeHtml(p.id)}" class="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition">
            ⚙️ Ajustar
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleToggleTrackStock(productId, nextTrackStock) {
  try {
    const res = await apiFetch(`/api/products/${productId}/stock`, {
      method: 'PATCH',
      body: {
        trackStock: nextTrackStock
      }
    });

    if (res.ok) {
      const updated = await res.json();
      updateLocalProduct(updated);
      showToast(nextTrackStock ? 'Control de stock activado' : 'Control de stock desactivado', 'info');
    } else {
      // Revertir localmente si falló
      loadStockView();
      showToast('No se pudo actualizar el seguimiento de stock', 'error');
    }
  } catch (err) {
    console.error('Error toggling trackStock:', err);
    loadStockView();
    showToast('Error conectando con el servidor', 'error');
  }
}

function openStockAdjustModal(productId) {
  const product = (state.products || []).find(p => String(p.id) === String(productId));
  if (!product) return;

  const idInput = document.getElementById('stock-adjust-product-id');
  const nameDisplay = document.getElementById('stock-adjust-product-name');
  const currentDisplay = document.getElementById('stock-adjust-current-units');
  const unitsInput = document.getElementById('stock-adjust-units');
  const minInput = document.getElementById('stock-adjust-min');
  const reasonInput = document.getElementById('stock-adjust-reason');
  const modeSelect = document.getElementById('stock-adjust-mode');

  if (idInput) idInput.value = product.id;
  if (nameDisplay) nameDisplay.textContent = product.name;
  
  const current = Number(product.stockUnits !== undefined ? product.stockUnits : (product.stock !== undefined ? product.stock : 0));
  if (currentDisplay) currentDisplay.textContent = `${current} Unidades`;
  if (unitsInput) unitsInput.value = '';
  if (minInput) minInput.value = String(product.minStockUnits ?? 5);
  if (reasonInput) reasonInput.value = '';
  if (modeSelect) modeSelect.value = 'ADD';

  openModal('modal-stock-adjust');
}

async function handleConfirmStockAdjust() {
  const idInput = document.getElementById('stock-adjust-product-id');
  const unitsInput = document.getElementById('stock-adjust-units');
  const minInput = document.getElementById('stock-adjust-min');
  const reasonInput = document.getElementById('stock-adjust-reason');
  const modeSelect = document.getElementById('stock-adjust-mode');

  const productId = idInput?.value;
  const units = parseInt(unitsInput?.value, 10);
  const minStockRaw = minInput?.value !== undefined && String(minInput.value).trim() !== '' ? parseInt(minInput.value, 10) : undefined;
  const rawMode = modeSelect?.value || 'ADD';
  const mode = rawMode === 'SUB' ? 'SUBTRACT' : rawMode;
  const reason = reasonInput?.value?.trim() || 'Ajuste manual';

  if (!productId) return;
  if (isNaN(units) || units < 0) {
    showToast('Ingresa una cantidad de unidades válida', 'warning');
    return;
  }

  const bodyPayload = {
    trackStock: true,
    mode,
    quantity: units,
    units,
    reason
  };
  if (mode === 'SET') {
    bodyPayload.stockUnits = units;
  }
  if (minStockRaw !== undefined && !isNaN(minStockRaw) && minStockRaw >= 0) {
    bodyPayload.minStockUnits = minStockRaw;
  }

  try {
    const res = await apiFetch(`/api/products/${productId}/stock`, {
      method: 'PATCH',
      body: bodyPayload
    });

    if (res.ok) {
      const updated = await res.json();
      updateLocalProduct(updated);
      closeModal('modal-stock-adjust');
      showToast('Ajuste de inventario aplicado con éxito', 'success');
    } else {
      const errData = await res.json().catch(() => ({}));
      showToast(errData.error || 'Error aplicando ajuste', 'error');
    }
  } catch (err) {
    console.error('Error aplicando ajuste de stock:', err);
    showToast('Error de conexión al aplicar ajuste', 'error');
  }
}

function updateLocalProduct(updatedProd) {
  if (!updatedProd || !updatedProd.id) return;
  const idx = (state.products || []).findIndex(p => String(p.id) === String(updatedProd.id));
  if (idx !== -1) {
    state.products[idx] = { ...state.products[idx], ...updatedProd };
  } else {
    state.products.push(updatedProd);
  }
  updateStockKPIs();
  renderStockTable();
}
