/**
 * HERA CLOUD POS - Sales Analytics & CSV Export Module (ES6)
 * Reportes de facturación en tiempo real, KPIs ejecutivos, producto más vendido,
 * ranking con barra de progreso nativa (0 inline styles) y exportación compatible con Excel (BOM UTF-8).
 */

import { state, initOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, formatDateCO, formatTimeCO, formatDateTimeCO, showToast, downloadCsvBlob, openModal, renderThermalReceipt, escapeHtml } from '../utils.js';

let activePeriod = 'TODAY';
let cachedSummary = null;

export function setupSalesModule() {
  const btnExportCsv = document.getElementById('btn-export-sales-csv');
  const periodButtons = document.querySelectorAll('.sales-period-btn');
  const btnFilter = document.getElementById('btn-sales-filter');
  const dateFrom = document.getElementById('sales-date-from');
  const dateTo = document.getElementById('sales-date-to');

  // Inicializar inputs de fecha con fecha actual de Colombia
  const todayStr = getTodayBogotaStr();
  if (dateFrom && !dateFrom.value) dateFrom.value = todayStr;
  if (dateTo && !dateTo.value) dateTo.value = todayStr;

  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => handleExportCsv());
  }

  periodButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      periodButtons.forEach(b => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.classList.add('bg-slate-100', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-200');
      });
      btn.classList.add('active', 'bg-indigo-600', 'text-white');
      btn.classList.remove('bg-slate-100', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-200');

      activePeriod = btn.dataset.period || 'TODAY';
      applyQuickPeriodDates(activePeriod);
      loadSalesSummary();
    });
  });

  if (btnFilter) {
    btnFilter.addEventListener('click', () => {
      activePeriod = 'CUSTOM';
      periodButtons.forEach(b => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.classList.add('bg-slate-100', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-200');
      });
      loadSalesSummary();
    });
  }
}

function getTodayBogotaStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function applyQuickPeriodDates(period) {
  const fromEl = document.getElementById('sales-date-from');
  const toEl = document.getElementById('sales-date-to');
  if (!fromEl || !toEl) return;

  const todayStr = getTodayBogotaStr();

  if (period === 'TODAY') {
    fromEl.value = todayStr;
    toEl.value = todayStr;
  } else if (period === '7DAYS') {
    const now = new Date();
    const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const pastStr = past.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    fromEl.value = pastStr;
    toEl.value = todayStr;
  } else if (period === 'MONTH') {
    const now = new Date();
    const yearMonth = now.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
    fromEl.value = `${yearMonth}-01`;
    toEl.value = todayStr;
  } else if (period === 'ALL') {
    fromEl.value = '2026-01-01';
    toEl.value = todayStr;
  }
}

export async function loadSalesSummary() {
  const from = document.getElementById('sales-date-from')?.value || getTodayBogotaStr();
  const to = document.getElementById('sales-date-to')?.value || getTodayBogotaStr();

  try {
    const res = await apiFetch(`/api/sales/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (res.ok) {
      const data = await res.json();
      cachedSummary = data;
      renderSalesData(data);
      return;
    }
  } catch (_) {
    // Modo Offline / Fallback
  }

  // Fallback offline
  const offlineData = computeOfflineSalesSummary(from, to);
  cachedSummary = offlineData;
  renderSalesData(offlineData);
}

function renderSalesData(summary = {}) {
  // KPIs
  const elUnits = document.getElementById('sales-kpi-units');
  const elTxCount = document.getElementById('sales-kpi-tx-count');
  const elTopName = document.getElementById('sales-kpi-top-name');
  const elTopStats = document.getElementById('sales-kpi-top-stats');
  const elRevenue = document.getElementById('sales-kpi-revenue');
  const elMethods = document.getElementById('sales-kpi-methods');
  const elAvg = document.getElementById('sales-kpi-avg-ticket');

  const totalUnits = summary.totalProductsSold ?? summary.totalUnitsSold ?? 0;
  const totalSales = summary.totalSalesCount ?? (summary.sales?.length || summary.history?.length || 0);

  if (elUnits) elUnits.textContent = `${totalUnits} uds`;
  if (elTxCount) elTxCount.textContent = `en ${totalSales} ventas registradas`;

  const top = summary.topProduct || summary.topSellingProduct;
  if (elTopName) {
    elTopName.textContent = top ? top.productName : 'Sin ventas aún';
  }
  if (elTopStats) {
    const qty = top ? (top.quantitySold ?? top.totalUnits ?? 0) : 0;
    const rev = top ? (top.revenueCOP ?? top.totalRevenueCOP ?? 0) : 0;
    elTopStats.textContent = top
      ? `${qty} unidades · ${formatCOP(rev)}`
      : '0 unidades · $ 0 COP';
  }

  if (elRevenue) elRevenue.textContent = formatCOP(summary.totalRevenueCOP || 0);

  if (elMethods) {
    const breakdown = summary.paymentBreakdown || {};
    const byMethod = summary.salesByPaymentMethod || {};
    const cash = breakdown.CASH ?? byMethod.CASH?.totalCOP ?? 0;
    const card = breakdown.CARD ?? byMethod.CARD?.totalCOP ?? 0;
    const nequi = breakdown.NEQUI ?? byMethod.NEQUI?.totalCOP ?? 0;
    const davi = breakdown.DAVIPLATA ?? byMethod.DAVIPLATA?.totalCOP ?? 0;
    const transfer = breakdown.TRANSFER ?? byMethod.TRANSFER?.totalCOP ?? 0;
    elMethods.textContent = `Efectivo: ${formatCOP(cash)} | Digital: ${formatCOP(card + nequi + davi + transfer)}`;
  }

  if (elAvg) elAvg.textContent = formatCOP(summary.averageTicketCOP || 0);

  // Ranking de Productos
  const ranking = summary.productRanking || summary.ranking || [];
  renderRankingList(ranking);

  // Historial de Ventas
  const history = summary.sales || summary.history || [];
  renderHistoryTable(history);
}

function renderRankingList(ranking = []) {
  const container = document.getElementById('sales-ranking-list');
  if (!container) return;

  if (ranking.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-xs text-slate-400">No hay ventas registradas en este período</div>
    `;
    return;
  }

  const maxUnits = Math.max(...ranking.map(r => r.quantitySold ?? r.totalUnits ?? 0), 1);

  container.innerHTML = ranking.map((item, idx) => {
    const units = item.quantitySold ?? item.totalUnits ?? 0;
    const revenue = item.revenueCOP ?? item.totalRevenueCOP ?? 0;
    const rankNum = item.rank || (idx + 1);
    const badgeColor = rankNum === 1
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-extrabold'
      : rankNum === 2
        ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200 font-bold'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-semibold';

    return `
      <div class="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-5 h-5 rounded-md flex items-center justify-center text-[10px] ${badgeColor}">#${rankNum}</span>
            <span class="font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(item.productName)}</span>
          </div>
          <span class="font-mono font-bold text-indigo-600 dark:text-indigo-400 flex-shrink-0">${formatCOP(revenue)}</span>
        </div>

        <!-- Barra de Progreso Nativa (0 inline styles) -->
        <div class="space-y-0.5">
          <progress
            class="w-full h-2 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-slate-200 dark:[&::-webkit-progress-bar]:bg-slate-700 [&::-webkit-progress-value]:bg-indigo-600 [&::-moz-progress-bar]:bg-indigo-600"
            value="${units}"
            max="${maxUnits}">
          </progress>
          <div class="flex justify-between text-[10px] text-slate-400">
            <span>${units} unidad${units === 1 ? '' : 'es'}</span>
            <span>${Math.round((units / maxUnits) * 100)}%</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderHistoryTable(history = []) {
  const tbody = document.getElementById('sales-history-tbody');
  const emptyEl = document.getElementById('sales-history-empty');
  if (!tbody) return;

  if (history.length === 0) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');

  tbody.innerHTML = history.map(sale => {
    const items = sale.items || [];
    const totalUnits = sale.itemsCount ?? items.reduce((acc, it) => acc + (it.quantity || 0), 0);
    const dateFormatted = formatDateTimeCO(sale.createdAt);

    const isExpress = sale.saleType === 'EXPRESS' || (!sale.tableNumber && !sale.tableId);
    const tableNum = sale.tableNumber || (state.tables || []).find(t => t.id === sale.tableId)?.number;
    const typeBadge = isExpress
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">⚡ Express</span>'
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">🍽️ Mesa ${escapeHtml(String(tableNum || ''))}</span>`;

    const methodLabels = {
      CASH: '💵 Efectivo',
      CARD: '💳 Tarjeta',
      NEQUI: '📱 Nequi',
      DAVIPLATA: '📲 Daviplata',
      TRANSFER: '🏦 Transfer'
    };
    const methodBadge = `<span class="font-medium text-[11px]">${methodLabels[sale.paymentMethod] || sale.paymentMethod || '💵 Efectivo'}</span>`;

    const itemsSummary = items.slice(0, 2).map(it => `${it.quantity}x ${it.productName}`).join(', ');
    const moreItems = items.length > 2 ? ` <span class="text-slate-400 font-semibold">+${items.length - 2}</span>` : '';

    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
        <td class="py-2.5 px-2 font-mono text-[11px] whitespace-nowrap">${dateFormatted}</td>
        <td class="py-2.5 px-2">${typeBadge}</td>
        <td class="py-2.5 px-2 truncate max-w-[200px]" title="${escapeHtml(items.map(i => `${i.quantity}x ${i.productName}`).join('\n'))}">
          ${escapeHtml(itemsSummary)}${moreItems}
        </td>
        <td class="py-2.5 px-2 text-center font-bold">${totalUnits}</td>
        <td class="py-2.5 px-2 whitespace-nowrap">${methodBadge}</td>
        <td class="py-2.5 px-2 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
          ${formatCOP(sale.totalCOP)}
        </td>
        <td class="py-2.5 px-2 text-center">
          <button type="button" class="btn-view-receipt p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 transition" data-sale-id="${sale.id || sale.invoiceNumber}" title="Ver Comprobante">
            🧾
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Vincular botones de ver recibo térmico
  tbody.querySelectorAll('.btn-view-receipt').forEach(btn => {
    btn.addEventListener('click', () => {
      const saleId = btn.dataset.saleId;
      const sale = history.find(s => (s.id === saleId || s.invoiceNumber === saleId));
      if (sale) {
        showReceiptModal(sale);
      }
    });
  });
}

function showReceiptModal(sale) {
  const printableContainer = document.getElementById('receipt-printable-content');
  if (printableContainer) {
    const taxCOP = sale.impoconsumoCOP ?? sale.taxCOP ?? 0;
    const tableNum = sale.tableNumber || (state.tables || []).find(t => t.id === sale.tableId)?.number || null;
    printableContainer.innerHTML = renderThermalReceipt({
      tenant: state.currentTenant || {},
      invoiceNumber: sale.invoiceNumber || sale.id || 'REC-001',
      date: sale.createdAt || new Date(),
      tableNumber: tableNum,
      waiter: sale.cashierName || sale.waiterName || 'Caja',
      customerName: sale.customerName || null,
      items: sale.items || [],
      subtotalCOP: sale.subtotalCOP || 0,
      taxCOP: taxCOP,
      hasTax: Boolean(taxCOP),
      tipCOP: sale.tipCOP || 0,
      hasTip: Boolean(sale.tipCOP),
      totalCOP: sale.totalCOP || 0,
      paymentMethod: sale.paymentMethod || 'CASH',
      cashReceived: sale.amountPaidCOP || null,
      cashChange: (sale.paymentMethod === 'CASH' && sale.amountPaidCOP > sale.totalCOP) ? (sale.amountPaidCOP - sale.totalCOP) : null
    });
  }
  openModal('modal-receipt');
}

async function handleExportCsv() {
  const from = document.getElementById('sales-date-from')?.value || getTodayBogotaStr();
  const to = document.getElementById('sales-date-to')?.value || getTodayBogotaStr();

  try {
    const res = await apiFetch(`/api/sales/export.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (res.ok) {
      const csvText = await res.text();
      const filename = `ventas-${(state.currentTenant?.name || 'hera').replace(/\s+/g, '_')}-${from}_al_${to}.csv`;
      downloadCsvBlob(csvText, filename);
      showToast('Archivo CSV descargado exitosamente', 'success');
      return;
    }
  } catch (_) {
    // Fallback offline
  }

  // Generar CSV local
  const summary = cachedSummary || computeOfflineSalesSummary(from, to);
  const rows = [
    ['ID_Factura', 'Fecha_Hora', 'Tipo_Venta', 'Mesa', 'Metodo_Pago', 'Subtotal_COP', 'Impoconsumo_COP', 'Propina_COP', 'Total_COP', 'Productos_Detalle']
  ];

  (summary.history || []).forEach(s => {
    const prodDetail = (s.items || []).map(i => `${i.quantity}x ${i.productName}`).join(' | ');
    rows.push([
      s.invoiceNumber || s.id,
      formatDateTimeCO(s.createdAt),
      s.tableNumber ? 'Mesa' : 'Express',
      s.tableNumber ? `Mesa ${s.tableNumber}` : 'Mostrador',
      s.paymentMethod || 'CASH',
      s.subtotalCOP || 0,
      s.taxCOP || 0,
      s.tipCOP || 0,
      s.totalCOP || 0,
      `"${prodDetail.replace(/"/g, '""')}"`
    ]);
  });

  const csvString = rows.map(r => r.join(',')).join('\r\n');
  const filename = `ventas-offline-${from}_al_${to}.csv`;
  downloadCsvBlob(csvString, filename);
  showToast('Archivo CSV descargado localmente', 'info');
}

function computeOfflineSalesSummary(from, to) {
  const db = initOfflineDb();
  const allInvoices = db.invoices || [];

  const history = allInvoices.slice().reverse();
  const totalSalesCount = history.length;
  const totalRevenueCOP = history.reduce((acc, h) => acc + (h.totalCOP || 0), 0);

  const productAgg = {};
  let totalUnitsSold = 0;

  history.forEach(h => {
    (h.items || []).forEach(it => {
      totalUnitsSold += (it.quantity || 1);
      const name = it.productName || 'Producto';
      if (!productAgg[name]) {
        productAgg[name] = { productName: name, totalUnits: 0, totalRevenueCOP: 0 };
      }
      productAgg[name].totalUnits += (it.quantity || 1);
      productAgg[name].totalRevenueCOP += (it.quantity || 1) * (Number(it.unitPriceCOP) || 0);
    });
  });

  const ranking = Object.values(productAgg).sort((a, b) => b.totalUnits - a.totalUnits);
  const topSellingProduct = ranking[0] || null;
  const averageTicketCOP = totalSalesCount > 0 ? Math.round(totalRevenueCOP / totalSalesCount) : 0;

  const salesByPaymentMethod = {};
  history.forEach(h => {
    const m = h.paymentMethod || 'CASH';
    if (!salesByPaymentMethod[m]) {
      salesByPaymentMethod[m] = { count: 0, totalCOP: 0 };
    }
    salesByPaymentMethod[m].count += 1;
    salesByPaymentMethod[m].totalCOP += (h.totalCOP || 0);
  });

  return {
    totalRevenueCOP,
    totalSalesCount,
    totalUnitsSold,
    averageTicketCOP,
    topSellingProduct,
    salesByPaymentMethod,
    ranking,
    history
  };
}
