/**
 * HERA CLOUD POS - Billing & Multi-Split Module (ES6)
 * Facturación de mesas, cálculo de Impoconsumo (8%), Propina (10%),
 * división de cuenta (Única, Equitativa y Por Ítems) y tirilla térmica.
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, showToast, openModal, closeModal, renderThermalReceipt, escapeHtml } from '../utils.js';

let activeSplitType = 'SINGLE'; // 'SINGLE' | 'EQUAL' | 'ITEMS'
let selectedPaymentMethod = 'CASH';
let previewData = null;
let currentDinersCount = 2;
let itemAssignments = {}; // { itemIndex: dinerNumber }

export function setupBillingModule({ onCheckoutCompleted }) {
  const tableSelect = document.getElementById('billing-table-select');
  const tipSwitch = document.getElementById('tip-switch');
  const btnCheckout = document.getElementById('btn-execute-checkout');
  const cashReceivedInput = document.getElementById('cash-received-input');

  // Tabs de División de Cuenta
  const tabNone = document.getElementById('split-tab-none');
  const tabEqual = document.getElementById('split-tab-equal');
  const tabItems = document.getElementById('split-tab-items');
  const panelEqual = document.getElementById('split-panel-equal');
  const panelItems = document.getElementById('split-panel-items');

  function setSplitTab(type) {
    activeSplitType = type;
    [tabNone, tabEqual, tabItems].forEach(t => {
      if (t) {
        t.classList.remove('active', 'bg-indigo-600', 'text-white');
        t.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
      }
    });

    if (panelEqual) panelEqual.classList.add('hidden');
    if (panelItems) panelItems.classList.add('hidden');

    if (type === 'SINGLE' && tabNone) {
      tabNone.classList.add('active', 'bg-indigo-600', 'text-white');
    } else if (type === 'EQUAL' && tabEqual) {
      tabEqual.classList.add('active', 'bg-indigo-600', 'text-white');
      if (panelEqual) panelEqual.classList.remove('hidden');
    } else if (type === 'ITEMS' && tabItems) {
      tabItems.classList.add('active', 'bg-indigo-600', 'text-white');
      if (panelItems) panelItems.classList.remove('hidden');
      renderSplitItemsAssignment();
    }
  }

  if (tabNone) tabNone.addEventListener('click', () => setSplitTab('SINGLE'));
  if (tabEqual) tabEqual.addEventListener('click', () => setSplitTab('EQUAL'));
  if (tabItems) tabItems.addEventListener('click', () => setSplitTab('ITEMS'));

  // Split Equitativo
  const btnCalcEqual = document.getElementById('btn-calc-split-equal');
  if (btnCalcEqual) {
    btnCalcEqual.addEventListener('click', () => calculateSplitEqual());
  }

  // Split por Ítems
  const btnDecDiners = document.getElementById('btn-split-items-dec');
  const btnIncDiners = document.getElementById('btn-split-items-inc');
  const inputDiners = document.getElementById('split-items-diners-count');
  const btnCalcItems = document.getElementById('btn-calc-split-items');

  if (btnDecDiners) {
    btnDecDiners.addEventListener('click', () => {
      if (currentDinersCount > 2) {
        currentDinersCount -= 1;
        if (inputDiners) inputDiners.value = currentDinersCount;
        renderSplitItemsAssignment();
      }
    });
  }

  if (btnIncDiners) {
    btnIncDiners.addEventListener('click', () => {
      if (currentDinersCount < 10) {
        currentDinersCount += 1;
        if (inputDiners) inputDiners.value = currentDinersCount;
        renderSplitItemsAssignment();
      }
    });
  }

  if (btnCalcItems) {
    btnCalcItems.addEventListener('click', () => calculateSplitItems());
  }

  if (tableSelect) {
    tableSelect.addEventListener('change', () => {
      state.selectedTableId = tableSelect.value || null;
      loadBillingPreview();
    });
  }

  if (tipSwitch) {
    tipSwitch.addEventListener('change', () => {
      renderInvoiceTotals();
    });
  }

  if (cashReceivedInput) {
    cashReceivedInput.addEventListener('input', () => updateCashChange());
  }

  // Métodos de pago
  const payButtons = document.querySelectorAll('.btn-payment-method');
  payButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      payButtons.forEach(b => {
        b.classList.remove('active', 'border-indigo-600', 'bg-indigo-50', 'text-indigo-700');
        b.classList.add('border-slate-200', 'dark:border-slate-700');
      });
      btn.classList.add('active', 'border-indigo-600', 'bg-indigo-50', 'text-indigo-700');
      btn.classList.remove('border-slate-200', 'dark:border-slate-700');

      selectedPaymentMethod = btn.dataset.method || 'CASH';
      updateCashChange();
    });
  });

  if (btnCheckout) {
    btnCheckout.addEventListener('click', () => executeCheckout(onCheckoutCompleted));
  }
}

export function populateBillingSelect(targetTableId = null) {
  const select = document.getElementById('billing-table-select');
  if (!select) return;

  const tables = state.tables || [];
  const activeTables = tables.filter(t => t.status === 'OCCUPIED' || t.status === 'PAYING');

  select.innerHTML = `
    <option value="">-- Selecciona una Mesa Ocupada --</option>
    ${activeTables.map(t => {
      const isSelected = (targetTableId === t.id || state.selectedTableId === t.id) ? 'selected' : '';
      return `<option value="${t.id}" ${isSelected}>Mesa #${t.number} - ${t.zone} (${t.status})</option>`;
    }).join('')}
  `;

  if (targetTableId || state.selectedTableId) {
    state.selectedTableId = targetTableId || state.selectedTableId;
    loadBillingPreview();
  }
}

export async function loadBillingPreview() {
  const table = (state.tables || []).find(t => t.id === state.selectedTableId);
  const metaEl = document.getElementById('inv-table-meta');
  const itemsContainer = document.getElementById('invoice-items-list');

  if (!table || !table.currentSessionId) {
    if (metaEl) metaEl.textContent = 'Selecciona una mesa ocupada';
    if (itemsContainer) {
      itemsContainer.innerHTML = `
        <div class="py-12 text-center text-xs text-slate-400">
          No hay una cuenta activa seleccionada.
        </div>
      `;
    }
    previewData = null;
    renderInvoiceTotals();
    return;
  }

  if (metaEl) metaEl.textContent = `Mesa #${table.number} - ${table.zone} · Sesión activa`;

  try {
    const res = await apiFetch(`/api/billing/preview/${table.currentSessionId}`);
    if (res.ok) {
      previewData = await res.json();
      renderPreviewItems();
      renderInvoiceTotals();
      return;
    }
  } catch (_) {
    // Modo Offline
  }

  // Fallback offline
  previewData = generateOfflinePreview(table);
  renderPreviewItems();
  renderInvoiceTotals();
}

function renderPreviewItems() {
  const container = document.getElementById('invoice-items-list');
  if (!container || !previewData) return;

  const items = previewData.items || [];
  if (items.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-xs text-slate-400">
        Esta mesa aún no tiene artículos comandados.
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(it => {
    const unitPrice = Number(it.unitPriceCOP || 0);
    const lineTotal = Number(it.subtotalCOP || (it.quantity * unitPrice));

    return `
      <div class="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-800 dark:text-slate-100 truncate">${it.quantity}x ${escapeHtml(it.productName)}</div>
          <div class="text-[11px] font-mono text-slate-400">${formatCOP(unitPrice)} c/u</div>
        </div>
        <div class="font-mono font-extrabold text-slate-900 dark:text-white">
          ${formatCOP(lineTotal)}
        </div>
      </div>
    `;
  }).join('');
}

function renderInvoiceTotals() {
  const elSub = document.getElementById('inv-subtotal-val');
  const elTax = document.getElementById('inv-tax-val');
  const elTip = document.getElementById('inv-tip-val');
  const elTotal = document.getElementById('inv-grand-total-val');
  const tipSwitch = document.getElementById('tip-switch');
  const rowTax = document.getElementById('inv-row-tax');
  const rowTip = document.getElementById('inv-row-tip');
  const boxTip = document.getElementById('tip-toggle-box');

  if (!previewData) {
    if (elSub) elSub.textContent = '$ 0 COP';
    if (elTax) elTax.textContent = '$ 0 COP';
    if (elTip) elTip.textContent = '$ 0 COP';
    if (elTotal) elTotal.textContent = '$ 0 COP';
    if (rowTax) rowTax.classList.add('hidden');
    if (rowTip) rowTip.classList.add('hidden');
    if (boxTip) boxTip.classList.add('hidden');
    return;
  }

  const subtotalCOP = previewData.subtotalCOP || 0;
  const taxConfig = state.currentTenant?.taxConfig || previewData.taxConfig || {};
  const hasTax = Boolean(taxConfig.applyImpoconsumo ?? taxConfig.impoconsumo);
  const hasTip = Boolean(taxConfig.applyTip ?? taxConfig.suggestedTip);

  const taxRate = taxConfig.impoconsumoRate !== undefined ? Number(taxConfig.impoconsumoRate) : 0.08;
  const tipRate = taxConfig.tipRate !== undefined ? Number(taxConfig.tipRate) : 0.10;

  const taxCOP = hasTax ? Math.round(subtotalCOP * taxRate) : 0;
  const tipCOP = (hasTip && tipSwitch?.checked) ? Math.round(subtotalCOP * tipRate) : 0;
  const totalCOP = subtotalCOP + taxCOP + tipCOP;

  if (rowTax) {
    if (hasTax) rowTax.classList.remove('hidden');
    else rowTax.classList.add('hidden');
  }

  if (boxTip) {
    if (hasTip) boxTip.classList.remove('hidden');
    else boxTip.classList.add('hidden');
  }

  if (rowTip) {
    if (hasTip && tipSwitch?.checked) rowTip.classList.remove('hidden');
    else rowTip.classList.add('hidden');
  }

  if (elSub) elSub.textContent = formatCOP(subtotalCOP);
  if (elTax) elTax.textContent = formatCOP(taxCOP);
  if (elTip) elTip.textContent = formatCOP(tipCOP);
  if (elTotal) elTotal.textContent = formatCOP(totalCOP);

  updateCashChange();
}

function updateCashChange() {
  const inputReceived = document.getElementById('cash-received-input');
  const displayChange = document.getElementById('cash-change-display');

  if (!displayChange) return;

  if (selectedPaymentMethod !== 'CASH') {
    displayChange.textContent = 'Pago Digital';
    return;
  }

  const elTotal = document.getElementById('inv-grand-total-val');
  const totalText = elTotal?.textContent || '0';
  const totalNum = Number(totalText.replace(/[^0-9]/g, '')) || 0;

  const received = Number(inputReceived?.value) || 0;
  const diff = received - totalNum;

  if (received === 0) {
    displayChange.textContent = '$ 0 COP';
  } else if (diff >= 0) {
    displayChange.textContent = formatCOP(diff);
  } else {
    displayChange.textContent = `Faltan: ${formatCOP(Math.abs(diff))}`;
  }
}

async function calculateSplitEqual() {
  if (!previewData) return;
  const diners = Number(document.getElementById('split-equal-diners')?.value) || 2;
  const includeTip = Boolean(document.getElementById('tip-switch')?.checked);
  const resultDiv = document.getElementById('split-equal-result');

  try {
    const res = await apiFetch('/api/billing/split-equal', {
      method: 'POST',
      body: {
        sessionId: previewData.sessionId,
        dinersCount: diners,
        includeTip
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (resultDiv) {
        resultDiv.innerHTML = `
          <div class="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-xs space-y-1">
            <div class="text-slate-500 font-semibold">${diners} partes iguales:</div>
            <div class="text-base font-extrabold font-mono text-indigo-600 dark:text-indigo-400">
              ${formatCOP(data.amountPerDinerCOP)} c/u
            </div>
            <div class="text-[10px] text-slate-400">Total mesa: ${formatCOP(data.totalCOP)}</div>
          </div>
        `;
      }
      return;
    }
  } catch (_) {}

  // Fallback local
  const totals = calculateCurrentTotals();
  const perDiner = Math.round(totals.totalCOP / diners);
  if (resultDiv) {
    resultDiv.innerHTML = `
      <div class="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-xs space-y-1">
        <div class="text-slate-500 font-semibold">${diners} partes iguales:</div>
        <div class="text-base font-extrabold font-mono text-indigo-600 dark:text-indigo-400">
          ${formatCOP(perDiner)} c/u
        </div>
      </div>
    `;
  }
}

function renderSplitItemsAssignment() {
  const container = document.getElementById('split-items-assignment-list');
  if (!container || !previewData) return;

  const items = previewData.items || [];
  if (items.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-400">Sin artículos en la comanda</div>`;
    return;
  }

  container.innerHTML = items.map((it, idx) => {
    const assigned = itemAssignments[idx] || 1;
    let options = '';
    for (let d = 1; d <= currentDinersCount; d++) {
      options += `<option value="${d}" ${assigned === d ? 'selected' : ''}>Comensal ${d}</option>`;
    }

    return `
      <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-white dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 text-xs">
        <span class="font-bold truncate flex-1">${it.quantity}x ${escapeHtml(it.productName)}</span>
        <select class="split-diner-sel px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-500 bg-slate-50 dark:bg-slate-800 text-xs" data-item-idx="${idx}">
          ${options}
        </select>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.split-diner-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      itemAssignments[sel.dataset.itemIdx] = Number(sel.value);
    });
  });
}

async function calculateSplitItems() {
  if (!previewData) return;
  const includeTip = Boolean(document.getElementById('tip-switch')?.checked);
  const container = document.getElementById('split-items-results-container');

  const assignments = {};
  const items = previewData.items || [];
  items.forEach((it, idx) => {
    assignments[idx] = itemAssignments[idx] || 1;
  });

  try {
    const res = await apiFetch('/api/billing/split-by-items', {
      method: 'POST',
      body: {
        sessionId: previewData.sessionId,
        dinersCount: currentDinersCount,
        assignments,
        includeTip
      }
    });

    if (res.ok) {
      const data = await res.json();
      renderSplitItemsBreakdown(data.subInvoices || []);
      return;
    }
  } catch (_) {}

  // Fallback local
  const localSubInvoices = [];
  for (let d = 1; d <= currentDinersCount; d++) {
    let sub = 0;
    items.forEach((it, idx) => {
      if ((itemAssignments[idx] || 1) === d) {
        sub += (Number(it.unitPriceCOP) || 0) * (it.quantity || 1);
      }
    });
    const tax = state.currentTenant?.taxConfig?.impoconsumo ? Math.round(sub * 0.08) : 0;
    const tip = (state.currentTenant?.taxConfig?.suggestedTip && includeTip) ? Math.round(sub * 0.10) : 0;
    localSubInvoices.push({
      dinerNumber: d,
      subtotalCOP: sub,
      taxCOP: tax,
      tipCOP: tip,
      totalCOP: sub + tax + tip
    });
  }
  renderSplitItemsBreakdown(localSubInvoices);
}

function renderSplitItemsBreakdown(subInvoices) {
  const container = document.getElementById('split-items-results-container');
  if (!container) return;

  container.innerHTML = subInvoices.map(sub => `
    <div class="p-2.5 rounded-xl bg-white dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 flex items-center justify-between text-xs">
      <div>
        <span class="font-bold text-slate-800 dark:text-slate-100">Comensal #${sub.dinerNumber}</span>
        <div class="text-[10px] text-slate-400">Neto: ${formatCOP(sub.subtotalCOP)}</div>
      </div>
      <div class="text-right">
        <div class="font-bold font-mono text-indigo-600 dark:text-indigo-400">${formatCOP(sub.totalCOP)}</div>
      </div>
    </div>
  `).join('');
}

function calculateCurrentTotals() {
  const subtotalCOP = previewData?.subtotalCOP || 0;
  const tipChecked = document.getElementById('tip-switch')?.checked;
  const taxConfig = state.currentTenant?.taxConfig || previewData?.taxConfig || {};
  const hasTax = Boolean(taxConfig.applyImpoconsumo ?? taxConfig.impoconsumo);
  const hasTip = Boolean(taxConfig.applyTip ?? taxConfig.suggestedTip);

  const taxRate = taxConfig.impoconsumoRate !== undefined ? Number(taxConfig.impoconsumoRate) : 0.08;
  const tipRate = taxConfig.tipRate !== undefined ? Number(taxConfig.tipRate) : 0.10;

  const taxCOP = hasTax ? Math.round(subtotalCOP * taxRate) : 0;
  const tipCOP = (hasTip && tipChecked) ? Math.round(subtotalCOP * tipRate) : 0;
  const totalCOP = subtotalCOP + taxCOP + tipCOP;

  return { subtotalCOP, taxCOP, tipCOP, totalCOP };
}

async function executeCheckout(onCheckoutCompleted) {
  if (!previewData) {
    showToast('No hay una cuenta activa para cobrar', 'alert');
    return;
  }

  const totals = calculateCurrentTotals();
  const inputReceived = document.getElementById('cash-received-input');
  const tipSwitch = document.getElementById('tip-switch');
  const btnCheckout = document.getElementById('btn-execute-checkout');

  const cashReceived = selectedPaymentMethod === 'CASH'
    ? (Number(inputReceived?.value) || totals.totalCOP)
    : totals.totalCOP;

  if (selectedPaymentMethod === 'CASH' && cashReceived < totals.totalCOP) {
    showToast('El dinero recibido no cubre el total de la cuenta', 'alert');
    return;
  }

  if (btnCheckout) {
    btnCheckout.disabled = true;
    btnCheckout.innerHTML = `<span>Procesando cobro...</span>`;
  }

  const payload = {
    sessionId: previewData.sessionId,
    tableId: state.selectedTableId,
    items: previewData.items || [],
    payments: [{
      method: selectedPaymentMethod,
      amountCOP: totals.totalCOP
    }],
    paymentMethod: selectedPaymentMethod,
    amountPaidCOP: cashReceived,
    cashReceivedCOP: cashReceived,
    dinersCount: activeSplitType === 'EQUAL' ? Number(document.getElementById('split-equal-diners')?.value || 2) : 1,
    includeTip: Boolean(tipSwitch?.checked),
    splitType: activeSplitType
  };

  try {
    let result = null;
    try {
      const res = await apiFetch('/api/billing/checkout', {
        method: 'POST',
        body: payload
      });

      if (res.ok) {
        result = await res.json();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error en checkout');
      }
    } catch (apiErr) {
      // Fallback offline
      result = processOfflineTableCheckout(previewData, payload, totals);
    }

    if (result) {
      showToast('¡Mesa cobrada exitosamente!', 'success');

      // Mostrar tirilla térmica
      const printableContainer = document.getElementById('receipt-printable-content');
      if (printableContainer) {
        printableContainer.innerHTML = renderThermalReceipt({
          tenant: state.currentTenant || {},
          invoiceNumber: result.invoice?.invoiceNumber || result.invoiceNumber || `FAC-${Date.now().toString().slice(-4)}`,
          date: new Date(),
          tableNumber: previewData.tableNumber || 1,
          waiter: state.currentUser?.name || 'Mesero de Turno',
          items: previewData.items || [],
          subtotalCOP: totals.subtotalCOP,
          taxCOP: totals.taxCOP,
          hasTax: Boolean(totals.taxCOP),
          tipCOP: totals.tipCOP,
          hasTip: Boolean(totals.tipCOP),
          totalCOP: totals.totalCOP,
          paymentMethod: selectedPaymentMethod,
          cashReceived: selectedPaymentMethod === 'CASH' ? cashReceived : null,
          cashChange: selectedPaymentMethod === 'CASH' ? (result.changeCOP ?? (cashReceived - totals.totalCOP)) : null
        });
      }

      openModal('modal-receipt');

      // Liberar mesa localmente
      const tbl = (state.tables || []).find(t => t.id === state.selectedTableId);
      if (tbl) {
        tbl.status = 'AVAILABLE';
        tbl.currentSessionId = null;
      }

      state.selectedTableId = null;
      previewData = null;
      populateBillingSelect();

      if (typeof onCheckoutCompleted === 'function') {
        onCheckoutCompleted(result);
      }
    }
  } catch (err) {
    showToast(err.message || 'Error en facturación', 'alert');
  } finally {
    if (btnCheckout) {
      btnCheckout.disabled = false;
      btnCheckout.innerHTML = `<span>Procesar Pago & Liberar Mesa</span><span class="text-base">→</span>`;
    }
  }
}

function generateOfflinePreview(table) {
  const db = initOfflineDb();
  const kds = (db.kdsOrders || []).filter(o => o.tableNumber === table.number && o.status !== 'CANCELLED');

  const items = [];
  kds.forEach(o => {
    (o.items || []).forEach(it => {
      items.push({
        productName: it.productName || it.name,
        quantity: it.quantity || 1,
        unitPriceCOP: it.unitPriceCOP || 32000,
        subtotalCOP: (it.quantity || 1) * (it.unitPriceCOP || 32000)
      });
    });
  });

  const subtotalCOP = items.reduce((acc, it) => acc + it.subtotalCOP, 0);

  return {
    sessionId: table.currentSessionId || `sess-${table.id}`,
    tableNumber: table.number,
    items,
    subtotalCOP,
    taxConfig: state.currentTenant?.taxConfig || { impoconsumo: true, suggestedTip: true }
  };
}

function processOfflineTableCheckout(preview, payload, totals) {
  const db = initOfflineDb();
  const invNumber = `FAC-${Date.now().toString().slice(-4)}`;

  const inv = {
    id: `inv-${Date.now()}`,
    tenantId: state.currentTenant?.id || 'tenant-default',
    invoiceNumber: invNumber,
    tableNumber: preview.tableNumber,
    sessionId: preview.sessionId,
    subtotalCOP: totals.subtotalCOP,
    taxCOP: totals.taxCOP,
    tipCOP: totals.tipCOP,
    totalCOP: totals.totalCOP,
    paymentMethod: payload.paymentMethod,
    amountPaidCOP: payload.amountPaidCOP,
    splitType: payload.splitType,
    createdAt: new Date().toISOString(),
    items: preview.items
  };

  if (!Array.isArray(db.invoices)) db.invoices = [];
  db.invoices.push(inv);

  // Liberar mesa en DB local
  const tbl = (db.tables || []).find(t => t.number === preview.tableNumber);
  if (tbl) {
    tbl.status = 'AVAILABLE';
    tbl.currentSessionId = null;
  }
  saveOfflineDb(db);

  return { success: true, invoice: inv };
}
