/**
 * HERA CLOUD POS - Shifts & Blind Close Module (ES6)
 * Control de turnos de caja, arqueo ciego sin sesgo del cajero,
 * cálculo de discrepancias por medio de pago (Efectivo/Tarjeta/Transferencia) y dictamen financiero.
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, formatDateTimeCO, showToast, playNotificationSound, escapeHtml } from '../utils.js';

let activeShift = null;

export function setupShiftsModule() {
  const btnOpen = document.getElementById('btn-open-shift');
  const btnClose = document.getElementById('btn-submit-blind-close');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => handleOpenNewShift());
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => executeBlindClose());
  }
}

export async function loadActiveShift() {
  const banner = document.getElementById('shift-active-banner');
  const btnOpen = document.getElementById('btn-open-shift');

  try {
    const res = await apiFetch('/api/shifts/active');
    if (res.ok) {
      const data = await res.json();
      activeShift = data.shift || data;
      renderShiftBanner(activeShift);
      if (btnOpen) btnOpen.classList.add('hidden');
      return;
    } else if (res.status === 404) {
      activeShift = null;
      renderShiftBanner(null);
      if (btnOpen) btnOpen.classList.remove('hidden');
      return;
    }
  } catch (_) {
    // Modo Offline
  }

  // Fallback offline
  const db = initOfflineDb();
  const found = (db.shifts || []).find(s => s.status === 'OPEN');
  activeShift = found || null;
  renderShiftBanner(activeShift);
  if (btnOpen) {
    if (activeShift) btnOpen.classList.add('hidden');
    else btnOpen.classList.remove('hidden');
  }
}

function renderShiftBanner(shift) {
  const banner = document.getElementById('shift-active-banner');
  if (!banner) return;

  if (shift) {
    banner.innerHTML = `
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <h3 class="text-sm font-bold font-display text-indigo-950 dark:text-indigo-200">
            Turno de Caja Activo &middot; ${escapeHtml(shift.cashierName || state.currentUser?.name || 'Cajero')}
          </h3>
        </div>
        <p class="text-xs text-indigo-700 dark:text-indigo-400">
          Iniciado: ${formatDateTimeCO(shift.startTime || shift.openedAt || new Date())} &middot; Base inicial: ${formatCOP(shift.initialCashCOP || 100000)}
        </p>
      </div>
      <span class="px-2.5 py-1 text-xs font-bold rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
        Turno Abierto
      </span>
    `;
  } else {
    banner.innerHTML = `
      <div>
        <h3 class="text-sm font-bold font-display text-amber-900 dark:text-amber-200">No hay turno de caja abierto</h3>
        <p class="text-xs text-amber-700 dark:text-amber-400">Abre un nuevo turno para registrar transacciones y realizar el arqueo ciego</p>
      </div>
      <button type="button" id="btn-open-shift" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow transition">
        Abrir Nuevo Turno
      </button>
    `;
    const newBtn = banner.querySelector('#btn-open-shift');
    if (newBtn) {
      newBtn.addEventListener('click', () => handleOpenNewShift());
    }
  }
}

async function handleOpenNewShift() {
  const baseCashStr = prompt('Ingresa el monto de base de caja inicial en COP:', '100000');
  if (baseCashStr === null) return;

  const initialCashCOP = Number(baseCashStr) || 100000;
  const cashierName = state.currentUser?.name || 'Cajero de Turno';
  const cashierId = state.currentUser?.id || 'usr-default';

  try {
    const res = await apiFetch('/api/shifts', {
      method: 'POST',
      body: {
        cashierId,
        cashierName,
        initialCashCOP
      }
    });

    if (res.ok) {
      const data = await res.json();
      activeShift = data;
      showToast('Nuevo turno de caja abierto', 'success');
      loadActiveShift();
      return;
    }
  } catch (_) {}

  // Fallback offline
  const db = initOfflineDb();
  if (!Array.isArray(db.shifts)) db.shifts = [];
  const newS = {
    id: `shift-${Date.now()}`,
    tenantId: state.currentTenant?.id || 'tenant-default',
    cashierId,
    cashierName,
    initialCashCOP,
    startTime: new Date().toISOString(),
    status: 'OPEN'
  };
  db.shifts.push(newS);
  saveOfflineDb(db);
  activeShift = newS;
  showToast('Turno abierto localmente', 'info');
  loadActiveShift();
}

async function executeBlindClose() {
  if (!activeShift) {
    showToast('No hay un turno activo para cerrar', 'alert');
    return;
  }

  const cashInput = document.getElementById('audit-cash-declared');
  const cardInput = document.getElementById('audit-card-declared');
  const transferInput = document.getElementById('audit-transfer-declared');
  const notesInput = document.getElementById('audit-notes');
  const btnSubmit = document.getElementById('btn-submit-blind-close');

  const cashDeclaredCOP = Number(cashInput?.value) || 0;
  const cardDeclaredCOP = Number(cardInput?.value) || 0;
  const transferDeclaredCOP = Number(transferInput?.value) || 0;
  const notes = notesInput ? notesInput.value.trim() : '';

  if (cashInput?.value === '' || cardInput?.value === '' || transferInput?.value === '') {
    showToast('Debes declarar los montos contados para cada medio (puede ser 0)', 'alert');
    return;
  }

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span>Auditando cuadratura...</span>`;
  }

  const shiftId = activeShift?.id || 'active';
  const payload = {
    declaredCashCOP: cashDeclaredCOP,
    cashDeclaredCOP: cashDeclaredCOP,
    declaredCardCOP: cardDeclaredCOP,
    cardDeclaredCOP: cardDeclaredCOP,
    declaredTransfersCOP: transferDeclaredCOP,
    transferDeclaredCOP: transferDeclaredCOP,
    notes
  };

  try {
    let result = null;
    try {
      const res = await apiFetch(`/api/shifts/${shiftId}/blind-close`, {
        method: 'POST',
        body: payload
      });

      if (res.ok) {
        result = await res.json();
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al ejecutar cierre ciego');
      }
    } catch (apiErr) {
      // Fallback offline
      result = processOfflineBlindClose(payload);
    }

    if (result) {
      showToast('Cierre ciego ejecutado', 'success');
      renderBlindAuditResult(result);
      const isBalanced = (result.auditResult?.status === 'BALANCED') ||
                         (result.audit?.totalDiscrepancyCOP === 0) ||
                         (result.audit?.status === 'BALANCED');
      playNotificationSound(isBalanced ? 'success' : 'alert');

      // Limpiar formulario
      if (cashInput) cashInput.value = '';
      if (cardInput) cardInput.value = '';
      if (transferInput) transferInput.value = '';
      if (notesInput) notesInput.value = '';

      activeShift = null;
      loadActiveShift();
    }
  } catch (err) {
    showToast(err.message || 'Error en cierre de turno', 'alert');
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<span>🔒</span> <span>Ejecutar Cierre Ciego de Turno</span>`;
    }
  }
}

function renderBlindAuditResult(data) {
  const card = document.getElementById('audit-results-card');
  const content = document.getElementById('audit-results-content');
  if (!card || !content) return;

  card.classList.remove('hidden');

  const audit = data.audit || data.auditResult || data;
  const shift = data.shift || {};

  const statusConfig = {
    BALANCED: {
      label: '✅ CAJA CUADRADA PERFECTA',
      color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
    },
    SURPLUS: {
      label: '🟢 SOBRANTE DE DINERO',
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-800'
    },
    SHORTAGE: {
      label: '🔴 FALTANTE EN CAJA',
      color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300 dark:border-rose-800'
    }
  };

  let calculatedStatus = audit.status;
  if (!calculatedStatus || calculatedStatus === 'CLOSED' || calculatedStatus === 'OPEN') {
    const diff = Number(audit.totalDiscrepancyCOP || 0);
    if (diff === 0) calculatedStatus = 'BALANCED';
    else if (diff > 0) calculatedStatus = 'SURPLUS';
    else calculatedStatus = 'SHORTAGE';
  }

  const conf = statusConfig[calculatedStatus] || statusConfig.BALANCED;

  function renderDiff(diff) {
    const num = Number(diff) || 0;
    if (num === 0) return '<span class="text-emerald-600 font-bold">$ 0 COP (Exacto)</span>';
    if (num > 0) return `<span class="text-blue-600 font-bold">+${formatCOP(num)} (Sobrante)</span>`;
    return `<span class="text-red-600 font-bold">-${formatCOP(Math.abs(num))} (Faltante)</span>`;
  }

  content.innerHTML = `
    <div class="space-y-4">
      <div class="p-3 rounded-xl border text-center font-extrabold text-sm ${conf.color}">
        ${conf.label}
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700 text-slate-400 uppercase font-semibold text-[10px]">
              <th class="py-2">Medio</th>
              <th class="py-2 text-right">Esperado Sistema</th>
              <th class="py-2 text-right">Declarado Físico</th>
              <th class="py-2 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
            <tr>
              <td class="py-2 font-sans font-bold">💵 Efectivo</td>
              <td class="py-2 text-right">${formatCOP(audit.systemCashCOP ?? audit.expectedCashCOP ?? audit.cashExpectedCOP ?? 0)}</td>
              <td class="py-2 text-right">${formatCOP(audit.declaredCashCOP ?? audit.cashDeclaredCOP ?? 0)}</td>
              <td class="py-2 text-right">${renderDiff(audit.discrepancyCashCOP)}</td>
            </tr>
            <tr>
              <td class="py-2 font-sans font-bold">💳 Datáfono</td>
              <td class="py-2 text-right">${formatCOP(audit.systemCardCOP ?? audit.expectedCardCOP ?? audit.cardExpectedCOP ?? 0)}</td>
              <td class="py-2 text-right">${formatCOP(audit.declaredCardCOP ?? audit.cardDeclaredCOP ?? 0)}</td>
              <td class="py-2 text-right">${renderDiff(audit.discrepancyCardCOP)}</td>
            </tr>
            <tr>
              <td class="py-2 font-sans font-bold">📱 Digital (Nequi/Davi)</td>
              <td class="py-2 text-right">${formatCOP(audit.systemTransfersCOP ?? audit.expectedTransferCOP ?? audit.transferExpectedCOP ?? 0)}</td>
              <td class="py-2 text-right">${formatCOP(audit.declaredTransfersCOP ?? audit.transferDeclaredCOP ?? 0)}</td>
              <td class="py-2 text-right">${renderDiff(audit.discrepancyTransfersCOP ?? audit.discrepancyTransferCOP)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-slate-300 dark:border-slate-700 font-bold text-xs">
              <td class="py-2.5 font-sans">TOTAL DISCREPANCIA:</td>
              <td colspan="3" class="py-2.5 text-right font-mono">
                ${renderDiff(audit.totalDiscrepancyCOP)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="text-[11px] text-slate-500 space-y-0.5 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div><strong>Cajero:</strong> ${escapeHtml(shift.cashierName || state.currentUser?.name || 'Cajero')}</div>
        <div><strong>Fecha y Hora de Cierre:</strong> ${formatDateTimeCO(new Date())}</div>
      </div>
    </div>
  `;
}

function processOfflineBlindClose(payload) {
  const db = initOfflineDb();
  const invoices = db.invoices || [];

  let expectedCash = 100000; // Base inicial
  let expectedCard = 0;
  let expectedTransfer = 0;

  invoices.forEach(inv => {
    const m = inv.paymentMethod;
    const tot = inv.totalCOP || 0;
    if (m === 'CASH') expectedCash += tot;
    else if (m === 'CARD') expectedCard += tot;
    else expectedTransfer += tot;
  });

  const discrepancyCash = payload.cashDeclaredCOP - expectedCash;
  const discrepancyCard = payload.cardDeclaredCOP - expectedCard;
  const discrepancyTransfer = payload.transferDeclaredCOP - expectedTransfer;
  const totalDiscrepancy = discrepancyCash + discrepancyCard + discrepancyTransfer;

  let status = 'BALANCED';
  if (totalDiscrepancy < 0) status = 'SHORTAGE';
  else if (totalDiscrepancy > 0) status = 'SURPLUS';

  const auditResult = {
    expectedCashCOP: expectedCash,
    expectedCardCOP: expectedCard,
    expectedTransferCOP: expectedTransfer,
    cashDeclaredCOP: payload.cashDeclaredCOP,
    cardDeclaredCOP: payload.cardDeclaredCOP,
    transferDeclaredCOP: payload.transferDeclaredCOP,
    discrepancyCashCOP: discrepancyCash,
    discrepancyCardCOP: discrepancyCard,
    discrepancyTransferCOP: discrepancyTransfer,
    totalDiscrepancyCOP: totalDiscrepancy,
    status
  };

  // Marcar turno cerrado en DB
  const shiftIdx = (db.shifts || []).findIndex(s => s.status === 'OPEN');
  if (shiftIdx >= 0) {
    db.shifts[shiftIdx].status = 'CLOSED';
    db.shifts[shiftIdx].closedAt = new Date().toISOString();
    db.shifts[shiftIdx].audit = auditResult;
  }
  saveOfflineDb(db);

  return { success: true, auditResult, shift: db.shifts?.[shiftIdx] || {} };
}
