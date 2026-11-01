/**
 * HERA CLOUD POS - Express POS Module (ES6)
 * Cobro ultrarrápido de mostrador, catálogo táctil, carrito reactivo con control de stock en tiempo real,
 * cálculo de Impoconsumo (8%), Propina (10%), soporte para Transferencia, Pago Mixto y ticket térmico.
 * 100% Tailwind CSS, CERO estilos en línea.
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, showToast, openModal, closeModal, renderThermalReceipt, escapeHtml } from '../utils.js';

let expressCart = []; // [{ product, quantity }]
let selectedPaymentMethod = 'CASH';
let activeMixedContext = null; // Para saber si el modal de pago mixto fue invocado desde express o billing

export function setupExpressPos({ onSaleCompleted, onOpenProductModal }) {
  const searchInput = document.getElementById('express-search-input');
  const btnClear = document.getElementById('btn-express-clear');
  const tipToggle = document.getElementById('express-tip-toggle');
  const cashReceivedInput = document.getElementById('express-cash-received');
  const btnCheckout = document.getElementById('btn-express-checkout');
  const btnQuickProd = document.getElementById('btn-express-quick-product');
  const btnOpenMixed = document.getElementById('btn-express-open-mixed');

  if (searchInput) {
    searchInput.addEventListener('input', () => filterAndRenderExpressProducts());
    // Atajo de teclado: presionar '/' enfoca el buscador de cobro
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput && state.activeView === 'view-express') {
        e.preventDefault();
        searchInput.focus();
      }
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      expressCart = [];
      renderExpressCart();
      showToast('Canasta de cobro vaciada', 'info');
    });
  }

  if (btnQuickProd && typeof onOpenProductModal === 'function') {
    btnQuickProd.addEventListener('click', onOpenProductModal);
  }

  if (tipToggle) {
    tipToggle.addEventListener('change', () => calculateAndRenderTotals());
  }

  if (cashReceivedInput) {
    cashReceivedInput.addEventListener('input', () => updateCashChange());
  }

  // Métodos de pago
  const payButtons = document.querySelectorAll('#express-payment-methods .express-pay-method');
  payButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      payButtons.forEach(b => {
        b.classList.remove('active', 'border-emerald-500', 'bg-emerald-50', 'text-emerald-700', 'dark:bg-emerald-950/60', 'dark:text-emerald-300');
        b.classList.add('border-slate-200', 'dark:border-slate-700');
      });
      btn.classList.add('active', 'border-emerald-500', 'bg-emerald-50', 'text-emerald-700', 'dark:bg-emerald-950/60', 'dark:text-emerald-300');
      btn.classList.remove('border-slate-200', 'dark:border-slate-700');

      selectedPaymentMethod = btn.dataset.method || 'CASH';
      const cashPanel = document.getElementById('express-cash-panel');
      if (cashPanel) {
        if (selectedPaymentMethod === 'CASH') {
          cashPanel.classList.remove('hidden');
        } else {
          cashPanel.classList.add('hidden');
        }
      }
      calculateAndRenderTotals();
    });
  });

  // Botón Abrir Pago Mixto desde Mostrador
  if (btnOpenMixed) {
    btnOpenMixed.addEventListener('click', () => {
      if (expressCart.length === 0) {
        showToast('Agrega al menos un producto para cobrar', 'warning');
        return;
      }
      activeMixedContext = 'EXPRESS';
      openMixedPaymentModal(getCartTotals().totalCOP);
    });
  }

  // Configurar listeners del modal de pago mixto
  setupMixedPaymentModalListeners(onSaleCompleted);

  // Billetes rápidos COP (Exacto, 10k, 20k, 50k, 100k)
  const billButtons = document.querySelectorAll('.express-bill-btn');
  billButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const amountAttr = btn.dataset.amount;
      const totals = getCartTotals();
      if (amountAttr === 'EXACT') {
        if (cashReceivedInput) cashReceivedInput.value = totals.totalCOP;
      } else {
        const val = Number(amountAttr) || 0;
        if (cashReceivedInput) cashReceivedInput.value = val;
      }
      updateCashChange();
    });
  });

  // Botón Principal de Cobro
  if (btnCheckout) {
    btnCheckout.addEventListener('click', () => executeExpressCheckout(onSaleCompleted));
  }

  // Botón para nueva venta dentro del modal del recibo
  const btnNewSaleAfterReceipt = document.getElementById('btn-new-sale-after-receipt');
  if (btnNewSaleAfterReceipt) {
    btnNewSaleAfterReceipt.addEventListener('click', () => {
      closeModal('modal-receipt');
      expressCart = [];
      renderExpressCart();
      if (searchInput) searchInput.focus();
    });
  }

  // Botón imprimir ticket
  const btnPrintReceipt = document.getElementById('btn-print-receipt');
  if (btnPrintReceipt) {
    btnPrintReceipt.addEventListener('click', () => {
      window.print();
    });
  }
}

export function loadExpressCatalog(products = []) {
  renderExpressCategories(products);
  filterAndRenderExpressProducts(products);
  renderExpressCart();
}

function renderExpressCategories(products) {
  const bar = document.getElementById('express-categories-bar');
  if (!bar) return;

  const categories = ['ALL', ...new Set(products.map(p => p.category || 'General').filter(Boolean))];

  bar.innerHTML = categories.map(cat => {
    const isAll = cat === 'ALL';
    const label = isAll ? '🌟 Todos' : cat;
    const activeClass = (state.activeExpressCategory === cat || (isAll && (!state.activeExpressCategory || state.activeExpressCategory === 'ALL')))
      ? 'bg-emerald-600 text-white shadow-sm'
      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-emerald-400';

    return `
      <button type="button" class="express-cat-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold flex-shrink-0 transition ${activeClass}" data-category="${escapeHtml(cat)}">
        ${escapeHtml(label)}
      </button>
    `;
  }).join('');

  bar.querySelectorAll('.express-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeExpressCategory = btn.dataset.category;
      renderExpressCategories(state.products || []);
      filterAndRenderExpressProducts(state.products || []);
    });
  });
}

export function filterAndRenderExpressProducts(products = state.products || []) {
  const grid = document.getElementById('express-products-grid');
  if (!grid) return;

  const query = (document.getElementById('express-search-input')?.value || '').toLowerCase().trim();
  const currentCat = state.activeExpressCategory || 'ALL';

  const filtered = products.filter(p => {
    const isAvailable = p.isAvailable !== false;
    const matchCat = currentCat === 'ALL' || p.category === currentCat;
    const matchQuery = !query ||
      (p.name || '').toLowerCase().includes(query) ||
      (p.category || '').toLowerCase().includes(query);
    return isAvailable && matchCat && matchQuery;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-8 text-center text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
        No se encontraron productos disponibles.
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const price = Number(p.salePriceCOP || p.priceCOP || p.price || 0);
    const stationBadge = p.station === 'BAR'
      ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold">🍸 Barra</span>'
      : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 font-semibold">🍳 Cocina</span>';

    // Stock Badge (respetando si el módulo inventory está habilitado para el tenant)
    const isInventoryEnabled = state.currentTenant?.enabledModules?.inventory !== false;
    let stockBadge = '';
    const isTracked = isInventoryEnabled && !!p.trackStock;
    const stockUnits = Number(p.stockUnits !== undefined ? p.stockUnits : (p.stock !== undefined ? p.stock : 0));
    const minStock = Number(p.minStockUnits ?? 5);
    const isOut = isTracked && stockUnits <= 0;

    if (isTracked) {
      if (isOut) {
        stockBadge = '<span class="text-[9px] px-1.5 py-0.2 rounded font-extrabold bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300">Agotado</span>';
      } else if (stockUnits <= minStock) {
        stockBadge = `<span class="text-[9px] px-1.5 py-0.2 rounded font-extrabold bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">Quedan ${stockUnits}</span>`;
      } else {
        stockBadge = `<span class="text-[9px] px-1.5 py-0.2 rounded font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">${stockUnits} disp.</span>`;
      }
    }

    const disabledAttr = isOut ? 'disabled' : '';
    const opacityClass = isOut ? 'opacity-50 cursor-not-allowed border-rose-300 dark:border-rose-900/40' : 'hover:border-emerald-500 hover:shadow-md';

    return `
      <button type="button" ${disabledAttr} class="btn-express-add-prod p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm transition text-left flex flex-col justify-between space-y-2 group active:scale-[0.98] ${opacityClass}" data-product-id="${p.id}">
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-1">
            <span class="text-[11px] text-slate-400 truncate">${escapeHtml(p.category || 'General')}</span>
            <div class="flex items-center gap-1">
              ${stockBadge}
              ${stationBadge}
            </div>
          </div>
          <h4 class="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug group-hover:text-emerald-600 transition">
            ${escapeHtml(p.name)}
          </h4>
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
          <span class="text-xs sm:text-sm font-extrabold font-mono text-emerald-600 dark:text-emerald-400">
            ${formatCOP(price)}
          </span>
          <span class="w-6 h-6 rounded-lg ${isOut ? 'bg-slate-200 text-slate-400' : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white'} flex items-center justify-center font-bold text-xs transition">
            ${isOut ? '✕' : '+'}
          </span>
        </div>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.btn-express-add-prod:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const prodId = btn.dataset.productId;
      const product = products.find(p => p.id === prodId);
      if (product) {
        addItemToExpressCart(product);
      }
    });
  });
}

export function addItemToExpressCart(product) {
  const isInventoryEnabled = state.currentTenant?.enabledModules?.inventory !== false;
  // Validación de stock
  if (isInventoryEnabled && product.trackStock) {
    const available = Number(product.stockUnits !== undefined ? product.stockUnits : (product.stock !== undefined ? product.stock : 0));
    const existing = expressCart.find(item => item.product.id === product.id);
    const requested = existing ? (existing.quantity + 1) : 1;
    if (requested > available) {
      showToast(`Stock insuficiente. Solo quedan ${available} unidades de ${product.name}`, 'warning');
      return;
    }
  }

  const existing = expressCart.find(item => item.product.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    expressCart.push({ product, quantity: 1 });
  }
  renderExpressCart();
}

function updateItemQuantity(productId, delta) {
  const item = expressCart.find(it => it.product.id === productId);
  if (!item) return;

  const isInventoryEnabled = state.currentTenant?.enabledModules?.inventory !== false;
  if (delta > 0 && isInventoryEnabled && item.product.trackStock) {
    const available = Number(item.product.stockUnits !== undefined ? item.product.stockUnits : (item.product.stock !== undefined ? item.product.stock : 0));
    if (item.quantity + delta > available) {
      showToast(`Stock límite alcanzado (${available} unidades)`, 'warning');
      return;
    }
  }

  item.quantity += delta;
  if (item.quantity <= 0) {
    expressCart = expressCart.filter(it => it.product.id !== productId);
  }
  renderExpressCart();
}

function removeItemFromCart(productId) {
  expressCart = expressCart.filter(it => it.product.id !== productId);
  renderExpressCart();
}

function renderExpressCart() {
  const container = document.getElementById('express-cart-items');
  const countEl = document.getElementById('express-cart-count');
  if (!container) return;

  const totalCount = expressCart.reduce((acc, it) => acc + it.quantity, 0);
  if (countEl) {
    countEl.textContent = `${totalCount} producto${totalCount === 1 ? '' : 's'}`;
  }

  if (expressCart.length === 0) {
    container.innerHTML = `
      <div class="py-10 text-center text-slate-400 dark:text-slate-500">
        <div class="text-3xl mb-1">🛒</div>
        <div class="text-xs font-medium">Toca cualquier producto para agregarlo al cobro</div>
      </div>
    `;
    calculateAndRenderTotals();
    return;
  }

  container.innerHTML = expressCart.map(it => {
    const unitPrice = Number(it.product.salePriceCOP || it.product.priceCOP || it.product.price || 0);
    const lineTotal = unitPrice * it.quantity;

    return `
      <div class="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2 text-xs">
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(it.product.name)}</div>
          <div class="text-[11px] text-slate-400 font-mono">${formatCOP(unitPrice)} c/u</div>
        </div>

        <div class="flex items-center gap-1.5 flex-shrink-0">
          <button type="button" class="btn-cart-dec w-7 h-7 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center justify-center text-xs" data-id="${it.product.id}">
            -
          </button>
          <span class="w-6 text-center font-bold text-xs">${it.quantity}</span>
          <button type="button" class="btn-cart-inc w-7 h-7 rounded-lg bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center justify-center text-xs" data-id="${it.product.id}">
            +
          </button>
        </div>

        <div class="text-right flex-shrink-0 w-20">
          <div class="font-extrabold font-mono text-slate-900 dark:text-white">${formatCOP(lineTotal)}</div>
          <button type="button" class="btn-cart-rem text-[10px] text-red-500 hover:text-red-700" data-id="${it.product.id}">
            Eliminar
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-cart-dec').forEach(btn => {
    btn.addEventListener('click', () => updateItemQuantity(btn.dataset.id, -1));
  });

  container.querySelectorAll('.btn-cart-inc').forEach(btn => {
    btn.addEventListener('click', () => updateItemQuantity(btn.dataset.id, 1));
  });

  container.querySelectorAll('.btn-cart-rem').forEach(btn => {
    btn.addEventListener('click', () => removeItemFromCart(btn.dataset.id));
  });

  calculateAndRenderTotals();
}

function getCartTotals() {
  const subtotalCOP = expressCart.reduce((acc, it) => acc + ((Number(it.product.salePriceCOP || it.product.priceCOP || it.product.price) || 0) * it.quantity), 0);
  const taxConfig = state.currentTenant?.taxConfig || {};
  const hasTax = Boolean(taxConfig.applyImpoconsumo ?? taxConfig.impoconsumo);
  const hasTip = Boolean(taxConfig.applyTip ?? taxConfig.suggestedTip);

  const tipChecked = document.getElementById('express-tip-toggle')?.checked;

  const taxRate = taxConfig.impoconsumoRate !== undefined ? Number(taxConfig.impoconsumoRate) : 0.08;
  const tipRate = taxConfig.tipRate !== undefined ? Number(taxConfig.tipRate) : 0.10;

  const taxCOP = hasTax ? Math.round(subtotalCOP * taxRate) : 0;
  const tipCOP = (hasTip && tipChecked) ? Math.round(subtotalCOP * tipRate) : 0;
  const totalCOP = subtotalCOP + taxCOP + tipCOP;

  return { subtotalCOP, taxCOP, tipCOP, totalCOP, hasTax, hasTip };
}

function calculateAndRenderTotals() {
  const totals = getCartTotals();

  const elSub = document.getElementById('express-subtotal-val');
  const elRowTax = document.getElementById('express-row-tax');
  const elTax = document.getElementById('express-tax-val');
  const elRowTip = document.getElementById('express-row-tip');
  const elTip = document.getElementById('express-tip-val');
  const elTotal = document.getElementById('express-total-val');
  const btnCheckout = document.getElementById('btn-express-checkout');

  if (elSub) elSub.textContent = formatCOP(totals.subtotalCOP);

  if (elRowTax) {
    if (totals.hasTax) {
      elRowTax.classList.remove('hidden');
      if (elTax) elTax.textContent = formatCOP(totals.taxCOP);
    } else {
      elRowTax.classList.add('hidden');
    }
  }

  if (elRowTip) {
    if (totals.hasTip) {
      elRowTip.classList.remove('hidden');
      if (elTip) elTip.textContent = formatCOP(totals.tipCOP);
    } else {
      elRowTip.classList.add('hidden');
    }
  }

  if (elTotal) elTotal.textContent = formatCOP(totals.totalCOP);

  updateCashChange();

  if (btnCheckout) {
    const hasItems = expressCart.length > 0;
    btnCheckout.disabled = !hasItems;
  }
}

function updateCashChange() {
  const totals = getCartTotals();
  const inputReceived = document.getElementById('express-cash-received');
  const displayChange = document.getElementById('express-cash-change');

  if (!displayChange) return;

  if (selectedPaymentMethod !== 'CASH') {
    displayChange.textContent = selectedPaymentMethod === 'TRANSFER' ? 'Transferencia Digital' : 'Pago Digital';
    return;
  }

  const received = Number(inputReceived?.value) || 0;
  const diff = received - totals.totalCOP;

  if (received === 0) {
    displayChange.textContent = `Devuelta: $ 0 COP`;
    displayChange.className = 'text-xs sm:text-sm font-mono font-bold text-slate-500 py-1.5';
  } else if (diff >= 0) {
    displayChange.textContent = `Devuelta: ${formatCOP(diff)}`;
    displayChange.className = 'text-xs sm:text-sm font-mono font-extrabold text-emerald-600 dark:text-emerald-400 py-1.5';
  } else {
    displayChange.textContent = `Faltan: ${formatCOP(Math.abs(diff))}`;
    displayChange.className = 'text-xs sm:text-sm font-mono font-extrabold text-red-500 py-1.5';
  }
}

// ============================================================================
// GESTIÓN DEL MODAL DE PAGO MIXTO
// ============================================================================

let mixedTargetTotal = 0;
let customMixedConfirmHandler = null;

export function openMixedPaymentModal(targetAmountCOP, context = 'EXPRESS', onConfirmHandler = null) {
  activeMixedContext = context;
  customMixedConfirmHandler = typeof onConfirmHandler === 'function' ? onConfirmHandler : null;
  mixedTargetTotal = Math.round(Number(targetAmountCOP) || 0);

  const totalTargetEl = document.getElementById('mixed-modal-total-target');
  if (totalTargetEl) totalTargetEl.textContent = formatCOP(mixedTargetTotal);

  // Limpiar inputs
  const inputs = ['mixed-amount-cash', 'mixed-amount-card', 'mixed-amount-nequi', 'mixed-amount-daviplata', 'mixed-amount-transfer'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  updateMixedModalBalances();
  openModal('modal-mixed-payment');
}

function getMixedModalValues() {
  const cash = Math.max(0, Number(document.getElementById('mixed-amount-cash')?.value) || 0);
  const card = Math.max(0, Number(document.getElementById('mixed-amount-card')?.value) || 0);
  const nequi = Math.max(0, Number(document.getElementById('mixed-amount-nequi')?.value) || 0);
  const davi = Math.max(0, Number(document.getElementById('mixed-amount-daviplata')?.value) || 0);
  const transfer = Math.max(0, Number(document.getElementById('mixed-amount-transfer')?.value) || 0);

  const nonCashAssigned = card + nequi + davi + transfer;
  const assigned = cash + nonCashAssigned;
  const diff = mixedTargetTotal - assigned;
  const changeCOP = (assigned > mixedTargetTotal && nonCashAssigned <= mixedTargetTotal)
    ? (assigned - mixedTargetTotal)
    : 0;

  const payments = [];
  if (cash > 0) payments.push({ method: 'CASH', amountCOP: cash });
  if (card > 0) payments.push({ method: 'CARD', amountCOP: card });
  if (nequi > 0) payments.push({ method: 'NEQUI', amountCOP: nequi });
  if (davi > 0) payments.push({ method: 'DAVIPLATA', amountCOP: davi });
  if (transfer > 0) payments.push({ method: 'TRANSFER', amountCOP: transfer });

  return { cash, card, nequi, davi, transfer, nonCashAssigned, assigned, diff, changeCOP, payments };
}

function updateMixedModalBalances() {
  const { nonCashAssigned, assigned, diff, changeCOP } = getMixedModalValues();

  const assignedEl = document.getElementById('mixed-modal-total-assigned');
  const dueEl = document.getElementById('mixed-modal-balance-due');
  const btnConfirm = document.getElementById('btn-confirm-mixed-payment');

  if (assignedEl) assignedEl.textContent = formatCOP(assigned);

  const hasDigitalExcess = nonCashAssigned > mixedTargetTotal;

  if (dueEl) {
    if (hasDigitalExcess) {
      dueEl.textContent = `Exceso Digital: ${formatCOP(nonCashAssigned - mixedTargetTotal)}`;
      dueEl.className = 'text-sm sm:text-base font-extrabold font-mono text-rose-600 dark:text-rose-400';
    } else if (diff === 0 && mixedTargetTotal > 0) {
      dueEl.textContent = '$ 0 COP (Exacto)';
      dueEl.className = 'text-sm sm:text-base font-extrabold font-mono text-emerald-600 dark:text-emerald-400';
    } else if (diff > 0) {
      dueEl.textContent = `Faltan: ${formatCOP(diff)}`;
      dueEl.className = 'text-sm sm:text-base font-extrabold font-mono text-rose-600 dark:text-rose-400';
    } else if (changeCOP > 0) {
      dueEl.textContent = `Devuelta: ${formatCOP(changeCOP)}`;
      dueEl.className = 'text-sm sm:text-base font-extrabold font-mono text-emerald-600 dark:text-emerald-400';
    } else {
      dueEl.textContent = '$ 0 COP';
      dueEl.className = 'text-sm sm:text-base font-extrabold font-mono text-slate-500';
    }
  }

  if (btnConfirm) {
    btnConfirm.disabled = !(mixedTargetTotal > 0 && assigned >= mixedTargetTotal && !hasDigitalExcess);
  }
}

function setupMixedPaymentModalListeners(onSaleCompleted) {
  const mixedInputs = document.querySelectorAll('.mixed-input');
  mixedInputs.forEach(input => {
    input.addEventListener('input', updateMixedModalBalances);
  });

  // Botones de llenar restante ("Resto")
  const fillBtns = document.querySelectorAll('.btn-fill-remaining');
  fillBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetInputId = btn.getAttribute('data-target-input');
      const targetInput = document.getElementById(targetInputId);
      if (!targetInput) return;

      targetInput.value = '0'; // temporal para recalcular suma ajena
      const { assigned: otherAssigned } = getMixedModalValues();
      const remaining = Math.max(0, mixedTargetTotal - otherAssigned);
      targetInput.value = remaining;
      updateMixedModalBalances();
    });
  });

  const btnConfirm = document.getElementById('btn-confirm-mixed-payment');
  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      if (activeMixedContext === 'EXPRESS') {
        await executeMixedExpressSale(onSaleCompleted);
      } else if (activeMixedContext === 'BILLING' && typeof customMixedConfirmHandler === 'function') {
        const meta = getMixedModalValues();
        if (meta.payments.length > 0) {
          await customMixedConfirmHandler(meta.payments, meta);
        }
      }
    });
  }
}

async function executeMixedExpressSale(onSaleCompleted) {
  const { cash, assigned, changeCOP, payments } = getMixedModalValues();

  const totals = getCartTotals();
  const customerNote = document.getElementById('express-customer-note')?.value.trim();
  const tipToggle = document.getElementById('express-tip-toggle');

  const payload = {
    customerName: customerNote || 'Cliente Mostrador',
    customerNote: customerNote || '',
    items: expressCart.map(it => ({
      productId: it.product.id,
      quantity: it.quantity,
      unitPriceCOP: Number(it.product.salePriceCOP || it.product.priceCOP || it.product.price || 0),
      productName: it.product.name
    })),
    paymentMethod: payments.length > 1 ? 'MIXED' : (payments[0]?.method || 'CASH'),
    payments,
    amountPaidCOP: assigned,
    includeTip: Boolean(tipToggle?.checked)
  };

  try {
    let result = null;
    let res = null;
    try {
      res = await apiFetch('/api/billing/express-checkout', {
        method: 'POST',
        body: payload
      });
    } catch (_) {
      res = null;
    }

    if (res) {
      if (res.ok) {
        result = await res.json();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al procesar cobro combinado');
      }
    } else {
      result = processOfflineSale(payload, totals);
    }

    if (result) {
      closeModal('modal-mixed-payment');
      showToast('¡Pago combinado procesado con éxito!', 'success');

      // Actualizar stock local si el módulo inventory está habilitado y el producto se rastrea
      const isInventoryEnabled = state.currentTenant?.enabledModules?.inventory !== false;
      if (isInventoryEnabled) {
        payload.items.forEach(it => {
          const p = (state.products || []).find(prod => String(prod.id) === String(it.productId));
          if (p && p.trackStock && p.stockUnits !== undefined) {
            p.stockUnits = Math.max(0, p.stockUnits - it.quantity);
          }
        });
      }
      filterAndRenderExpressProducts();

      const finalPayments = result.payments || result.invoice?.payments || payments;
      const finalChange = result.changeCOP ?? result.invoice?.changeCOP ?? changeCOP;

      // Tirilla térmica
      const printableContainer = document.getElementById('receipt-printable-content');
      if (printableContainer) {
        printableContainer.innerHTML = renderThermalReceipt({
          tenant: state.currentTenant || {},
          invoiceNumber: result.invoice?.invoiceNumber || result.invoiceNumber || `EXP-${Date.now().toString().slice(-4)}`,
          date: new Date(),
          tableNumber: null,
          waiter: state.currentUser?.name || 'Cajero Express',
          customerName: customerNote || null,
          items: payload.items,
          subtotalCOP: totals.subtotalCOP,
          taxCOP: totals.taxCOP,
          hasTax: totals.hasTax,
          tipCOP: totals.tipCOP,
          hasTip: totals.hasTip,
          totalCOP: totals.totalCOP,
          paymentMethod: finalPayments.length > 1 ? 'MIXED' : (finalPayments[0]?.method || 'MIXED'),
          payments: finalPayments,
          cashReceived: cash > 0 ? cash : null,
          cashChange: finalChange > 0 ? finalChange : null
        });
      }

      openModal('modal-receipt');

      // Limpiar canasta
      expressCart = [];
      const noteInput = document.getElementById('express-customer-note');
      if (noteInput) noteInput.value = '';
      renderExpressCart();

      if (typeof onSaleCompleted === 'function') {
        onSaleCompleted(result);
      }
    }
  } catch (err) {
    showToast(err.message || 'Error en pago combinado', 'alert');
  }
}

async function executeExpressCheckout(onSaleCompleted) {
  if (expressCart.length === 0) {
    showToast('La canasta está vacía', 'alert');
    return;
  }

  const totals = getCartTotals();
  const inputReceived = document.getElementById('express-cash-received');
  const customerNote = document.getElementById('express-customer-note')?.value.trim();
  const tipToggle = document.getElementById('express-tip-toggle');
  const btnCheckout = document.getElementById('btn-express-checkout');

  const cashReceived = selectedPaymentMethod === 'CASH'
    ? (Number(inputReceived?.value) || totals.totalCOP)
    : totals.totalCOP;

  if (selectedPaymentMethod === 'CASH' && cashReceived < totals.totalCOP) {
    showToast('El dinero recibido es menor que el total a cobrar', 'alert');
    return;
  }

  if (btnCheckout) {
    btnCheckout.disabled = true;
    btnCheckout.innerHTML = `<span>Procesando cobro...</span>`;
  }

  const payload = {
    customerName: customerNote || 'Cliente Mostrador',
    customerNote: customerNote || '',
    items: expressCart.map(it => ({
      productId: it.product.id,
      quantity: it.quantity,
      unitPriceCOP: Number(it.product.salePriceCOP || it.product.priceCOP || it.product.price || 0),
      productName: it.product.name
    })),
    paymentMethod: selectedPaymentMethod,
    payments: [{ method: selectedPaymentMethod, amountCOP: totals.totalCOP }],
    amountPaidCOP: cashReceived,
    cashReceivedCOP: cashReceived,
    includeTip: Boolean(tipToggle?.checked)
  };

  try {
    let result = null;
    let res = null;
    try {
      res = await apiFetch('/api/billing/express-checkout', {
        method: 'POST',
        body: payload
      });
    } catch (_) {
      res = null;
    }

    if (res) {
      if (res.ok) {
        result = await res.json();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al procesar el cobro');
      }
    } else {
      result = processOfflineSale(payload, totals);
    }

    if (result) {
      showToast('¡Cobro realizado con éxito!', 'success');

      // Actualizar stock local si el módulo inventory está habilitado y se rastrea
      const isInventoryEnabled = state.currentTenant?.enabledModules?.inventory !== false;
      if (isInventoryEnabled) {
        payload.items.forEach(it => {
          const p = (state.products || []).find(prod => String(prod.id) === String(it.productId));
          if (p && p.trackStock && p.stockUnits !== undefined) {
            p.stockUnits = Math.max(0, p.stockUnits - it.quantity);
          }
        });
      }
      filterAndRenderExpressProducts();

      // Preparar y mostrar tirilla térmica en modal
      const printableContainer = document.getElementById('receipt-printable-content');
      if (printableContainer) {
        printableContainer.innerHTML = renderThermalReceipt({
          tenant: state.currentTenant || {},
          invoiceNumber: result.invoice?.invoiceNumber || result.invoiceNumber || `EXP-${Date.now().toString().slice(-4)}`,
          date: new Date(),
          tableNumber: null,
          waiter: state.currentUser?.name || 'Cajero Express',
          customerName: customerNote || null,
          items: payload.items,
          subtotalCOP: totals.subtotalCOP,
          taxCOP: totals.taxCOP,
          hasTax: totals.hasTax,
          tipCOP: totals.tipCOP,
          hasTip: totals.hasTip,
          totalCOP: totals.totalCOP,
          paymentMethod: selectedPaymentMethod,
          payments: payload.payments,
          cashReceived: selectedPaymentMethod === 'CASH' ? cashReceived : null,
          cashChange: selectedPaymentMethod === 'CASH' ? (result.changeCOP ?? (cashReceived - totals.totalCOP)) : null
        });
      }

      openModal('modal-receipt');

      // Limpiar canasta
      expressCart = [];
      const noteInput = document.getElementById('express-customer-note');
      if (noteInput) noteInput.value = '';
      if (inputReceived) inputReceived.value = '';
      renderExpressCart();

      if (typeof onSaleCompleted === 'function') {
        onSaleCompleted(result);
      }
    }
  } catch (err) {
    showToast(err.message || 'Error al procesar cobro', 'alert');
  } finally {
    if (btnCheckout) {
      btnCheckout.disabled = false;
      btnCheckout.innerHTML = `<span>⚡</span><span>COBRAR AHORA</span>`;
    }
  }
}

function processOfflineSale(payload, totals) {
  const db = initOfflineDb();
  const invoiceNumber = `REC-${Date.now().toString().slice(-4)}`;
  const inv = {
    id: `inv-${Date.now()}`,
    tenantId: state.currentTenant?.id || 'tenant-default',
    invoiceNumber,
    subtotalCOP: totals.subtotalCOP,
    taxCOP: totals.taxCOP,
    tipCOP: totals.tipCOP,
    totalCOP: totals.totalCOP,
    paymentMethod: payload.paymentMethod,
    payments: payload.payments,
    amountPaidCOP: payload.amountPaidCOP,
    createdAt: new Date().toISOString(),
    items: payload.items
  };
  if (!Array.isArray(db.invoices)) db.invoices = [];
  db.invoices.push(inv);
  saveOfflineDb(db);

  return { success: true, invoice: inv };
}

