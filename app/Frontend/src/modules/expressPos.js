/**
 * HERA CLOUD POS - Express POS Module (ES6)
 * Cobro ultrarrápido de mostrador, catálogo táctil, carrito reactivo,
 * cálculo de Impoconsumo (8%), Propina (10%), calculadora de billetes COP y ticket térmico.
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, showToast, openModal, closeModal, renderThermalReceipt, escapeHtml } from '../utils.js';

let expressCart = []; // [{ product, quantity }]
let selectedPaymentMethod = 'CASH';

export function setupExpressPos({ onSaleCompleted, onOpenProductModal }) {
  const searchInput = document.getElementById('express-search-input');
  const btnClear = document.getElementById('btn-express-clear');
  const tipToggle = document.getElementById('express-tip-toggle');
  const cashReceivedInput = document.getElementById('express-cash-received');
  const btnCheckout = document.getElementById('btn-express-checkout');
  const btnQuickProd = document.getElementById('btn-express-quick-product');

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
    const price = Number(p.salePriceCOP || 0);
    const stationBadge = p.station === 'BAR'
      ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold">🍸 Barra</span>'
      : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 font-semibold">🍳 Cocina</span>';

    return `
      <button type="button" class="btn-express-add-prod p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:border-emerald-500 hover:shadow-md transition text-left flex flex-col justify-between space-y-2 group active:scale-[0.98]" data-product-id="${p.id}">
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-1">
            <span class="text-[11px] text-slate-400 truncate">${escapeHtml(p.category || 'General')}</span>
            ${stationBadge}
          </div>
          <h4 class="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug group-hover:text-emerald-600 transition">
            ${escapeHtml(p.name)}
          </h4>
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
          <span class="text-xs sm:text-sm font-extrabold font-mono text-emerald-600 dark:text-emerald-400">
            ${formatCOP(price)}
          </span>
          <span class="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs group-hover:bg-emerald-600 group-hover:text-white transition">
            +
          </span>
        </div>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.btn-express-add-prod').forEach(btn => {
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
    const unitPrice = Number(it.product.salePriceCOP || 0);
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
  const subtotalCOP = expressCart.reduce((acc, it) => acc + ((Number(it.product.salePriceCOP) || 0) * it.quantity), 0);
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
  const btnCheckout = document.getElementById('btn-express-checkout');

  if (!displayChange) return;

  if (selectedPaymentMethod !== 'CASH') {
    displayChange.textContent = 'Pago Digital';
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
      unitPriceCOP: Number(it.product.salePriceCOP || 0),
      productName: it.product.name
    })),
    paymentMethod: selectedPaymentMethod,
    amountPaidCOP: cashReceived,
    cashReceivedCOP: cashReceived,
    includeTip: Boolean(tipToggle?.checked)
  };

  try {
    let result = null;
    try {
      const res = await apiFetch('/api/billing/express-checkout', {
        method: 'POST',
        body: payload
      });

      if (res.ok) {
        result = await res.json();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al procesar el cobro');
      }
    } catch (apiErr) {
      // Fallback offline
      result = processOfflineSale(payload, totals);
    }

    if (result) {
      showToast('¡Cobro realizado con éxito!', 'success');

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
    amountPaidCOP: payload.amountPaidCOP,
    createdAt: new Date().toISOString(),
    items: payload.items
  };
  if (!Array.isArray(db.invoices)) db.invoices = [];
  db.invoices.push(inv);
  saveOfflineDb(db);

  return { success: true, invoice: inv };
}
