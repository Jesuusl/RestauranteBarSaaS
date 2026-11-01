/**
 * HERA CLOUD POS - Formatting & Common UI Helpers (ES6)
 * Utilidades de moneda COP, fechas Colombia, modales, toasts (100% Tailwind, 0 inline styles)
 * y renderizado de tirilla térmica 80mm.
 */

export function formatCOP(amount) {
  const num = Math.round(Number(amount) || 0);
  return `$ ${num.toLocaleString('es-CO')} COP`;
}

export function formatDateCO(dateInput) {
  if (!dateInput) return '--';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatTimeCO(dateInput) {
  if (!dateInput) return '--';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

export function formatDateTimeCO(dateInput) {
  if (!dateInput) return '--';
  return `${formatDateCO(dateInput)} ${formatTimeCO(dateInput)}`;
}

export function playNotificationSound(type = 'success') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'alert' || type === 'error') {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
    }

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {
    // Audio no soportado o bloqueado por navegador
  }
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.setAttribute('role', 'alert');

  let colorClasses = 'bg-slate-900 dark:bg-slate-800 text-white border border-slate-700 shadow-xl';
  let icon = '🛎️';
  let title = 'Sistema';

  if (type === 'success') {
    colorClasses = 'bg-emerald-600 text-white shadow-xl shadow-emerald-900/30';
    icon = '✅';
    title = 'Éxito';
  } else if (type === 'alert' || type === 'error') {
    colorClasses = 'bg-red-600 text-white shadow-xl shadow-red-900/30';
    icon = '⚠️';
    title = 'Atención';
  } else if (type === 'warning') {
    colorClasses = 'bg-amber-600 text-white shadow-xl shadow-amber-900/30';
    icon = '⚡';
    title = 'Aviso';
  }

  toast.className = `pointer-events-auto p-3.5 rounded-2xl flex items-start justify-between gap-3 text-xs font-medium transition-all transform duration-300 ${colorClasses}`;
  toast.innerHTML = `
    <div class="flex items-start gap-2 min-w-0">
      <span class="text-base flex-shrink-0">${icon}</span>
      <div class="min-w-0">
        <span class="font-bold block">${title}</span>
        <span class="break-words opacity-95">${escapeHtml(message)}</span>
      </div>
    </div>
    <button type="button" aria-label="Cerrar notificación" class="p-1 text-white/70 hover:text-white rounded-lg flex-shrink-0 text-base leading-none">
      &times;
    </button>
  `;

  const btnClose = toast.querySelector('button');
  if (btnClose) {
    btnClose.onclick = () => {
      toast.remove();
    };
  }

  container.appendChild(toast);
  playNotificationSound(type);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 4500);
}

export function openModal(modalId) {
  const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

export function closeModal(modalId) {
  const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function downloadCsvBlob(content, filename = 'reporte-ventas.csv') {
  // Asegurar BOM UTF-8 para compatibilidad directa con Excel
  const bom = '\uFEFF';
  const csvWithBom = content.startsWith(bom) ? content : bom + content;
  const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.className = 'hidden';
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Renderiza la tirilla térmica 80mm en formato HTML responsivo con clases de Tailwind
 * (Estrictamente sin estilos en línea).
 */
export function renderThermalReceipt({
  tenant = {},
  invoiceNumber = 'REC-001',
  date = new Date(),
  tableNumber = null,
  waiter = 'Caja',
  customerName = null,
  items = [],
  subtotalCOP = 0,
  taxCOP = 0,
  taxRate = 0.08,
  hasTax = false,
  tipCOP = 0,
  hasTip = false,
  totalCOP = 0,
  paymentMethod = 'CASH',
  payments = null,
  cashReceived = null,
  cashChange = null,
  status = 'COMPLETED',
  cancelReason = null
}) {
  const businessName = tenant.name || 'HERA POS';
  const businessNit = tenant.nit || 'NIT: 900.876.543-1';
  const businessAddress = tenant.address || 'Colombia';
  const dateStr = formatDateTimeCO(date);

  const paymentLabels = {
    CASH: '💵 Efectivo',
    CARD: '💳 Tarjeta / Datáfono',
    NEQUI: '📱 Nequi',
    DAVIPLATA: '📲 Daviplata',
    TRANSFER: '🏦 Transferencia',
    MIXED: '🔀 Pago Combinado'
  };

  const isCancelled = status === 'CANCELLED';

  const cancelledBanner = isCancelled ? `
    <div class="p-2.5 mb-2 rounded-xl bg-rose-100 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-center font-extrabold text-xs tracking-wider uppercase">
      <div>🚫 VENTA ANULADA</div>
      ${cancelReason ? `<div class="text-[10px] font-medium lowercase tracking-normal italic mt-0.5">Motivo: ${escapeHtml(cancelReason)}</div>` : ''}
    </div>
  ` : '';

  const paymentText = paymentLabels[paymentMethod] || paymentMethod || '💵 Efectivo';

  const rowsHtml = items.map(it => {
    const qty = it.quantity || 1;
    const name = it.productName || it.name || 'Producto';
    const unitPrice = Number(it.unitPriceCOP || it.unitPrice || it.salePriceCOP || 0);
    const lineTotal = Number(it.subtotalCOP || (qty * unitPrice));
    const mods = it.modifiers ? `<div class="text-[10px] text-slate-500 font-sans italic pl-2">${escapeHtml(it.modifiers)}</div>` : '';
    const notes = it.notes ? `<div class="text-[10px] text-slate-500 font-sans italic pl-2">Nota: ${escapeHtml(it.notes)}</div>` : '';

    return `
      <div class="py-1 border-b border-slate-200 dark:border-slate-800 ${isCancelled ? 'line-through opacity-70' : ''}">
        <div class="flex items-start justify-between gap-1">
          <span class="font-bold flex-1">${qty}x ${escapeHtml(name)}</span>
          <span class="font-bold whitespace-nowrap">${formatCOP(lineTotal)}</span>
        </div>
        ${mods}
        ${notes}
      </div>
    `;
  }).join('');

  const taxRow = hasTax && taxCOP > 0 ? `
    <div class="flex justify-between text-slate-600 dark:text-slate-400">
      <span>Impoconsumo (8%):</span>
      <span class="font-bold">${formatCOP(taxCOP)}</span>
    </div>
  ` : '';

  const tipRow = hasTip && tipCOP > 0 ? `
    <div class="flex justify-between text-slate-600 dark:text-slate-400">
      <span>Propina Voluntaria (10%):</span>
      <span class="font-bold">${formatCOP(tipCOP)}</span>
    </div>
  ` : '';

  // Desglose de múltiples pagos o pago único
  let paymentsHtml = '';
  if (Array.isArray(payments) && payments.length > 1) {
    paymentsHtml = `
      <div class="pt-1.5 border-t border-dashed border-slate-300 dark:border-slate-700 space-y-1 text-[11px]">
        <div class="font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
          <span>Desglose de Pago Mixto:</span>
          <span>(${payments.length} métodos)</span>
        </div>
        ${payments.map(p => `
          <div class="flex justify-between text-slate-600 dark:text-slate-400">
            <span>${paymentLabels[p.method] || p.method}:</span>
            <span class="font-mono font-bold">${formatCOP(p.amountCOP)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    paymentsHtml = `
      <div class="flex justify-between text-[11px] text-slate-600 dark:text-slate-400 pt-1">
        <span>Medio de Pago:</span>
        <span class="font-bold">${escapeHtml(paymentText)}</span>
      </div>
    `;
  }

  const showCashDetail = (paymentMethod === 'CASH' && cashReceived !== null && cashReceived >= totalCOP) || (Number(cashChange) > 0);
  const cashDetail = showCashDetail ? `
    <div class="pt-1.5 border-t border-dashed border-slate-300 dark:border-slate-700 text-[11px] space-y-0.5">
      ${cashReceived !== null ? `
      <div class="flex justify-between text-slate-600 dark:text-slate-400">
        <span>${paymentMethod === 'MIXED' ? 'Efectivo Entregado:' : 'Dinero Recibido:'}</span>
        <span class="font-bold">${formatCOP(cashReceived)}</span>
      </div>` : ''}
      <div class="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold">
        <span>Cambio / Devuelta:</span>
        <span>${formatCOP(cashChange !== null ? cashChange : (cashReceived - totalCOP))}</span>
      </div>
    </div>
  ` : '';

  return `
    ${cancelledBanner}
    <div class="text-center space-y-1 pb-3 border-b border-dashed border-slate-300 dark:border-slate-700">
      <h4 class="text-base font-extrabold uppercase tracking-tight text-slate-900 dark:text-white">${escapeHtml(businessName)}</h4>
      <p class="text-[11px] text-slate-500">${escapeHtml(businessNit)}</p>
      <p class="text-[10px] text-slate-400">${escapeHtml(businessAddress)}</p>
    </div>

    <div class="py-2 border-b border-dashed border-slate-300 dark:border-slate-700 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
      <div class="flex justify-between">
        <span class="font-bold">Comprobante:</span>
        <span class="font-mono font-bold">${escapeHtml(String(invoiceNumber))}</span>
      </div>
      <div class="flex justify-between">
        <span>Fecha / Hora:</span>
        <span>${dateStr}</span>
      </div>
      <div class="flex justify-between">
        <span>Servicio:</span>
        <span class="font-bold">${tableNumber ? `Mesa #${escapeHtml(String(tableNumber))}` : '⚡ Venta Mostrador (Express)'}</span>
      </div>
      <div class="flex justify-between">
        <span>Atendido por:</span>
        <span>${escapeHtml(waiter || 'Caja')}</span>
      </div>
      ${customerName ? `
        <div class="flex justify-between">
          <span>Cliente:</span>
          <span class="font-bold">${escapeHtml(customerName)}</span>
        </div>
      ` : ''}
    </div>

    <!-- Lista de Artículos -->
    <div class="py-2 space-y-1 text-xs">
      <div class="flex justify-between text-[10px] uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-1">
        <span>Descripción</span>
        <span>Valor COP</span>
      </div>
      ${rowsHtml}
    </div>

    <!-- Totales -->
    <div class="pt-2 border-t-2 border-slate-300 dark:border-slate-700 space-y-1 text-xs">
      <div class="flex justify-between text-slate-600 dark:text-slate-400">
        <span>Subtotal Neto:</span>
        <span class="font-bold">${formatCOP(subtotalCOP)}</span>
      </div>
      ${taxRow}
      ${tipRow}

      <div class="flex justify-between text-base font-extrabold ${isCancelled ? 'text-rose-600 line-through' : 'text-slate-900 dark:text-white'} pt-1.5 border-t border-slate-300 dark:border-slate-700">
        <span>TOTAL COP:</span>
        <span class="font-mono ${isCancelled ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400'}">${formatCOP(totalCOP)}</span>
      </div>

      ${paymentsHtml}
      ${cashDetail}
    </div>

    <!-- Pie del Recibo -->
    <div class="text-center pt-3 mt-3 border-t border-dashed border-slate-300 dark:border-slate-700 text-[10px] text-slate-400 space-y-1">
      <p class="font-bold text-slate-600 dark:text-slate-300">¡GRACIAS POR SU PREFERENCIA!</p>
      <p>Sistema POS Multi-Tenant HERA &middot; Colombia</p>
    </div>
  `;
}
