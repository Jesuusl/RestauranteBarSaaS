/**
 * GHANIMA CLOUD POS - POS Table Order Taking Module (ES6)
 * Toma de pedidos para mesas activas, selector de modificadores y envío ACID a KDS.
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, showToast, openModal, closeModal, playNotificationSound, escapeHtml } from '../utils.js';

let posCart = []; // [{ product, quantity, modifiers, notes }]
let tempModProduct = null;
let activeStationFilter = 'ALL';

export function setupPosModule({ onOrderSubmitted }) {
  const tableSelect = document.getElementById('pos-table-select');
  const searchInput = document.getElementById('pos-search-input');
  const stationButtons = document.querySelectorAll('.station-btn');
  const btnClearCart = document.getElementById('btn-clear-cart');
  const btnSubmitOrder = document.getElementById('btn-submit-order');
  const btnConfirmMod = document.getElementById('btn-confirm-add-with-mod');

  if (tableSelect) {
    tableSelect.addEventListener('change', () => {
      state.selectedTableId = tableSelect.value || null;
      updateActiveTableMeta();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => filterAndRenderPosProducts());
  }

  stationButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      stationButtons.forEach(b => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
      });
      btn.classList.add('active', 'bg-indigo-600', 'text-white');
      btn.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');

      activeStationFilter = btn.dataset.station || 'ALL';
      filterAndRenderPosProducts();
    });
  });

  if (btnClearCart) {
    btnClearCart.addEventListener('click', () => {
      posCart = [];
      renderPosCart();
      showToast('Comanda limpiada', 'info');
    });
  }

  if (btnSubmitOrder) {
    btnSubmitOrder.addEventListener('click', () => handleSubmitOrder(onOrderSubmitted));
  }

  // Modificadores Modal
  const modChips = document.querySelectorAll('#mod-chips-container .chip-btn');
  modChips.forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      chip.classList.toggle('bg-indigo-600');
      chip.classList.toggle('text-white');
    });
  });

  if (btnConfirmMod) {
    btnConfirmMod.addEventListener('click', () => handleConfirmAddWithMod());
  }

  const btnMobileJump = document.getElementById('pos-mobile-cart-jump');
  if (btnMobileJump) {
    btnMobileJump.addEventListener('click', () => {
      const cartEl = document.getElementById('cart-items-container');
      if (cartEl) cartEl.scrollIntoView({ behavior: 'smooth' });
    });
  }
}

export function loadPosModule() {
  populatePosTableSelect();
  filterAndRenderPosProducts();
  renderPosCart();
  updateActiveTableMeta();
}

export function populatePosTableSelect() {
  const select = document.getElementById('pos-table-select');
  if (!select) return;

  const tables = state.tables || [];
  select.innerHTML = `
    <option value="">-- Selecciona una Mesa --</option>
    ${tables.map(t => {
      const isSelected = state.selectedTableId === t.id ? 'selected' : '';
      const statusIcon = t.status === 'OCCUPIED' ? '🔴' : (t.status === 'PAYING' ? '🟡' : '🟢');
      return `<option value="${t.id}" ${isSelected}>${statusIcon} Mesa #${t.number} (${t.zone})</option>`;
    }).join('')}
  `;

  updateActiveTableMeta();
}

function updateActiveTableMeta() {
  const badge = document.getElementById('pos-active-table-number');
  const label = document.getElementById('pos-active-session-label');
  const meta = document.getElementById('pos-active-session-meta');

  const table = (state.tables || []).find(t => t.id === state.selectedTableId);

  if (table) {
    if (badge) badge.textContent = `#${table.number}`;
    if (label) label.textContent = `Mesa #${table.number} - ${table.zone}`;
    if (meta) meta.textContent = `Capacidad: ${table.capacity} pers | Estado: ${table.status}`;
  } else {
    if (badge) badge.textContent = '--';
    if (label) label.textContent = 'Ninguna mesa seleccionada';
    if (meta) meta.textContent = 'Selecciona una mesa en el menú desplegable';
  }
}

function filterAndRenderPosProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  const query = (document.getElementById('pos-search-input')?.value || '').toLowerCase().trim();
  const products = (state.products || []).filter(p => {
    const isAvail = p.isAvailable !== false;
    const matchStation = activeStationFilter === 'ALL' || p.station === activeStationFilter;
    const matchQuery = !query ||
      (p.name || '').toLowerCase().includes(query) ||
      (p.category || '').toLowerCase().includes(query);
    return isAvail && matchStation && matchQuery;
  });

  if (products.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-8 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900">
        No hay productos disponibles en esta categoría.
      </div>
    `;
    return;
  }

  grid.innerHTML = products.map(p => {
    const price = Number(p.salePriceCOP || 0);
    const stationBadge = p.station === 'BAR'
      ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold">Barra</span>'
      : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 font-semibold">Cocina</span>';

    return `
      <button type="button" class="btn-pos-product p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-500 hover:shadow-md transition text-left flex flex-col justify-between space-y-2 group active:scale-[0.98]" data-product-id="${p.id}">
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-1">
            <span class="text-[11px] text-slate-400 truncate">${escapeHtml(p.category || 'General')}</span>
            ${stationBadge}
          </div>
          <h4 class="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-2 group-hover:text-indigo-600 transition">
            ${escapeHtml(p.name)}
          </h4>
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
          <span class="text-xs sm:text-sm font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
            ${formatCOP(price)}
          </span>
          <span class="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs group-hover:bg-indigo-600 group-hover:text-white transition">
            +
          </span>
        </div>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.btn-pos-product').forEach(btn => {
    btn.addEventListener('click', () => {
      const prodId = btn.dataset.productId;
      const product = (state.products || []).find(p => p.id === prodId);
      if (product) {
        openModifierModalForProduct(product);
      }
    });
  });
}

function openModifierModalForProduct(product) {
  tempModProduct = product;
  const nameEl = document.getElementById('modal-mod-product-name');
  const notesInput = document.getElementById('modal-mod-notes');

  if (nameEl) nameEl.textContent = `${product.name} (${formatCOP(product.salePriceCOP)})`;
  if (notesInput) notesInput.value = '';

  // Limpiar chips seleccionados
  document.querySelectorAll('#mod-chips-container .chip-btn').forEach(ch => {
    ch.classList.remove('active', 'bg-indigo-600', 'text-white');
  });

  openModal('modal-modifiers');
}

function handleConfirmAddWithMod() {
  if (!tempModProduct) return;

  const notesInput = document.getElementById('modal-mod-notes');
  const notes = notesInput ? notesInput.value.trim() : '';

  const selectedChips = [];
  document.querySelectorAll('#mod-chips-container .chip-btn.active').forEach(ch => {
    selectedChips.push(ch.dataset.mod || ch.textContent.trim());
  });

  const modifiers = selectedChips.join(', ');

  posCart.push({
    product: tempModProduct,
    quantity: 1,
    modifiers,
    notes
  });

  closeModal('modal-modifiers');
  tempModProduct = null;
  renderPosCart();
  playNotificationSound('success');
}

function renderPosCart() {
  const container = document.getElementById('cart-items-container');
  const elSub = document.getElementById('cart-subtotal-cop');
  const elTax = document.getElementById('cart-tax-cop');
  const elTotal = document.getElementById('cart-total-cop');
  const elMobileTotal = document.getElementById('pos-mobile-cart-total');
  const btnSubmit = document.getElementById('btn-submit-order');

  if (!container) return;

  if (posCart.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 dark:text-slate-500 text-xs">
        La comanda está vacía.<br>Selecciona productos del menú.
      </div>
    `;
    if (elSub) elSub.textContent = '$ 0 COP';
    if (elTax) elTax.textContent = '$ 0 COP';
    if (elTax && elTax.parentElement) elTax.parentElement.classList.add('hidden');
    if (elTotal) elTotal.textContent = '$ 0 COP';
    if (elMobileTotal) elMobileTotal.textContent = '$ 0 COP';
    if (btnSubmit) btnSubmit.disabled = true;
    return;
  }

  const subtotalCOP = posCart.reduce((acc, it) => acc + ((Number(it.product.salePriceCOP) || 0) * it.quantity), 0);
  const taxConfig = state.currentTenant?.taxConfig || {};
  const hasTax = Boolean(taxConfig.applyImpoconsumo ?? taxConfig.impoconsumo);
  const taxRate = taxConfig.impoconsumoRate !== undefined ? Number(taxConfig.impoconsumoRate) : 0.08;
  const taxCOP = hasTax ? Math.round(subtotalCOP * taxRate) : 0;
  const totalCOP = subtotalCOP + taxCOP;

  if (elTax && elTax.parentElement) {
    if (hasTax) {
      elTax.parentElement.classList.remove('hidden');
    } else {
      elTax.parentElement.classList.add('hidden');
    }
  }

  if (elSub) elSub.textContent = formatCOP(subtotalCOP);
  if (elTax) elTax.textContent = formatCOP(taxCOP);
  if (elTotal) elTotal.textContent = formatCOP(totalCOP);
  if (elMobileTotal) elMobileTotal.textContent = formatCOP(totalCOP);
  if (btnSubmit) btnSubmit.disabled = false;

  container.innerHTML = posCart.map((it, idx) => {
    const lineTotal = (Number(it.product.salePriceCOP) || 0) * it.quantity;
    const modsHtml = it.modifiers ? `<div class="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold">${escapeHtml(it.modifiers)}</div>` : '';
    const notesHtml = it.notes ? `<div class="text-[10px] text-slate-400 italic">Nota: ${escapeHtml(it.notes)}</div>` : '';

    return `
      <div class="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1.5 text-xs">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <h5 class="font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(it.product.name)}</h5>
            <div class="text-[11px] font-mono text-slate-400">${formatCOP(it.product.salePriceCOP)} c/u</div>
          </div>
          <span class="font-mono font-extrabold text-slate-900 dark:text-white">${formatCOP(lineTotal)}</span>
        </div>

        ${modsHtml}
        ${notesHtml}

        <div class="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
          <div class="flex items-center gap-1.5">
            <button type="button" class="btn-pos-dec w-6 h-6 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 font-bold text-xs" data-index="${idx}">-</button>
            <span class="w-5 text-center font-bold text-xs">${it.quantity}</span>
            <button type="button" class="btn-pos-inc w-6 h-6 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 font-bold text-xs" data-index="${idx}">+</button>
          </div>
          <button type="button" class="btn-pos-del text-[10px] text-red-500 hover:text-red-700" data-index="${idx}">Eliminar</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-pos-dec').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      if (posCart[idx].quantity > 1) {
        posCart[idx].quantity -= 1;
      } else {
        posCart.splice(idx, 1);
      }
      renderPosCart();
    });
  });

  container.querySelectorAll('.btn-pos-inc').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      posCart[idx].quantity += 1;
      renderPosCart();
    });
  });

  container.querySelectorAll('.btn-pos-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      posCart.splice(idx, 1);
      renderPosCart();
    });
  });
}

async function handleSubmitOrder(onOrderSubmitted) {
  if (!state.selectedTableId) {
    showToast('Debes seleccionar una mesa para enviar la comanda', 'alert');
    return;
  }

  if (posCart.length === 0) {
    showToast('La comanda no tiene artículos', 'alert');
    return;
  }

  const waiterId = state.currentUser?.id || 'usr-admin-ghanima';
  const waiterName = state.currentUser?.name || 'Admin Ghanima';
  const table = (state.tables || []).find(t => t.id === state.selectedTableId);

  let sessionId = table?.currentSessionId;

  // Si la mesa no tiene sesión activa o está disponible, abrir sesión antes de enviar comanda
  if (!sessionId || table?.status === 'AVAILABLE') {
    try {
      const resSession = await apiFetch('/api/sessions', {
        method: 'POST',
        body: {
          tableId: state.selectedTableId,
          waiterId,
          waiterName,
          dinerCount: table?.capacity || 2
        }
      });
      if (resSession.ok) {
        const sessionData = await resSession.json();
        sessionId = sessionData.id;
        if (table) {
          table.currentSessionId = sessionId;
          table.status = 'OCCUPIED';
        }
        await apiFetch(`/api/tables/${state.selectedTableId}/status`, {
          method: 'PATCH',
          body: { status: 'OCCUPIED', currentSessionId: sessionId }
        }).catch(() => {});
      }
    } catch (_) {}
  }

  const payload = {
    sessionId: sessionId || `sess-${Date.now()}`,
    tableId: state.selectedTableId,
    waiterId,
    waiterName,
    station: 'ALL',
    items: posCart.map(it => ({
      productId: it.product.id,
      productName: it.product.name,
      quantity: it.quantity,
      modifiers: it.modifiers || '',
      notes: it.notes || '',
      unitPriceCOP: Number(it.product.salePriceCOP || 0)
    }))
  };

  try {
    const res = await apiFetch('/api/orders', {
      method: 'POST',
      body: payload
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Error al enviar comanda a cocina', 'alert');
      return;
    }

    showToast('¡Comanda enviada a KDS con éxito!', 'success');
    playNotificationSound('success');
  } catch (netErr) {
    // Fallback offline únicamente en caso de fallo de red
    const db = initOfflineDb();
    const newOrd = {
      id: `ord-${Date.now()}`,
      orderNumber: (db.kdsOrders?.length || 0) + 101,
      tableNumber: table?.number || 1,
      tableName: `Mesa ${table?.number || 1}`,
      station: 'KITCHEN',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      items: payload.items
    };
    if (!Array.isArray(db.kdsOrders)) db.kdsOrders = [];
    db.kdsOrders.push(newOrd);
    saveOfflineDb(db);
    showToast('Comanda guardada localmente (modo offline)', 'info');
  }

  posCart = [];
  renderPosCart();

  if (typeof onOrderSubmitted === 'function') {
    onOrderSubmitted();
  }
}
