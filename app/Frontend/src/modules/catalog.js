/**
 * HERA CLOUD POS - Menu & Products Catalog Module (ES6)
 * CRUD completo de productos, switch instantáneo de disponibilidad,
 * filtros por cocina/barra y sincronización con el catálogo táctil de Express y POS.
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, showToast, openModal, closeModal, escapeHtml } from '../utils.js';

let activeStationFilter = 'ALL';

export function setupCatalogModule({ onCatalogChanged }) {
  const searchInput = document.getElementById('catalog-search-input');
  const btnNewProduct = document.getElementById('btn-new-product');
  const filterButtons = document.querySelectorAll('.catalog-filter-btn');
  const formProduct = document.getElementById('form-product-manage');

  if (searchInput) {
    searchInput.addEventListener('input', () => filterAndRenderCatalog());
  }

  if (btnNewProduct) {
    btnNewProduct.addEventListener('click', () => openNewProductModal());
  }

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
      });
      btn.classList.add('active', 'bg-indigo-600', 'text-white');
      btn.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');

      activeStationFilter = btn.dataset.station || 'ALL';
      filterAndRenderCatalog();
    });
  });

  if (formProduct) {
    formProduct.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSaveProductForm(onCatalogChanged);
    });
  }

  // Toggle visual para campos de stock
  const trackStockCheckbox = document.getElementById('product-form-track-stock');
  const stockFields = document.getElementById('product-form-stock-fields');
  if (trackStockCheckbox && stockFields) {
    trackStockCheckbox.addEventListener('change', () => {
      if (trackStockCheckbox.checked) {
        stockFields.classList.remove('hidden');
      } else {
        stockFields.classList.add('hidden');
      }
    });
  }
}

export async function loadCatalogProducts({ onCatalogChanged } = {}) {
  try {
    const res = await apiFetch('/api/products');
    if (res.ok) {
      const raw = await res.json();
      state.products = (raw || []).map(p => ({
        ...p,
        salePriceCOP: Number(p.salePriceCOP ?? p.salepricecop ?? p.priceCOP ?? p.price ?? 0),
        isAvailable: p.isAvailable !== false && p.isavailable !== false,
        trackStock: Boolean(p.trackStock ?? p.trackstock),
        stockUnits: Number(p.stockUnits ?? p.stockunits ?? p.stock ?? 0),
        minStockUnits: Number(p.minStockUnits ?? p.minstockunits ?? 5)
      }));
      filterAndRenderCatalog();
      if (typeof onCatalogChanged === 'function') onCatalogChanged(state.products);
      return;
    }
  } catch (_) {
    // Modo Offline
  }

  const db = initOfflineDb();
  state.products = db.products || [];
  filterAndRenderCatalog();
  if (typeof onCatalogChanged === 'function') onCatalogChanged(state.products);
}

function filterAndRenderCatalog() {
  const grid = document.getElementById('catalog-products-grid');
  if (!grid) return;

  const query = (document.getElementById('catalog-search-input')?.value || '').toLowerCase().trim();
  const products = (state.products || []).filter(p => {
    const matchStation = activeStationFilter === 'ALL' || p.station === activeStationFilter;
    const matchQuery = !query ||
      (p.name || '').toLowerCase().includes(query) ||
      (p.category || '').toLowerCase().includes(query);
    return matchStation && matchQuery;
  });

  if (products.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900">
        No hay productos registrados en esta vista.
      </div>
    `;
    return;
  }

  grid.innerHTML = products.map(p => {
    const price = Number(p.salePriceCOP || 0);
    const isAvail = p.isAvailable !== false;

    const stationBadge = p.station === 'BAR'
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">🍸 Barra</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">🍳 Cocina</span>';

    return `
      <div class="p-4 sm:p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3 flex flex-col justify-between hover:shadow-md transition">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-1">
            <span class="text-xs text-slate-400 truncate">${escapeHtml(p.category || 'General')}</span>
            ${stationBadge}
          </div>

          <h4 class="text-sm font-bold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2">
            ${escapeHtml(p.name)}
          </h4>

          <div class="text-base font-extrabold font-mono text-indigo-600 dark:text-indigo-400 pt-1">
            ${formatCOP(price)}
          </div>
        </div>

        <div class="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <!-- Toggle Disponibilidad -->
          <label class="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" class="cat-toggle-avail rounded text-indigo-600 focus:ring-indigo-500" data-id="${p.id}" ${isAvail ? 'checked' : ''}>
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-300">${isAvail ? 'Disponible' : 'Agotado'}</span>
          </label>

          <div class="flex items-center gap-1">
            <button type="button" class="btn-edit-prod p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs" data-id="${p.id}" title="Editar">
              ✏️
            </button>
            <button type="button" class="btn-del-prod p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-red-50 hover:text-red-600 text-slate-400 text-xs" data-id="${p.id}" title="Eliminar">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Eventos de toggles y botones
  grid.querySelectorAll('.cat-toggle-avail').forEach(chk => {
    chk.addEventListener('change', async () => {
      const prodId = chk.dataset.id;
      const isAvail = chk.checked;
      await toggleProductAvailability(prodId, isAvail);
    });
  });

  grid.querySelectorAll('.btn-edit-prod').forEach(btn => {
    btn.addEventListener('click', () => {
      const prod = (state.products || []).find(p => p.id === btn.dataset.id);
      if (prod) openEditProductModal(prod);
    });
  });

  grid.querySelectorAll('.btn-del-prod').forEach(btn => {
    btn.addEventListener('click', () => {
      handleDeleteProduct(btn.dataset.id);
    });
  });
}

async function toggleProductAvailability(productId, isAvailable) {
  const prod = (state.products || []).find(p => p.id === productId);
  if (!prod) return;

  prod.isAvailable = isAvailable;

  try {
    await apiFetch(`/api/products/${productId}`, {
      method: 'PUT',
      body: {
        name: prod.name,
        category: prod.category,
        station: prod.station,
        salePriceCOP: prod.salePriceCOP,
        isAvailable
      }
    });
  } catch (_) {}

  const db = initOfflineDb();
  const dbProd = (db.products || []).find(p => p.id === productId);
  if (dbProd) dbProd.isAvailable = isAvailable;
  saveOfflineDb(db);

  showToast(`Producto '${prod.name}' marcado como ${isAvailable ? 'Disponible' : 'Agotado'}`, 'info');
  filterAndRenderCatalog();
}

export function openNewProductModal() {
  const form = document.getElementById('form-product-manage');
  if (form) form.reset();
  const idInput = document.getElementById('product-form-id');
  if (idInput) idInput.value = '';
  const title = document.getElementById('modal-product-form-title');
  if (title) title.textContent = '➕ Nuevo Producto';

  const stockBox = document.getElementById('product-form-stock-box');
  const trackChk = document.getElementById('product-form-track-stock');
  const stockFields = document.getElementById('product-form-stock-fields');
  const stockUnits = document.getElementById('product-form-stock-units');
  const minStock = document.getElementById('product-form-min-stock');

  const isInventoryEnabled = state.currentTenant?.enabledModules?.inventory !== false;
  if (stockBox) {
    if (isInventoryEnabled) stockBox.classList.remove('hidden');
    else stockBox.classList.add('hidden');
  }
  if (trackChk) trackChk.checked = false;
  if (stockFields) stockFields.classList.add('hidden');
  if (stockUnits) stockUnits.value = '20';
  if (minStock) minStock.value = '5';

  openModal('modal-product-form');
}

function openEditProductModal(product) {
  const idInput = document.getElementById('product-form-id');
  const nameInput = document.getElementById('product-form-name');
  const catInput = document.getElementById('product-form-category');
  const stationSelect = document.getElementById('product-form-station');
  const priceInput = document.getElementById('product-form-price');
  const availSelect = document.getElementById('product-form-available');
  const title = document.getElementById('modal-product-form-title');

  const stockBox = document.getElementById('product-form-stock-box');
  const trackChk = document.getElementById('product-form-track-stock');
  const stockFields = document.getElementById('product-form-stock-fields');
  const stockUnits = document.getElementById('product-form-stock-units');
  const minStock = document.getElementById('product-form-min-stock');

  if (idInput) idInput.value = product.id || '';
  if (nameInput) nameInput.value = product.name || '';
  if (catInput) catInput.value = product.category || '';
  if (stationSelect) stationSelect.value = product.station || 'KITCHEN';
  if (priceInput) priceInput.value = product.salePriceCOP || product.priceCOP || product.price || 0;
  if (availSelect) availSelect.value = product.isAvailable !== false ? 'true' : 'false';
  if (title) title.textContent = `✏️ Editar Producto: ${product.name}`;

  const isInventoryEnabled = state.currentTenant?.enabledModules?.inventory !== false;
  if (stockBox) {
    if (isInventoryEnabled) stockBox.classList.remove('hidden');
    else stockBox.classList.add('hidden');
  }

  const isTracked = !!product.trackStock;
  if (trackChk) trackChk.checked = isTracked;
  if (stockFields) {
    if (isTracked && isInventoryEnabled) stockFields.classList.remove('hidden');
    else stockFields.classList.add('hidden');
  }
  if (stockUnits) stockUnits.value = product.stockUnits ?? product.stock ?? 0;
  if (minStock) minStock.value = product.minStockUnits ?? 5;

  openModal('modal-product-form');
}

async function handleSaveProductForm(onCatalogChanged) {
  const id = document.getElementById('product-form-id')?.value;
  const name = document.getElementById('product-form-name')?.value.trim();
  const category = document.getElementById('product-form-category')?.value.trim();
  const station = document.getElementById('product-form-station')?.value;
  const salePriceCOP = Number(document.getElementById('product-form-price')?.value);
  const isAvailable = document.getElementById('product-form-available')?.value === 'true';

  const trackStock = Boolean(document.getElementById('product-form-track-stock')?.checked);
  const stockUnits = Number(document.getElementById('product-form-stock-units')?.value) || 0;
  const minStockUnits = Number(document.getElementById('product-form-min-stock')?.value) || 5;

  if (!name || salePriceCOP <= 0) {
    showToast('Nombre y precio COP válidos son obligatorios', 'alert');
    return;
  }

  const payload = {
    name,
    category: category || 'General',
    station: station || 'KITCHEN',
    salePriceCOP,
    priceCOP: salePriceCOP,
    isAvailable,
    trackStock,
    stockUnits,
    minStockUnits
  };

  try {
    if (id) {
      await apiFetch(`/api/products/${id}`, {
        method: 'PUT',
        body: payload
      });
    } else {
      await apiFetch('/api/products', {
        method: 'POST',
        body: payload
      });
    }
  } catch (_) {}

  // Actualizar estado y DB local
  const db = initOfflineDb();
  if (id) {
    const idx = (db.products || []).findIndex(p => p.id === id);
    if (idx >= 0) db.products[idx] = { ...db.products[idx], ...payload };
    const stateIdx = (state.products || []).findIndex(p => p.id === id);
    if (stateIdx >= 0) state.products[stateIdx] = { ...state.products[stateIdx], ...payload };
  } else {
    const newProd = {
      id: `prod-${Date.now()}`,
      ...payload
    };
    if (!Array.isArray(db.products)) db.products = [];
    db.products.push(newProd);
    if (!Array.isArray(state.products)) state.products = [];
    state.products.push(newProd);
  }
  saveOfflineDb(db);

  closeModal('modal-product-form');
  showToast('Producto guardado con éxito', 'success');
  filterAndRenderCatalog();

  if (typeof onCatalogChanged === 'function') {
    onCatalogChanged(state.products);
  }
}

async function handleDeleteProduct(productId) {
  if (!confirm('¿Deseas eliminar este producto del menú?')) return;

  try {
    await apiFetch(`/api/products/${productId}`, {
      method: 'DELETE'
    });
  } catch (_) {}

  state.products = (state.products || []).filter(p => p.id !== productId);
  const db = initOfflineDb();
  db.products = (db.products || []).filter(p => p.id !== productId);
  saveOfflineDb(db);

  showToast('Producto eliminado', 'info');
  filterAndRenderCatalog();
}
