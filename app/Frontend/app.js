/**
 * COMMANDA SaaS - Frontend Interactive Application
 * Sistema Integral de Comandas Táctil, KDS, Facturación COP y Cierre Ciego
 */

(function () {
  'use strict';

  // --- CONFIGURACIÓN & ESTADO GLOBAL ---
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : window.location.origin;

  const STATE = {
    activeView: 'view-tables',
    activeZone: 'ALL',
    activeKdsStation: 'ALL',
    activePosStation: 'ALL',
    selectedTableId: null,
    selectedSessionId: null,
    currentCart: [], // { product, quantity, modifiers, notes }
    tables: [],
    products: [],
    kdsOrders: [],
    invoices: [],
    shiftAudit: {
      cashSales: 0,
      cardSales: 0,
      transferSales: 0,
      totalSales: 0
    },
    isBackendOnline: false,
    sseEventSource: null,
    selectedModifiersTemp: []
  };

  // --- DATOS SEMILLA LOCALES (Mock Fallback para Vercel o Desconexión) ---
  const MOCK_TABLES = [
    { id: 'tab-1', number: 1, zone: 'Salón Principal', capacity: 4, status: 'AVAILABLE', currentSessionId: null, openedAt: null },
    { id: 'tab-2', number: 2, zone: 'Salón Principal', capacity: 2, status: 'OCCUPIED', currentSessionId: 'sess-102', openedAt: Date.now() - 42 * 60000 },
    { id: 'tab-3', number: 3, zone: 'Salón Principal', capacity: 6, status: 'RESERVED', currentSessionId: null, openedAt: null },
    { id: 'tab-4', number: 4, zone: 'Terraza', capacity: 4, status: 'AVAILABLE', currentSessionId: null, openedAt: null },
    { id: 'tab-5', number: 5, zone: 'Terraza', capacity: 4, status: 'PAYING', currentSessionId: 'sess-105', openedAt: Date.now() - 65 * 60000 },
    { id: 'tab-6', number: 6, zone: 'Terraza', capacity: 2, status: 'CLEANING', currentSessionId: null, openedAt: null },
    { id: 'tab-7', number: 7, zone: 'Barra VIP', capacity: 2, status: 'AVAILABLE', currentSessionId: null, openedAt: null },
    { id: 'tab-8', number: 8, zone: 'Barra VIP', capacity: 2, status: 'OCCUPIED', currentSessionId: 'sess-108', openedAt: Date.now() - 18 * 60000 }
  ];

  const MOCK_PRODUCTS = [
    { id: 'prod-mojito', name: 'Cóctel Mojito Clásico', category: 'Cócteles', station: 'BAR', salePriceCOP: 32000, isAvailable: true },
    { id: 'prod-gin-tonic', name: 'Gin Tonic Tanqueray', category: 'Cócteles', station: 'BAR', salePriceCOP: 38000, isAvailable: true },
    { id: 'prod-shot-guaro', name: 'Shot de Aguardiente Antioqueño', category: 'Licores', station: 'BAR', salePriceCOP: 8000, isAvailable: true },
    { id: 'prod-cerveza-club', name: 'Cerveza Club Colombia Dorada', category: 'Cervezas', station: 'BAR', salePriceCOP: 10000, isAvailable: true },
    { id: 'prod-punta-anca', name: 'Punta de Anca 350g', category: 'Carnes', station: 'KITCHEN', salePriceCOP: 54000, isAvailable: true },
    { id: 'prod-picada-criolla', name: 'Picada Criolla Tradicional', category: 'Para Compartir', station: 'KITCHEN', salePriceCOP: 68000, isAvailable: true },
    { id: 'prod-alitas-bbq', name: 'Alitas BBQ Glaseadas (8 piezas)', category: 'Entradas', station: 'KITCHEN', salePriceCOP: 34000, isAvailable: true }
  ];

  const MOCK_KDS_ORDERS = [
    {
      id: 'ord-101',
      orderNumber: 101,
      tableNumber: 2,
      tableName: 'Mesa 2',
      station: 'KITCHEN',
      status: 'IN_PREPARATION',
      createdAt: new Date(Date.now() - 14 * 60000).toISOString(),
      items: [
        { productName: 'Punta de Anca 350g', quantity: 1, modifiers: 'Término 3/4', notes: 'Poco término' },
        { productName: 'Alitas BBQ Glaseadas', quantity: 1, modifiers: 'Sin cebolla', notes: '' }
      ]
    },
    {
      id: 'ord-102',
      orderNumber: 102,
      tableNumber: 8,
      tableName: 'Mesa 8',
      station: 'BAR',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 4 * 60000).toISOString(),
      items: [
        { productName: 'Gin Tonic Tanqueray', quantity: 2, modifiers: 'Mucho hielo', notes: 'Limón adicional' },
        { productName: 'Cóctel Mojito Clásico', quantity: 1, modifiers: 'Sin hielo', notes: '' }
      ]
    },
    {
      id: 'ord-103',
      orderNumber: 103,
      tableNumber: 5,
      tableName: 'Mesa 5',
      station: 'KITCHEN',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 24 * 60000).toISOString(),
      items: [
        { productName: 'Picada Criolla Tradicional', quantity: 1, modifiers: 'Bien Cocido', notes: 'Arepas bien tostadas' }
      ]
    }
  ];

  // --- ELEMENTOS DEL DOM ---
  const DOM = {
    navButtons: document.querySelectorAll('.nav-tab-btn'),
    views: document.querySelectorAll('.view-section'),
    sseBadge: document.getElementById('sse-status-badge'),
    sseText: document.getElementById('sse-status-text'),
    clock: document.getElementById('digital-clock'),
    kdsPendingBadge: document.getElementById('kds-pending-badge'),
    
    // Mesas
    tablesGrid: document.getElementById('tables-grid'),
    zoneButtons: document.querySelectorAll('.zone-btn'),
    
    // TPV
    posTableSelect: document.getElementById('pos-table-select'),
    posActiveTableBadge: document.getElementById('pos-active-table-number'),
    posActiveSessionLabel: document.getElementById('pos-active-session-label'),
    posActiveSessionMeta: document.getElementById('pos-active-session-meta'),
    posStationButtons: document.querySelectorAll('.station-btn'),
    posSearchInput: document.getElementById('pos-search-input'),
    productsGrid: document.getElementById('products-grid'),
    cartItemsContainer: document.getElementById('cart-items-container'),
    cartSubtotal: document.getElementById('cart-subtotal-cop'),
    cartTax: document.getElementById('cart-tax-cop'),
    cartTotal: document.getElementById('cart-total-cop'),
    btnSubmitOrder: document.getElementById('btn-submit-order'),
    btnClearCart: document.getElementById('btn-clear-cart'),
    
    // KDS
    kdsFilterButtons: document.querySelectorAll('.kds-filter-btn'),
    kdsOrdersGrid: document.getElementById('kds-orders-grid'),

    // Facturación
    billingTableSelect: document.getElementById('billing-table-select'),
    invTableMeta: document.getElementById('inv-table-meta'),
    invoiceItemsList: document.getElementById('invoice-items-list'),
    invSubtotalVal: document.getElementById('inv-subtotal-val'),
    invTaxVal: document.getElementById('inv-tax-val'),
    invTipVal: document.getElementById('inv-tip-val'),
    invGrandTotalVal: document.getElementById('inv-grand-total-val'),
    tipSwitch: document.getElementById('tip-switch'),
    splitTabNone: document.getElementById('split-tab-none'),
    splitTabEqual: document.getElementById('split-tab-equal'),
    splitTabItems: document.getElementById('split-tab-items'),
    splitPanelEqual: document.getElementById('split-panel-equal'),
    splitEqualDiners: document.getElementById('split-equal-diners'),
    btnCalcSplitEqual: document.getElementById('btn-calc-split-equal'),
    splitEqualResult: document.getElementById('split-equal-result'),
    splitPanelItems: document.getElementById('split-panel-items'),
    splitItemsDinersCount: document.getElementById('split-items-diners-count'),
    btnSplitItemsDec: document.getElementById('btn-split-items-dec'),
    btnSplitItemsInc: document.getElementById('btn-split-items-inc'),
    splitItemsAssignmentList: document.getElementById('split-items-assignment-list'),
    btnCalcSplitItems: document.getElementById('btn-calc-split-items'),
    splitItemsResultsContainer: document.getElementById('split-items-results-container'),
    paymentMethodButtons: document.querySelectorAll('.btn-payment-method'),
    cashReceivedInput: document.getElementById('cash-received-input'),
    cashChangeDisplay: document.getElementById('cash-change-display'),
    btnExecuteCheckout: document.getElementById('btn-execute-checkout'),

    // Cierre Ciego
    formBlindClose: document.getElementById('form-blind-close'),
    auditCashDeclared: document.getElementById('audit-cash-declared'),
    auditCardDeclared: document.getElementById('audit-card-declared'),
    auditTransferDeclared: document.getElementById('audit-transfer-declared'),
    auditNotes: document.getElementById('audit-notes'),
    btnSubmitBlindClose: document.getElementById('btn-submit-blind-close'),
    auditResultsCard: document.getElementById('audit-results-card'),
    auditResultsContent: document.getElementById('audit-results-content'),

    // Modales
    modalOpenTable: document.getElementById('modal-open-table'),
    modalTableNumberSpan: document.getElementById('modal-table-number-span'),
    modalOpenTableId: document.getElementById('modal-open-table-id'),
    modalWaiterName: document.getElementById('modal-waiter-name'),
    modalDinerCount: document.getElementById('modal-diner-count'),
    btnConfirmOpenTable: document.getElementById('btn-confirm-open-table'),
    
    modalModifiers: document.getElementById('modal-modifiers'),
    modalModProductName: document.getElementById('modal-mod-product-name'),
    modalModNotes: document.getElementById('modal-mod-notes'),
    btnConfirmAddWithMod: document.getElementById('btn-confirm-add-with-mod'),
    modChipsContainer: document.getElementById('mod-chips-container'),

    // Toasts
    toastContainer: document.getElementById('toast-container')
  };

  // --- UTILIDADES DE FORMATO & AUDIO ---
  function formatCOP(amount) {
    const num = Math.round(Number(amount) || 0);
    return `$ ${num.toLocaleString('es-CO')} COP`;
  }

  function playNotificationSound(type = 'success') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'alert') {
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
      // Audio no permitido o silenciado
    }
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast-item ${type}`;
    toast.innerHTML = `
      <div><strong>${type === 'alert' ? '⚠️ Notificación' : '🛎️ Sistema'}</strong>: ${message}</div>
      <button style="color: var(--text-dim);">&times;</button>
    `;

    toast.querySelector('button').onclick = () => toast.remove();
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4500);

    playNotificationSound(type);
  }

  // --- RELOJ DIGITAL EN VIVO ---
  function initClock() {
    function update() {
      const now = new Date();
      DOM.clock.textContent = now.toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    update();
    setInterval(update, 1000);
  }

  // --- NAVEGACIÓN SPA ---
  function setupNavigation() {
    DOM.navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        switchView(targetView);
      });
    });
  }

  function switchView(viewId) {
    STATE.activeView = viewId;
    DOM.navButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.view === viewId);
    });
    DOM.views.forEach(v => {
      v.classList.toggle('active', v.id === viewId);
    });

    if (viewId === 'view-tables') renderTables();
    if (viewId === 'view-pos') renderPosCatalog();
    if (viewId === 'view-kds') renderKdsOrders();
    if (viewId === 'view-billing') populateBillingSelect();
  }

  // --- SERVIDOR SSE (Server-Sent Events) ---
  function initSSE() {
    try {
      const eventSource = new EventSource(`${API_BASE}/api/events`);
      STATE.sseEventSource = eventSource;

      eventSource.onopen = () => {
        STATE.isBackendOnline = true;
        DOM.sseBadge.classList.remove('offline');
        DOM.sseText.textContent = 'SSE En Línea';
      };

      eventSource.onerror = () => {
        STATE.isBackendOnline = false;
        DOM.sseBadge.classList.add('offline');
        DOM.sseText.textContent = 'Modo Local (Offline)';
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleSSEEvent(data);
        } catch (_) {}
      };

      // Escuchar eventos específicos del backend
      ['TABLE_STATUS_CHANGED', 'ORDER_CREATED', 'ORDER_STATUS_CHANGED'].forEach(eventName => {
        eventSource.addEventListener(eventName, (e) => {
          try {
            const payload = JSON.parse(e.data);
            handleSSEEvent({ type: eventName, ...payload });
          } catch (_) {}
        });
      });
    } catch (_) {
      DOM.sseBadge.classList.add('offline');
      DOM.sseText.textContent = 'Modo Local (Offline)';
    }
  }

  function handleSSEEvent(eventData) {
    if (!eventData || !eventData.type) return;

    if (eventData.type === 'TABLE_STATUS_CHANGED') {
      const idx = STATE.tables.findIndex(t => t.id === eventData.tableId);
      if (idx !== -1) {
        STATE.tables[idx].status = eventData.status;
        renderTables();
        populatePosTableSelect();
        populateBillingSelect();
      }
      showToast(`Mesa #${eventData.tableId.replace('tab-', '')}: Estado actualizado a ${eventData.status}`);
    } else if (eventData.type === 'ORDER_CREATED') {
      showToast(`Nueva comanda enviada a ${eventData.station || 'Cocina/Barra'}`, 'success');
      loadKdsOrders();
    } else if (eventData.type === 'ORDER_STATUS_CHANGED') {
      showToast(`Comanda #${eventData.orderNumber || ''}: ${eventData.status}`, 'info');
      loadKdsOrders();
    }
  }

  // --- PERSISTENCIA OFFLINE LOCALSTORAGE (BUG-007) ---
  const OFFLINE_STORAGE_KEY = 'commanda_offline_state_v1';

  function saveOfflineState() {
    try {
      const payload = {
        tables: STATE.tables,
        kdsOrders: STATE.kdsOrders,
        shiftAudit: STATE.shiftAudit,
        invoices: STATE.invoices || []
      };
      localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('Error al guardar estado offline en localStorage:', err);
    }
  }

  function loadOfflineState() {
    try {
      const raw = localStorage.getItem(OFFLINE_STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        let restored = false;
        if (Array.isArray(data.tables) && data.tables.length > 0) {
          STATE.tables = data.tables;
          restored = true;
        }
        if (Array.isArray(data.kdsOrders)) {
          STATE.kdsOrders = data.kdsOrders;
          restored = true;
        }
        if (data.shiftAudit) {
          STATE.shiftAudit = {
            cashSales: Number(data.shiftAudit.cashSales) || 0,
            cardSales: Number(data.shiftAudit.cardSales) || 0,
            transferSales: Number(data.shiftAudit.transferSales) || 0,
            totalSales: Number(data.shiftAudit.totalSales) || 0
          };
          restored = true;
        }
        if (Array.isArray(data.invoices)) {
          STATE.invoices = data.invoices;
        }
        return restored;
      }
    } catch (err) {
      console.warn('Error al cargar estado offline desde localStorage:', err);
    }
    return false;
  }

  // --- INICIALIZACIÓN DE DATOS (Backend con Fallback & Persistencia Offline) ---
  async function loadInitialData() {
    let apiSuccess = false;
    try {
      const [resTables, resProducts] = await Promise.all([
        fetch(`${API_BASE}/api/tables`),
        fetch(`${API_BASE}/api/inventory/products`)
      ]);

      if (resTables.ok && resProducts.ok) {
        STATE.tables = await resTables.json();
        STATE.products = await resProducts.json();
        STATE.isBackendOnline = true;
        apiSuccess = true;
        await loadKdsOrders();
      } else {
        throw new Error('Fallback a almacenamiento local');
      }
    } catch (_) {
      // Modo Offline: Intentar restaurar desde localStorage
      STATE.products = JSON.parse(JSON.stringify(MOCK_PRODUCTS));
      const hasOffline = loadOfflineState();

      if (!hasOffline || !STATE.tables || STATE.tables.length === 0) {
        STATE.tables = JSON.parse(JSON.stringify(MOCK_TABLES));
        STATE.kdsOrders = JSON.parse(JSON.stringify(MOCK_KDS_ORDERS));
        saveOfflineState();
      }
    }

    if (!apiSuccess && (!STATE.kdsOrders || STATE.kdsOrders.length === 0)) {
      STATE.kdsOrders = JSON.parse(JSON.stringify(MOCK_KDS_ORDERS));
    }

    renderTables();
    renderPosCatalog();
    renderKdsOrders();
    populatePosTableSelect();
    populateBillingSelect();
  }

  async function loadKdsOrders() {
    try {
      const res = await fetch(`${API_BASE}/api/orders/station?station=${STATE.activeKdsStation}`);
      if (res.ok) {
        STATE.kdsOrders = await res.json();
      } else {
        throw new Error();
      }
    } catch (_) {
      if (!STATE.kdsOrders || STATE.kdsOrders.length === 0) {
        const hasOffline = loadOfflineState();
        if (!hasOffline || !STATE.kdsOrders || STATE.kdsOrders.length === 0) {
          STATE.kdsOrders = JSON.parse(JSON.stringify(MOCK_KDS_ORDERS));
        }
      }
    }
    renderKdsOrders();
  }

  // =========================================================================
  // MÓDULO 1: PLANO DE MESAS
  // =========================================================================
  function renderTables() {
    DOM.tablesGrid.innerHTML = '';
    const filtered = STATE.activeZone === 'ALL'
      ? STATE.tables
      : STATE.tables.filter(t => t.zone === STATE.activeZone);

    filtered.forEach(table => {
      const card = document.createElement('div');
      card.className = `table-card status-${table.status}`;

      const elapsedMinutes = table.openedAt ? Math.floor((Date.now() - table.openedAt) / 60000) : 0;
      const elapsedDisplay = table.openedAt ? `${elapsedMinutes} min` : '--:--';

      const statusMap = {
        AVAILABLE: 'Disponible',
        OCCUPIED: 'Ocupada',
        PAYING: 'Por Cobrar',
        RESERVED: 'Reservada',
        CLEANING: 'Limpieza'
      };

      card.innerHTML = `
        <div class="table-card-top">
          <div class="table-number-box">
            <span class="prefix">MESA</span>
            <span class="num">${table.number}</span>
          </div>
          <span class="table-status-badge">${statusMap[table.status] || table.status}</span>
        </div>

        <div class="table-meta-details">
          <div class="meta-row">
            <span>Zona:</span>
            <span class="val">${table.zone}</span>
          </div>
          <div class="meta-row">
            <span>Capacidad:</span>
            <span class="val">${table.capacity} personas</span>
          </div>
          <div class="meta-row">
            <span>Tiempo Turno:</span>
            <span class="val time-counter">${elapsedDisplay}</span>
          </div>
        </div>

        <div class="table-actions-row">
          ${getTableActionButtons(table)}
        </div>
      `;

      // Eventos de botones de mesa
      const btnOpen = card.querySelector('.btn-act-open');
      if (btnOpen) btnOpen.onclick = () => openModalOpenTable(table);

      const btnPos = card.querySelector('.btn-act-pos');
      if (btnPos) btnPos.onclick = () => goToPosWithTable(table.id);

      const btnPay = card.querySelector('.btn-act-pay');
      if (btnPay) btnPay.onclick = () => goToBillingWithTable(table.id);

      const btnClean = card.querySelector('.btn-act-clean');
      if (btnClean) btnClean.onclick = () => setTableStatus(table.id, 'AVAILABLE');

      DOM.tablesGrid.appendChild(card);
    });
  }

  function getTableActionButtons(table) {
    if (table.status === 'AVAILABLE') {
      return `
        <button class="btn-table-action primary btn-act-open">🚀 Abrir Mesa</button>
      `;
    }
    if (table.status === 'OCCUPIED') {
      return `
        <button class="btn-table-action primary btn-act-pos">📝 Comanda</button>
        <button class="btn-table-action btn-act-pay">🧾 Cobrar</button>
      `;
    }
    if (table.status === 'PAYING') {
      return `
        <button class="btn-table-action primary btn-act-pay">💳 Cobro COP</button>
      `;
    }
    if (table.status === 'CLEANING') {
      return `
        <button class="btn-table-action primary btn-act-clean">✨ Mesa Lista</button>
      `;
    }
    return `
      <button class="btn-table-action primary btn-act-open">🚀 Habilitar</button>
    `;
  }

  // Filtros de Zonas
  DOM.zoneButtons.forEach(btn => {
    btn.onclick = () => {
      DOM.zoneButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.activeZone = btn.dataset.zone;
      renderTables();
    };
  });

  // Modal Abrir Mesa
  function openModalOpenTable(table) {
    DOM.modalOpenTableId.value = table.id;
    DOM.modalTableNumberSpan.textContent = table.number;
    DOM.modalOpenTable.classList.add('open');
  }

  DOM.btnConfirmOpenTable.onclick = async () => {
    const tableId = DOM.modalOpenTableId.value;
    const waiter = DOM.modalWaiterName.value || 'Carlos Mesero';
    const diners = parseInt(DOM.modalDinerCount.value) || 2;
    const sessionId = `sess-${Date.now()}`;

    // Actualizar mesa en local o backend
    await setTableStatus(tableId, 'OCCUPIED', sessionId, waiter, diners);
    DOM.modalOpenTable.classList.remove('open');
    showToast(`Mesa #${tableId.replace('tab-', '')} abierta por ${waiter}`);
    goToPosWithTable(tableId);
  };

  async function setTableStatus(tableId, status, sessionId = null, waiter = '', diners = 2) {
    const table = STATE.tables.find(t => t.id === tableId);
    if (table) {
      table.status = status;
      if (status === 'OCCUPIED') {
        table.currentSessionId = sessionId || `sess-${Date.now()}`;
        table.openedAt = Date.now();
        table.waiterName = waiter;
        table.dinerCount = diners;
      } else if (status === 'AVAILABLE') {
        table.currentSessionId = null;
        table.openedAt = null;
      }
    }

    try {
      await fetch(`${API_BASE}/api/tables/${tableId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, currentSessionId: sessionId })
      });
    } catch (_) {}

    renderTables();
    populatePosTableSelect();
    populateBillingSelect();
    saveOfflineState();
  }

  // =========================================================================
  // MÓDULO 2: TPV COMANDAS & CATÁLOGO
  // =========================================================================
  function renderPosCatalog() {
    DOM.productsGrid.innerHTML = '';
    const query = DOM.posSearchInput.value.toLowerCase().trim();

    let filtered = STATE.products;
    if (STATE.activePosStation !== 'ALL') {
      filtered = filtered.filter(p => p.station === STATE.activePosStation);
    }
    if (query) {
      filtered = filtered.filter(p => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query));
    }

    filtered.forEach(product => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.innerHTML = `
        <div class="product-top">
          <span class="product-station-badge ${product.station}">${product.station === 'KITCHEN' ? '🍳 Cocina' : '🍸 Barra'}</span>
          <span style="font-size: 0.75rem; color: var(--text-dim);">${product.category}</span>
        </div>
        <div class="product-name">${product.name}</div>
        <div class="product-price-cop">${formatCOP(product.salePriceCOP)}</div>
      `;

      card.onclick = () => openProductModifierModal(product);
      DOM.productsGrid.appendChild(card);
    });
  }

  // Búsqueda y Filtros de TPV
  DOM.posSearchInput.oninput = () => renderPosCatalog();

  DOM.posStationButtons.forEach(btn => {
    btn.onclick = () => {
      DOM.posStationButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.activePosStation = btn.dataset.station;
      renderPosCatalog();
    };
  });

  // Selección de Mesa en TPV
  function populatePosTableSelect() {
    DOM.posTableSelect.innerHTML = '<option value="">Seleccione mesa activa...</option>';
    STATE.tables.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `Mesa #${t.number} (${t.zone}) - ${t.status}`;
      DOM.posTableSelect.appendChild(opt);
    });
  }

  DOM.posTableSelect.onchange = (e) => {
    goToPosWithTable(e.target.value);
  };

  function goToPosWithTable(tableId) {
    STATE.selectedTableId = tableId;
    const table = STATE.tables.find(t => t.id === tableId);
    if (!table) return;

    DOM.posTableSelect.value = tableId;
    DOM.posActiveTableBadge.textContent = `Mesa #${table.number}`;
    DOM.posActiveSessionLabel.textContent = `Sesión de ${table.zone}`;
    DOM.posActiveSessionMeta.textContent = `Mesero: ${table.waiterName || 'Carlos Mesero'} | Comensales: ${table.dinerCount || 2}`;

    switchView('view-pos');
  }

  // Modal de Modificadores Rápidos
  let currentConfiguringProduct = null;
  function openProductModifierModal(product) {
    currentConfiguringProduct = product;
    STATE.selectedModifiersTemp = [];
    DOM.modalModProductName.textContent = `${product.name} (${formatCOP(product.salePriceCOP)})`;
    DOM.modalModNotes.value = '';

    // Resetear chips
    DOM.modChipsContainer.querySelectorAll('.chip-btn').forEach(c => c.classList.remove('selected'));
    DOM.modalModifiers.classList.add('open');
  }

  DOM.modChipsContainer.querySelectorAll('.chip-btn').forEach(chip => {
    chip.onclick = () => {
      chip.classList.toggle('selected');
      const mod = chip.dataset.mod;
      if (chip.classList.contains('selected')) {
        STATE.selectedModifiersTemp.push(mod);
      } else {
        STATE.selectedModifiersTemp = STATE.selectedModifiersTemp.filter(m => m !== mod);
      }
    };
  });

  DOM.btnConfirmAddWithMod.onclick = () => {
    if (!currentConfiguringProduct) return;
    const notes = DOM.modalModNotes.value.trim();
    const modifiers = [...STATE.selectedModifiersTemp];

    addItemToCart(currentConfiguringProduct, modifiers, notes);
    DOM.modalModifiers.classList.remove('open');
  };

  function addItemToCart(product, modifiers, notes) {
    const existing = STATE.currentCart.find(item =>
      item.product.id === product.id &&
      item.modifiers.join(',') === modifiers.join(',') &&
      item.notes === notes
    );

    if (existing) {
      existing.quantity += 1;
    } else {
      STATE.currentCart.push({
        product,
        quantity: 1,
        modifiers,
        notes
      });
    }

    renderCart();
  }

  function renderCart() {
    if (STATE.currentCart.length === 0) {
      DOM.cartItemsContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); margin-top: 2rem; font-size: 0.9rem;">
          No hay productos en la comanda.<br>Toca un producto para agregarlo.
        </div>
      `;
      DOM.cartSubtotal.textContent = formatCOP(0);
      DOM.cartTax.textContent = formatCOP(0);
      DOM.cartTotal.textContent = formatCOP(0);
      DOM.btnSubmitOrder.disabled = true;
      return;
    }

    DOM.cartItemsContainer.innerHTML = '';
    let subtotal = 0;

    STATE.currentCart.forEach((item, index) => {
      const itemSubtotal = item.product.salePriceCOP * item.quantity;
      subtotal += itemSubtotal;

      const row = document.createElement('div');
      row.className = 'cart-item-row';
      row.innerHTML = `
        <div class="cart-item-top">
          <span class="cart-item-name">${item.product.name}</span>
          <span class="cart-item-price">${formatCOP(itemSubtotal)}</span>
        </div>
        ${item.modifiers.length > 0 ? `
          <div class="cart-item-modifiers">
            ${item.modifiers.map(m => `<span class="modifier-tag">${m}</span>`).join('')}
          </div>
        ` : ''}
        ${item.notes ? `<div style="font-size: 0.75rem; color: var(--text-dim); font-style: italic;">Nota: ${item.notes}</div>` : ''}
        <div class="cart-item-controls">
          <div class="qty-control-group">
            <button class="btn-qty qty-btn btn-cart-dec" data-index="${index}">-</button>
            <span class="qty-display">${item.quantity}</span>
            <button class="btn-qty qty-btn btn-cart-inc" data-index="${index}">+</button>
          </div>
          <button class="btn-remove-item" data-index="${index}">Eliminar</button>
        </div>
      `;

      row.querySelector('.btn-cart-dec').onclick = () => {
        if (item.quantity > 1) {
          item.quantity -= 1;
        } else {
          STATE.currentCart.splice(index, 1);
        }
        renderCart();
      };

      row.querySelector('.btn-cart-inc').onclick = () => {
        item.quantity += 1;
        renderCart();
      };

      row.querySelector('.btn-remove-item').onclick = () => {
        STATE.currentCart.splice(index, 1);
        renderCart();
      };

      DOM.cartItemsContainer.appendChild(row);
    });

    const impoconsumo = Math.round(subtotal * 0.08);
    const total = subtotal + impoconsumo;

    DOM.cartSubtotal.textContent = formatCOP(subtotal);
    DOM.cartTax.textContent = formatCOP(impoconsumo);
    DOM.cartTotal.textContent = formatCOP(total);
    DOM.btnSubmitOrder.disabled = false;
  }

  DOM.btnClearCart.onclick = () => {
    STATE.currentCart = [];
    renderCart();
  };

  DOM.btnSubmitOrder.onclick = async () => {
    if (STATE.currentCart.length === 0) return;
    if (!STATE.selectedTableId) {
      showToast('Por favor seleccione una mesa primero', 'alert');
      return;
    }

    const table = STATE.tables.find(t => t.id === STATE.selectedTableId);
    const orderItems = STATE.currentCart.map(item => ({
      productId: item.product.id,
      productName: item.product.name,
      quantity: item.quantity,
      modifiers: item.modifiers.join(', '),
      notes: item.notes,
      station: item.product.station,
      unitPriceCOP: item.product.salePriceCOP
    }));

    // Simular o enviar al backend
    const newKdsTicket = {
      id: `ord-${Date.now()}`,
      orderNumber: Math.floor(100 + Math.random() * 900),
      tableNumber: table ? table.number : 1,
      tableName: `Mesa ${table ? table.number : 1}`,
      station: orderItems.some(i => i.station === 'KITCHEN') ? 'KITCHEN' : 'BAR',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      items: orderItems
    };

    STATE.kdsOrders.unshift(newKdsTicket);
    showToast(`Comanda #${newKdsTicket.orderNumber} enviada a producción`, 'success');

    try {
      await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: STATE.selectedTableId,
          sessionId: table ? table.currentSessionId : 'sess-1',
          items: orderItems
        })
      });
    } catch (_) {}

    STATE.currentCart = [];
    renderCart();
    renderKdsOrders();
    saveOfflineState();
  };

  // =========================================================================
  // MÓDULO 3: KDS COCINA & BARRA
  // =========================================================================
  function renderKdsOrders() {
    DOM.kdsOrdersGrid.innerHTML = '';
    const filtered = STATE.activeKdsStation === 'ALL'
      ? STATE.kdsOrders
      : STATE.kdsOrders.filter(o => o.station === STATE.activeKdsStation);

    DOM.kdsPendingBadge.textContent = filtered.filter(o => o.status !== 'SERVED').length;

    filtered.forEach(order => {
      const minutes = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
      let timerClass = 'kds-ontime';
      if (minutes >= 20) timerClass = 'kds-delayed';
      else if (minutes >= 10) timerClass = 'kds-warning';

      const ticket = document.createElement('div');
      ticket.className = 'kds-order-ticket';
      ticket.innerHTML = `
        <div class="kds-ticket-header">
          <div>
            <div class="kds-ticket-table-name">${order.tableName}</div>
            <span style="font-size: 0.75rem; color: var(--text-dim);">Ticket #${order.orderNumber} - ${order.station}</span>
          </div>
          <div class="kds-timer-badge ${timerClass}">
            ⏱️ ${minutes} min
          </div>
        </div>

        <div class="kds-ticket-items">
          ${order.items.map(it => `
            <div class="kds-ticket-item-row">
              <div class="kds-item-main">
                <span>${it.quantity}x ${it.productName}</span>
              </div>
              ${it.modifiers ? `<div class="kds-item-mod">⚡ ${it.modifiers}</div>` : ''}
              ${it.notes ? `<div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">📝 ${it.notes}</div>` : ''}
            </div>
          `).join('')}
        </div>

        <div class="kds-ticket-footer">
          <button class="btn-kds-step btn-kds-prep" data-id="${order.id}">⏳ En Marcha</button>
          <button class="btn-kds-step btn-kds-ready" data-id="${order.id}">🔔 Listo</button>
          <button class="btn-kds-step btn-kds-done" data-id="${order.id}">✅ Despachar</button>
        </div>
      `;

      ticket.querySelector('.btn-kds-prep').onclick = () => updateOrderStatus(order.id, 'IN_PREPARATION');
      ticket.querySelector('.btn-kds-ready').onclick = () => updateOrderStatus(order.id, 'READY');
      ticket.querySelector('.btn-kds-done').onclick = () => updateOrderStatus(order.id, 'SERVED');

      DOM.kdsOrdersGrid.appendChild(ticket);
    });
  }

  async function updateOrderStatus(orderId, status) {
    const order = STATE.kdsOrders.find(o => o.id === orderId);
    if (order) {
      order.status = status;
      if (status === 'SERVED') {
        STATE.kdsOrders = STATE.kdsOrders.filter(o => o.id !== orderId);
      }
    }

    try {
      await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
    } catch (_) {}

    showToast(`Comanda #${order ? order.orderNumber : ''} marcada como ${status}`, 'success');
    renderKdsOrders();
    saveOfflineState();
  }

  DOM.kdsFilterButtons.forEach(btn => {
    btn.onclick = () => {
      DOM.kdsFilterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.activeKdsStation = btn.dataset.station;
      renderKdsOrders();
    };
  });

  // Temporizador de refresco KDS continuo
  setInterval(() => {
    if (STATE.activeView === 'view-kds') {
      renderKdsOrders();
    }
  }, 30000);

  // =========================================================================
  // MÓDULO 4: FACTURACIÓN & COBRO COP
  // =========================================================================
  function populateBillingSelect() {
    DOM.billingTableSelect.innerHTML = '<option value="">Seleccione mesa activa...</option>';
    STATE.tables.forEach(t => {
      if (t.status === 'OCCUPIED' || t.status === 'PAYING') {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `Mesa #${t.number} (${t.zone}) - $ Activa`;
        DOM.billingTableSelect.appendChild(opt);
      }
    });
  }

  DOM.billingTableSelect.onchange = (e) => {
    goToBillingWithTable(e.target.value);
  };

  function goToBillingWithTable(tableId) {
    STATE.selectedTableId = tableId;
    DOM.billingTableSelect.value = tableId;
    const table = STATE.tables.find(t => t.id === tableId);
    if (!table) return;

    DOM.invTableMeta.textContent = `Mesa: #${table.number} (${table.zone}) | Sesión: ${table.currentSessionId || 'sess-activo'}`;
    calculateAndRenderInvoice(table);
    switchView('view-billing');
  }

  let activeInvoiceData = { subtotal: 0, tax: 0, tip: 0, grandTotal: 0, items: [] };

  // Helper para obtener comandas reales de la mesa seleccionada (BUG-004)
  function getTableComandaItems(table) {
    if (!table) return [];
    const tableOrders = STATE.kdsOrders.filter(o =>
      o.tableNumber === table.number ||
      o.tableName === `Mesa ${table.number}` ||
      o.tableId === table.id
    );

    const itemsMap = new Map();
    tableOrders.forEach(order => {
      (order.items || []).forEach(item => {
        let price = Number(item.unitPriceCOP) || 0;
        if (!price) {
          const prod = STATE.products.find(p => (p.name || '').toLowerCase() === (item.productName || item.name || '').toLowerCase());
          price = prod ? prod.salePriceCOP : 25000;
        }
        const name = item.productName || item.name || 'Producto';
        const key = `${name}__${item.modifiers || ''}__${price}`;
        const qty = Number(item.quantity || item.qty) || 1;

        if (itemsMap.has(key)) {
          const existing = itemsMap.get(key);
          existing.qty += qty;
        } else {
          itemsMap.set(key, {
            id: item.id || `item-${Math.random().toString(36).substr(2, 9)}`,
            name,
            qty,
            price,
            modifiers: item.modifiers || '',
            notes: item.notes || ''
          });
        }
      });
    });

    return Array.from(itemsMap.values());
  }

  // Facturación Dinámica con Comandas Reales (BUG-004)
  function renderBillingView(tableParam) {
    const table = tableParam || STATE.tables.find(t => t.id === STATE.selectedTableId);
    if (!table) {
      DOM.invoiceItemsList.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 2rem 0; font-size: 0.9rem;">
          Seleccione una mesa para visualizar su pre-cuenta y facturar.
        </div>
      `;
      activeInvoiceData = { subtotal: 0, tax: 0, tip: 0, grandTotal: 0, items: [] };
      DOM.invSubtotalVal.textContent = formatCOP(0);
      DOM.invTaxVal.textContent = formatCOP(0);
      DOM.invTipVal.textContent = formatCOP(0);
      DOM.invGrandTotalVal.textContent = formatCOP(0);
      updateCashChange();
      return;
    }

    DOM.invTableMeta.textContent = `Mesa: #${table.number} (${table.zone}) | Sesión: ${table.currentSessionId || 'sess-activo'}`;
    const items = getTableComandaItems(table);
    DOM.invoiceItemsList.innerHTML = '';
    let subtotal = 0;

    if (items.length === 0) {
      DOM.invoiceItemsList.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 2rem 0; font-size: 0.9rem;">
          Mesa #${table.number} sin comandas registradas en el sistema.<br>Agregue productos en TPV.
        </div>
      `;
    } else {
      items.forEach(item => {
        const lineTotal = item.qty * item.price;
        subtotal += lineTotal;

        const row = document.createElement('div');
        row.className = 'invoice-item-line';
        row.innerHTML = `
          <div>
            <div style="font-weight: 600;">${item.qty}x ${item.name}</div>
            ${item.modifiers ? `<div style="font-size: 0.75rem; color: var(--accent-gold);">⚡ ${item.modifiers}</div>` : ''}
            ${item.notes ? `<div style="font-size: 0.75rem; color: var(--text-dim); font-style: italic;">📝 ${item.notes}</div>` : ''}
          </div>
          <span style="font-weight: 600;">${formatCOP(lineTotal)}</span>
        `;
        DOM.invoiceItemsList.appendChild(row);
      });
    }

    const tax = Math.round(subtotal * 0.08); // Impoconsumo 8%
    const includeTip = DOM.tipSwitch.checked;
    const tip = includeTip ? Math.round(subtotal * 0.10) : 0; // Propina voluntaria 10%
    const grandTotal = subtotal + tax + tip;

    activeInvoiceData = { subtotal, tax, tip, grandTotal, items };

    DOM.invSubtotalVal.textContent = formatCOP(subtotal);
    DOM.invTaxVal.textContent = formatCOP(tax);
    DOM.invTipVal.textContent = formatCOP(tip);
    DOM.invGrandTotalVal.textContent = formatCOP(grandTotal);

    updateCashChange();

    if (DOM.splitPanelEqual && DOM.splitPanelEqual.style.display !== 'none') {
      calculateSplitEqual();
    }
    if (DOM.splitPanelItems && DOM.splitPanelItems.style.display !== 'none') {
      renderSplitItemsPanel();
    }
  }

  function goToBillingWithTable(tableId) {
    STATE.selectedTableId = tableId;
    DOM.billingTableSelect.value = tableId;
    const table = STATE.tables.find(t => t.id === tableId);
    if (!table) return;

    renderBillingView(table);
    switchView('view-billing');
  }

  DOM.tipSwitch.onchange = () => {
    const table = STATE.tables.find(t => t.id === STATE.selectedTableId);
    renderBillingView(table);
  };

  // Cambio de pestaña de división
  DOM.splitTabNone.onclick = () => {
    DOM.splitTabNone.classList.add('active');
    DOM.splitTabEqual.classList.remove('active');
    DOM.splitTabItems.classList.remove('active');
    DOM.splitPanelEqual.style.display = 'none';
    if (DOM.splitPanelItems) DOM.splitPanelItems.style.display = 'none';
  };

  DOM.splitTabEqual.onclick = () => {
    DOM.splitTabEqual.classList.add('active');
    DOM.splitTabNone.classList.remove('active');
    DOM.splitTabItems.classList.remove('active');
    DOM.splitPanelEqual.style.display = 'block';
    if (DOM.splitPanelItems) DOM.splitPanelItems.style.display = 'none';
    calculateSplitEqual();
  };

  DOM.splitTabItems.onclick = () => {
    DOM.splitTabItems.classList.add('active');
    DOM.splitTabNone.classList.remove('active');
    DOM.splitTabEqual.classList.remove('active');
    DOM.splitPanelEqual.style.display = 'none';
    if (DOM.splitPanelItems) {
      DOM.splitPanelItems.style.display = 'block';
      renderSplitItemsPanel();
    }
  };

  DOM.btnCalcSplitEqual.onclick = calculateSplitEqual;

  function calculateSplitEqual() {
    const diners = parseInt(DOM.splitEqualDiners.value) || 2;
    const total = activeInvoiceData.grandTotal;
    const baseShare = Math.floor(total / diners);
    const remainder = total % diners;

    DOM.splitEqualResult.innerHTML = `
      ${diners} personas: ${formatCOP(baseShare)} c/u
      ${remainder > 0 ? `<div style="font-size: 0.8rem; color: var(--text-dim);">(1 persona absorbe residuo de $${remainder} COP)</div>` : ''}
    `;
  }

  // =========================================================================
  // MÓDULO 4B: SPLIT POR ÍTEMS Y SUBFACTURAS (BUG-003)
  // =========================================================================
  let splitItemsDinersCount = 2;
  const splitAssignments = {}; // { [itemKey]: dinerNumber }

  function setupSplitItemsControls() {
    if (DOM.btnSplitItemsDec) {
      DOM.btnSplitItemsDec.onclick = () => {
        if (splitItemsDinersCount > 2) {
          splitItemsDinersCount--;
          DOM.splitItemsDinersCount.value = splitItemsDinersCount;
          renderSplitItemsPanel();
        }
      };
    }
    if (DOM.btnSplitItemsInc) {
      DOM.btnSplitItemsInc.onclick = () => {
        if (splitItemsDinersCount < 10) {
          splitItemsDinersCount++;
          DOM.splitItemsDinersCount.value = splitItemsDinersCount;
          renderSplitItemsPanel();
        }
      };
    }
    if (DOM.btnCalcSplitItems) {
      DOM.btnCalcSplitItems.onclick = calculateSplitItemsSubinvoices;
    }
  }

  function renderSplitItemsPanel() {
    if (!DOM.splitItemsAssignmentList) return;
    const items = activeInvoiceData.items || [];
    DOM.splitItemsDinersCount.value = splitItemsDinersCount;

    if (items.length === 0) {
      DOM.splitItemsAssignmentList.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 1.5rem 0; font-size: 0.88rem;">
          No hay ítems registrados en la comanda de esta mesa para dividir.
        </div>
      `;
      DOM.splitItemsResultsContainer.innerHTML = '';
      return;
    }

    DOM.splitItemsAssignmentList.innerHTML = '';

    // Desglosar unidades para asignación individual si qty > 1
    const flatItems = [];
    items.forEach((item, originalIdx) => {
      for (let q = 1; q <= item.qty; q++) {
        flatItems.push({
          key: `${originalIdx}_${q}`,
          label: item.qty > 1 ? `${item.name} (#${q})` : item.name,
          price: item.price,
          originalItem: item
        });
      }
    });

    flatItems.forEach((fItem, fIdx) => {
      if (!splitAssignments[fItem.key]) {
        // Asignación por defecto distribuida
        splitAssignments[fItem.key] = (fIdx % splitItemsDinersCount) + 1;
      }
      if (splitAssignments[fItem.key] > splitItemsDinersCount) {
        splitAssignments[fItem.key] = 1;
      }

      const row = document.createElement('div');
      row.className = 'split-item-row';

      let optionsHtml = '';
      for (let d = 1; d <= splitItemsDinersCount; d++) {
        const isSel = splitAssignments[fItem.key] === d ? 'selected' : '';
        optionsHtml += `<option value="${d}" ${isSel}>👤 Comensal ${d}</option>`;
      }

      row.innerHTML = `
        <div class="split-item-info">
          <span class="split-item-title">${fItem.label}</span>
          <span class="split-item-meta">${formatCOP(fItem.price)}</span>
        </div>
        <select class="split-seat-select" data-key="${fItem.key}">
          ${optionsHtml}
        </select>
      `;

      row.querySelector('.split-seat-select').onchange = (e) => {
        splitAssignments[fItem.key] = parseInt(e.target.value) || 1;
        calculateSplitItemsSubinvoices();
      };

      DOM.splitItemsAssignmentList.appendChild(row);
    });

    calculateSplitItemsSubinvoices();
  }

  function calculateSplitItemsSubinvoices() {
    if (!DOM.splitItemsResultsContainer) return;
    const items = activeInvoiceData.items || [];
    if (items.length === 0) {
      DOM.splitItemsResultsContainer.innerHTML = '';
      return;
    }

    const flatItems = [];
    items.forEach((item, originalIdx) => {
      for (let q = 1; q <= item.qty; q++) {
        flatItems.push({
          key: `${originalIdx}_${q}`,
          label: item.qty > 1 ? `${item.name} (#${q})` : item.name,
          price: item.price
        });
      }
    });

    const dinerSubtotals = {};
    const dinerItems = {};
    for (let d = 1; d <= splitItemsDinersCount; d++) {
      dinerSubtotals[d] = 0;
      dinerItems[d] = [];
    }

    flatItems.forEach(fItem => {
      const assignedDiner = splitAssignments[fItem.key] || 1;
      const diner = (assignedDiner <= splitItemsDinersCount) ? assignedDiner : 1;
      dinerSubtotals[diner] += fItem.price;
      dinerItems[diner].push(fItem);
    });

    const includeTip = DOM.tipSwitch.checked;
    DOM.splitItemsResultsContainer.innerHTML = '';

    let grandSumSubinvoices = 0;

    for (let d = 1; d <= splitItemsDinersCount; d++) {
      const sub = dinerSubtotals[d];
      const tax = Math.round(sub * 0.08); // 8% Impoconsumo
      const tip = includeTip ? Math.round(sub * 0.10) : 0; // 10% Propina
      const total = sub + tax + tip;
      grandSumSubinvoices += total;

      const card = document.createElement('div');
      card.className = 'subinvoice-card';
      card.innerHTML = `
        <div class="subinvoice-header">
          <span>👤 Subfactura Comensal ${d}</span>
          <span style="font-size: 0.82rem; color: var(--text-dim);">${dinerItems[d].length} ítem(s)</span>
        </div>
        <div class="subinvoice-items-list">
          ${dinerItems[d].length > 0
            ? dinerItems[d].map(it => `<div>• ${it.label}: <strong>${formatCOP(it.price)}</strong></div>`).join('')
            : '<div style="font-style: italic; color: var(--text-dim);">Sin ítems asignados</div>'
          }
        </div>
        <div class="subinvoice-totals-breakdown">
          <div style="display: flex; justify-content: space-between;">
            <span>Subtotal Neto:</span>
            <span>${formatCOP(sub)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Impoconsumo (8%):</span>
            <span>${formatCOP(tax)}</span>
          </div>
          ${includeTip ? `
            <div style="display: flex; justify-content: space-between; color: var(--color-available);">
              <span>Propina Vol. (10%):</span>
              <span>${formatCOP(tip)}</span>
            </div>
          ` : ''}
        </div>
        <div class="subinvoice-grand-total">
          <span>Total Comensal ${d}:</span>
          <span style="color: var(--accent-gold);">${formatCOP(total)}</span>
        </div>
      `;
      DOM.splitItemsResultsContainer.appendChild(card);
    }

    // Badge de validación de la suma total
    const summaryBadge = document.createElement('div');
    summaryBadge.style.cssText = 'background: var(--bg-surface-elevated); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem;';
    summaryBadge.innerHTML = `
      <span>Total Suma Subfacturas:</span>
      <strong style="color: var(--accent-gold); font-size: 1rem;">${formatCOP(grandSumSubinvoices)}</strong>
    `;
    DOM.splitItemsResultsContainer.appendChild(summaryBadge);
  }

  // Métodos de Pago
  let selectedPaymentMethod = 'CASH';
  DOM.paymentMethodButtons.forEach(btn => {
    btn.onclick = () => {
      DOM.paymentMethodButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPaymentMethod = btn.dataset.method;
    };
  });

  DOM.cashReceivedInput.oninput = updateCashChange;

  function updateCashChange() {
    const received = Number(DOM.cashReceivedInput.value) || 0;
    const total = activeInvoiceData.grandTotal;
    const change = Math.max(0, received - total);
    DOM.cashChangeDisplay.textContent = `Cambio a Devolver: ${formatCOP(change)}`;
  }

  DOM.btnExecuteCheckout.onclick = async () => {
    if (!STATE.selectedTableId) {
      showToast('Seleccione una mesa a cobrar', 'alert');
      return;
    }

    const table = STATE.tables.find(t => t.id === STATE.selectedTableId);
    const amountPaid = activeInvoiceData.grandTotal;

    // Acumular para auditoría y cierre de turno con medios de pago reales
    if (selectedPaymentMethod === 'CASH') STATE.shiftAudit.cashSales += amountPaid;
    else if (selectedPaymentMethod === 'CARD') STATE.shiftAudit.cardSales += amountPaid;
    else STATE.shiftAudit.transferSales += amountPaid;
    STATE.shiftAudit.totalSales += amountPaid;

    // Registrar en historial de facturas
    if (!STATE.invoices) STATE.invoices = [];
    STATE.invoices.push({
      id: `inv-${Date.now()}`,
      tableId: STATE.selectedTableId,
      tableName: table ? `Mesa ${table.number}` : '',
      items: activeInvoiceData.items || [],
      subtotal: activeInvoiceData.subtotal,
      tax: activeInvoiceData.tax,
      tip: activeInvoiceData.tip,
      grandTotal: amountPaid,
      paymentMethod: selectedPaymentMethod,
      timestamp: new Date().toISOString()
    });

    // Archivar comandas de esta mesa en KDS
    STATE.kdsOrders = STATE.kdsOrders.filter(o =>
      !(o.tableNumber === table?.number || o.tableName === `Mesa ${table?.number}` || o.tableId === table?.id)
    );

    showToast(`Pago procesado exitosamente por ${formatCOP(amountPaid)} (${selectedPaymentMethod})`, 'success');

    // Liberar mesa a estado CLEANING
    await setTableStatus(STATE.selectedTableId, 'CLEANING');
    saveOfflineState();
    switchView('view-tables');
  };

  // =========================================================================
  // MÓDULO 5: AUDITORÍA Y CIERRE CIEGO (BUG-002)
  // =========================================================================
  function executeBlindClose() {
    const cashDeclared = Number(DOM.auditCashDeclared.value) || 0;
    const cardDeclared = Number(DOM.auditCardDeclared.value) || 0;
    const transferDeclared = Number(DOM.auditTransferDeclared.value) || 0;
    const totalDeclared = cashDeclared + cardDeclared + transferDeclared;

    // Ventas reales del sistema desglosadas por medio de pago (sin valores en duro)
    const sysCash = Number(STATE.shiftAudit.cashSales) || 0;
    const sysCard = Number(STATE.shiftAudit.cardSales) || 0;
    const sysTransfer = Number(STATE.shiftAudit.transferSales) || 0;
    const sysTotal = Number(STATE.shiftAudit.totalSales) || (sysCash + sysCard + sysTransfer);

    const diff = totalDeclared - sysTotal;
    let badgeClass = 'diff-perfect';
    let statusText = 'CUADRADO PERFECTO ($0 COP)';

    if (diff > 0) {
      badgeClass = 'diff-surplus';
      statusText = `SOBRANTE DE CAJA (+${formatCOP(diff)})`;
    } else if (diff < 0) {
      badgeClass = 'diff-shortage';
      statusText = `FALTANTE DE CAJA (-${formatCOP(Math.abs(diff))})`;
    }

    DOM.auditResultsCard.classList.add('active');
    DOM.auditResultsContent.innerHTML = `
      <div class="audit-diff-badge ${badgeClass}">${statusText}</div>

      <div style="margin-top: 1.25rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.9rem;">
        <div style="background: var(--bg-surface); padding: 1rem; border-radius: var(--radius-md);">
          <strong>Totales Declarados por Cajero:</strong>
          <div style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
            <div>💵 Efectivo: ${formatCOP(cashDeclared)}</div>
            <div>💳 Datáfono: ${formatCOP(cardDeclared)}</div>
            <div>📱 Nequi/Davi: ${formatCOP(transferDeclared)}</div>
            <div style="font-weight: 700; border-top: 1px solid var(--border-subtle); padding-top: 0.25rem;">Total Declarado: ${formatCOP(totalDeclared)}</div>
          </div>
        </div>

        <div style="background: var(--bg-surface); padding: 1rem; border-radius: var(--radius-md);">
          <strong>Totales Registrados en Sistema:</strong>
          <div style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem;">
            <div>💵 Efectivo Sistema: ${formatCOP(sysCash)}</div>
            <div>💳 Datáfono Sistema: ${formatCOP(sysCard)}</div>
            <div>📱 Nequi/Davi Sistema: ${formatCOP(sysTransfer)}</div>
            <div style="font-weight: 700; border-top: 1px solid var(--border-subtle); padding-top: 0.25rem;">Total Sistema: ${formatCOP(sysTotal)}</div>
          </div>
        </div>
      </div>
    `;

    saveOfflineState();
    showToast('Cierre ciego ejecutado y archivado en auditoría', 'info');
  }

  DOM.btnSubmitBlindClose.onclick = executeBlindClose;

  // Cierre de modales con botón & backdrop/overlay (BUG-006)
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.onclick = () => {
      const modalId = btn.dataset.closeModal;
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('open');
    };
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(modal => {
        modal.classList.remove('open');
      });
    }
  });

  // --- ARRANQUE DE LA APLICACIÓN ---
  initClock();
  setupNavigation();
  initSSE();
  setupSplitItemsControls();
  loadInitialData();

  // Exponer utilidades para pruebas y validaciones QA
  window.saveOfflineState = saveOfflineState;
  window.loadOfflineState = loadOfflineState;
  window.renderBillingView = renderBillingView;
  window.executeBlindClose = executeBlindClose;
  window.STATE = STATE;

})();
