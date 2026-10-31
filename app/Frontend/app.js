/**
 * COMMANDA SaaS - Frontend Interactive Application
 * Sistema Integral de Comandas Táctil, KDS, Facturación COP y Cierre Ciego
 */

(function () {
  'use strict';

  // --- CONFIGURACIÓN & ESTADO GLOBAL ---
  function getApiBase() {
    const customUrl = localStorage.getItem('comanda_api_url');
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/+$/, '');
    }
    if (window.ENV_API_URL && typeof window.ENV_API_URL === 'string' && window.ENV_API_URL.trim()) {
      return window.ENV_API_URL.trim().replace(/\/+$/, '');
    }
    return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? 'http://localhost:3001'
      : window.location.origin;
  }

  let API_BASE = getApiBase();

  const STATE = {
    activeView: 'view-tables',
    activeZone: 'ALL',
    activeKdsStation: 'ALL',
    activePosStation: 'ALL',
    activeCatalogStation: 'ALL',
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
    btnBackendConfig: document.getElementById('btn-backend-config'),
    modalBackendConfig: document.getElementById('modal-backend-config'),
    backendUrlInput: document.getElementById('backend-url-input'),
    backendCurrentUrlDisplay: document.getElementById('backend-current-url-display'),
    btnSaveBackendUrl: document.getElementById('btn-save-backend-url'),
    btnResetBackendUrl: document.getElementById('btn-reset-backend-url'),
    formBackendConfig: document.getElementById('form-backend-config'),
    sseBadge: document.getElementById('sse-status-badge'),
    sseText: document.getElementById('sse-status-text'),
    clock: document.getElementById('digital-clock'),
    kdsPendingBadge: document.getElementById('kds-pending-badge'),
    
    // Mesas
    tablesGrid: document.getElementById('tables-grid'),
    zoneButtons: document.querySelectorAll('.zone-btn'),
    btnNewTable: document.getElementById('btn-new-table'),
    
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

    // Catálogo Menú
    catalogProductsGrid: document.getElementById('catalog-products-grid'),
    catalogSearchInput: document.getElementById('catalog-search-input'),
    catalogFilterButtons: document.querySelectorAll('.catalog-filter-btn'),
    btnNewProduct: document.getElementById('btn-new-product'),

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
    
    modalTableForm: document.getElementById('modal-table-form'),
    modalTableFormTitle: document.getElementById('modal-table-form-title'),
    formTableManage: document.getElementById('form-table-manage'),
    tableFormId: document.getElementById('table-form-id'),
    tableFormNumber: document.getElementById('table-form-number'),
    tableFormZone: document.getElementById('table-form-zone'),
    tableFormCapacity: document.getElementById('table-form-capacity'),
    btnSaveTable: document.getElementById('btn-save-table'),

    modalProductForm: document.getElementById('modal-product-form'),
    modalProductFormTitle: document.getElementById('modal-product-form-title'),
    formProductManage: document.getElementById('form-product-manage'),
    productFormId: document.getElementById('product-form-id'),
    productFormName: document.getElementById('product-form-name'),
    productFormCategory: document.getElementById('product-form-category'),
    productFormStation: document.getElementById('product-form-station'),
    productFormPrice: document.getElementById('product-form-price'),
    productFormAvailable: document.getElementById('product-form-available'),
    btnSaveProduct: document.getElementById('btn-save-product'),

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
    if (viewId === 'view-catalog') renderMenuCatalog();
    if (viewId === 'view-billing') populateBillingSelect();
  }

  // --- SERVIDOR SSE (Server-Sent Events) ---
  function initSSE() {
    if (STATE.sseEventSource) {
      try {
        STATE.sseEventSource.close();
      } catch (_) {}
      STATE.sseEventSource = null;
    }

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
        products: STATE.products,
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
        if (Array.isArray(data.products) && data.products.length > 0) {
          STATE.products = data.products;
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
        const rawProducts = await resProducts.json();
        STATE.products = Array.isArray(rawProducts)
          ? rawProducts.map(p => {
              const rawAvail = p.isAvailable ?? p.isavailable;
              return {
                ...p,
                salePriceCOP: Number(p.salePriceCOP ?? p.salepricecop ?? 0),
                isAvailable: rawAvail === undefined
                  ? true
                  : (rawAvail === true || rawAvail === 1 || rawAvail === 'true' || rawAvail === 't' || rawAvail === '1')
              };
            })
          : [];
        STATE.isBackendOnline = true;
        apiSuccess = true;
        await loadKdsOrders();
        saveOfflineState();
      } else {
        throw new Error('Fallback a almacenamiento local');
      }
    } catch (_) {
      // Modo Offline: Intentar restaurar desde localStorage
      const hasOffline = loadOfflineState();

      if (!hasOffline || !STATE.products || STATE.products.length === 0) {
        STATE.products = JSON.parse(JSON.stringify(MOCK_PRODUCTS));
      }
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
    renderMenuCatalog();
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
          <div class="table-card-top-right">
            <span class="table-status-badge">${statusMap[table.status] || table.status}</span>
            <div class="table-card-quick-actions">
              <button type="button" class="btn-table-icon btn-edit-table" title="Editar mesa #${table.number}" aria-label="Editar mesa #${table.number}">✏️</button>
              <button type="button" class="btn-table-icon btn-delete-table" title="Eliminar mesa #${table.number}" aria-label="Eliminar mesa #${table.number}">🗑️</button>
            </div>
          </div>
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

      // Botones CRUD Editar y Eliminar
      const btnEdit = card.querySelector('.btn-edit-table');
      if (btnEdit) btnEdit.onclick = (e) => {
        e.stopPropagation();
        openModalEditTable(table);
      };

      const btnDelete = card.querySelector('.btn-delete-table');
      if (btnDelete) btnDelete.onclick = (e) => {
        e.stopPropagation();
        handleDeleteTable(table);
      };

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
    const waiter = DOM.modalWaiterName.value || 'Mesero de Turno';
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

  // --- CRUD DE MESAS (Añadir, Editar y Eliminar) ---
  function openModalNewTable() {
    if (!DOM.modalTableForm) return;
    DOM.tableFormId.value = '';
    DOM.modalTableFormTitle.textContent = '➕ Nueva Mesa';
    
    // Sugerir el siguiente número de mesa disponible
    const existingNums = STATE.tables.map(t => Number(t.number) || 0);
    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    DOM.tableFormNumber.value = nextNum;
    DOM.tableFormCapacity.value = 4;
    DOM.tableFormZone.value = (STATE.activeZone !== 'ALL') ? STATE.activeZone : 'Salón Principal';
    
    DOM.modalTableForm.classList.add('open');
  }

  function openModalEditTable(table) {
    if (!DOM.modalTableForm) return;
    DOM.tableFormId.value = table.id;
    DOM.modalTableFormTitle.textContent = `✏️ Editar Mesa #${table.number}`;
    DOM.tableFormNumber.value = table.number;
    DOM.tableFormZone.value = table.zone;
    DOM.tableFormCapacity.value = table.capacity;
    
    DOM.modalTableForm.classList.add('open');
  }

  async function handleSaveTable(e) {
    if (e && e.preventDefault) e.preventDefault();
    const id = DOM.tableFormId.value.trim();
    const number = parseInt(DOM.tableFormNumber.value, 10);
    const zone = DOM.tableFormZone.value.trim();
    const capacity = parseInt(DOM.tableFormCapacity.value, 10);

    if (!number || number <= 0) {
      showToast('Por favor ingresa un número de mesa válido mayor a 0', 'alert');
      return;
    }
    if (!zone) {
      showToast('Por favor selecciona una zona para la mesa', 'alert');
      return;
    }
    if (!capacity || capacity <= 0) {
      showToast('La capacidad de comensales debe ser mayor a 0', 'alert');
      return;
    }

    // Verificar si el número de mesa ya está en uso por otra mesa
    const duplicate = STATE.tables.find(t => Number(t.number) === number && t.id !== id);
    if (duplicate) {
      showToast(`El número de mesa ${number} ya existe en el establecimiento`, 'alert');
      return;
    }

    if (!id) {
      // POST /api/tables (Crear mesa)
      const newTable = {
        id: `tab-${Date.now()}`,
        number,
        zone,
        capacity,
        status: 'AVAILABLE',
        currentSessionId: null,
        openedAt: null
      };

      try {
        const res = await fetch(`${API_BASE}/api/tables`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number, zone, capacity })
        });
        if (res.ok) {
          const created = await res.json();
          if (created && created.id) newTable.id = created.id;
        }
      } catch (_) {}

      STATE.tables.push(newTable);
      showToast(`Mesa #${number} creada exitosamente en ${zone}`, 'success');
    } else {
      // PUT /api/tables/:id (Editar mesa)
      const table = STATE.tables.find(t => t.id === id);
      if (table) {
        table.number = number;
        table.zone = zone;
        table.capacity = capacity;
      }

      try {
        await fetch(`${API_BASE}/api/tables/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number, zone, capacity })
        });
      } catch (_) {}

      showToast(`Mesa #${number} actualizada exitosamente`, 'success');
    }

    if (DOM.modalTableForm) DOM.modalTableForm.classList.remove('open');
    renderTables();
    populatePosTableSelect();
    populateBillingSelect();
    saveOfflineState();
  }

  async function handleDeleteTable(table) {
    if (table.status === 'OCCUPIED' || table.status === 'PAYING') {
      showToast(`No se puede eliminar la Mesa #${table.number} porque se encuentra ${table.status === 'OCCUPIED' ? 'ocupada' : 'en proceso de cobro'}.`, 'alert');
      return;
    }

    if (!confirm(`¿Estás seguro de que deseas eliminar la Mesa #${table.number} (${table.zone})?`)) {
      return;
    }

    try {
      await fetch(`${API_BASE}/api/tables/${table.id}`, {
        method: 'DELETE'
      });
    } catch (_) {}

    STATE.tables = STATE.tables.filter(t => t.id !== table.id);
    if (STATE.selectedTableId === table.id) {
      STATE.selectedTableId = null;
    }

    showToast(`Mesa #${table.number} eliminada del plano`, 'info');
    renderTables();
    populatePosTableSelect();
    populateBillingSelect();
    saveOfflineState();
  }

  if (DOM.btnNewTable) DOM.btnNewTable.onclick = openModalNewTable;
  if (DOM.btnSaveTable) DOM.btnSaveTable.onclick = handleSaveTable;
  if (DOM.formTableManage) DOM.formTableManage.onsubmit = handleSaveTable;

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
      const isUnavailable = product.isAvailable === false;
      const card = document.createElement('div');
      card.className = `product-card${isUnavailable ? ' product-card-unavailable' : ''}`;
      card.innerHTML = `
        <div class="product-top">
          <div class="product-top-badges">
            <span class="product-station-badge ${product.station}">${product.station === 'KITCHEN' ? '🍳 Cocina' : '🍸 Barra'}</span>
            ${isUnavailable ? '<span class="product-unavailable-badge badge-unavailable">Agotado</span>' : ''}
          </div>
          <span style="font-size: 0.75rem; color: var(--text-dim);">${product.category}</span>
        </div>
        <div class="product-name">${product.name}</div>
        <div class="product-price-cop">${formatCOP(product.salePriceCOP)}</div>
      `;

      card.onclick = () => {
        if (isUnavailable) {
          showToast('Producto agotado temporalmente', 'info');
          return;
        }
        openProductModifierModal(product);
      };
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
    DOM.posActiveSessionMeta.textContent = `Mesero: ${table.waiterName || 'Mesero de Turno'} | Comensales: ${table.dinerCount || 2}`;

    switchView('view-pos');
  }

  // Modal de Modificadores Rápidos
  let currentConfiguringProduct = null;
  function openProductModifierModal(product) {
    if (product.isAvailable === false) {
      showToast('Producto agotado temporalmente', 'info');
      return;
    }
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
    if (product.isAvailable === false) {
      showToast('Producto agotado temporalmente', 'info');
      return;
    }
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

    const impoconsumo = 0; // Sin Impoconsumo
    const total = subtotal;

    DOM.cartSubtotal.textContent = formatCOP(subtotal);
    DOM.cartTax.textContent = formatCOP(0);
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

    // CORRECCIÓN KDS (Cocina vs. Barra):
    // Divide orderItems en kitchenItems (station === 'KITCHEN') y barItems (station === 'BAR')
    const kitchenItems = orderItems.filter(item => item.station === 'KITCHEN');
    const barItems = orderItems.filter(item => item.station === 'BAR');

    const generatedTickets = [];
    const baseOrderNum = Math.floor(100 + Math.random() * 800);

    // Si hay kitchenItems, genera un ticket KDS con station: 'KITCHEN' conteniendo ÚNICAMENTE los platos de cocina
    if (kitchenItems.length > 0) {
      const kitchenTicket = {
        id: `ord-${Date.now()}-kit`,
        orderNumber: baseOrderNum,
        tableNumber: table ? table.number : 1,
        tableName: `Mesa ${table ? table.number : 1}`,
        station: 'KITCHEN',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        items: kitchenItems
      };
      generatedTickets.push(kitchenTicket);
    }

    // Si hay barItems, genera un ticket KDS con station: 'BAR' conteniendo ÚNICAMENTE las bebidas de barra
    if (barItems.length > 0) {
      const barTicket = {
        id: `ord-${Date.now()}-bar`,
        orderNumber: kitchenItems.length > 0 ? baseOrderNum + 1 : baseOrderNum,
        tableNumber: table ? table.number : 1,
        tableName: `Mesa ${table ? table.number : 1}`,
        station: 'BAR',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        items: barItems
      };
      generatedTickets.push(barTicket);
    }

    // En caso de que no haya estación definida, fallback
    if (generatedTickets.length === 0 && orderItems.length > 0) {
      generatedTickets.push({
        id: `ord-${Date.now()}`,
        orderNumber: baseOrderNum,
        tableNumber: table ? table.number : 1,
        tableName: `Mesa ${table ? table.number : 1}`,
        station: 'KITCHEN',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        items: orderItems
      });
    }

    // Agregar tickets a la cola de KDS
    generatedTickets.forEach(ticket => {
      STATE.kdsOrders.unshift(ticket);
    });

    if (kitchenItems.length > 0 && barItems.length > 0) {
      showToast(`Comandas #${generatedTickets.map(t => t.orderNumber).join(' y #')} enviadas a Cocina y Barra`, 'success');
    } else if (kitchenItems.length > 0) {
      showToast(`Comanda #${generatedTickets[0].orderNumber} enviada a Cocina`, 'success');
    } else if (barItems.length > 0) {
      showToast(`Comanda #${generatedTickets[0].orderNumber} enviada a Barra`, 'success');
    }

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

    // Filtrado estricto por estación
    const filtered = STATE.activeKdsStation === 'ALL'
      ? STATE.kdsOrders
      : STATE.kdsOrders.filter(o => o.station === STATE.activeKdsStation);

    DOM.kdsPendingBadge.textContent = STATE.kdsOrders.filter(o => o.status !== 'SERVED').length;

    if (filtered.length === 0) {
      DOM.kdsOrdersGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🎉</div>
          <p style="font-size: 1.1rem; font-weight: 600;">No hay comandas pendientes en esta estación</p>
          <span style="font-size: 0.85rem; color: var(--text-dim);">Filtro activo: ${STATE.activeKdsStation === 'ALL' ? 'Todas las estaciones' : STATE.activeKdsStation === 'KITCHEN' ? '🍳 Cocina' : '🍸 Barra'}</span>
        </div>
      `;
      return;
    }

    filtered.forEach(order => {
      const minutes = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
      let timerClass = 'kds-ontime';
      if (minutes >= 20) timerClass = 'kds-delayed';
      else if (minutes >= 10) timerClass = 'kds-warning';

      const isKitchen = order.station === 'KITCHEN';
      const stationBadgeClass = isKitchen ? 'badge-kitchen' : 'badge-bar';
      const stationIcon = isKitchen ? '🍳' : '🍸';
      const stationLabel = isKitchen ? 'Cocina' : 'Barra';

      const ticket = document.createElement('div');
      ticket.className = `kds-order-ticket station-${order.station ? order.station.toLowerCase() : 'kitchen'}`;
      ticket.innerHTML = `
        <div class="kds-ticket-header">
          <div>
            <div class="kds-ticket-table-name">${order.tableName}</div>
            <div style="display: flex; gap: 0.4rem; align-items: center; margin-top: 0.2rem;">
              <span style="font-size: 0.75rem; color: var(--text-dim);">Ticket #${order.orderNumber}</span>
              <span class="kds-station-badge ${stationBadgeClass}">${stationIcon} ${stationLabel}</span>
            </div>
          </div>
          <div class="kds-timer-badge ${timerClass}">
            ⏱️ ${minutes} min
          </div>
        </div>

        <div class="kds-ticket-items">
          ${order.items.map(it => `
            <div class="kds-ticket-item-row">
              <div class="kds-item-main">
                <span><strong>${it.quantity}x</strong> ${it.productName}</span>
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

  // =========================================================================
  // MÓDULO: CRUD DEL MENÚ / CATÁLOGO DE PRODUCTOS (Lo que se va a vender)
  // =========================================================================
  function renderMenuCatalog() {
    if (!DOM.catalogProductsGrid) return;
    DOM.catalogProductsGrid.innerHTML = '';
    const query = DOM.catalogSearchInput ? DOM.catalogSearchInput.value.toLowerCase().trim() : '';

    let filtered = STATE.products || [];
    if (STATE.activeCatalogStation !== 'ALL') {
      filtered = filtered.filter(p => p.station === STATE.activeCatalogStation);
    }
    if (query) {
      filtered = filtered.filter(p =>
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.category && p.category.toLowerCase().includes(query))
      );
    }

    if (filtered.length === 0) {
      DOM.catalogProductsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔍</div>
          <p style="font-size: 1.1rem; font-weight: 600;">No se encontraron productos en el catálogo</p>
          <span style="font-size: 0.85rem; color: var(--text-dim);">Prueba con otros términos de búsqueda o registra un nuevo producto en el menú.</span>
        </div>
      `;
      return;
    }

    filtered.forEach(product => {
      const isKitchen = product.station === 'KITCHEN';
      const stationBadgeClass = isKitchen ? 'badge-kitchen' : 'badge-bar';
      const stationIcon = isKitchen ? '🍳' : '🍸';
      const stationLabel = isKitchen ? 'Cocina' : 'Barra';
      const isAvailable = product.isAvailable !== false;

      const card = document.createElement('div');
      card.className = `catalog-card ${isKitchen ? 'station-kitchen' : 'station-bar'}`;
      card.innerHTML = `
        <div>
          <div class="catalog-card-header">
            <div class="catalog-badges-wrap">
              <span class="catalog-category-badge">${product.category || 'General'}</span>
              <span class="kds-station-badge ${stationBadgeClass}">${stationIcon} ${stationLabel}</span>
            </div>
            <span class="catalog-avail-badge ${isAvailable ? 'available' : 'unavailable'}">
              ${isAvailable ? '✅ Disponible' : '❌ Agotado'}
            </span>
          </div>

          <h3 class="catalog-card-name">${product.name}</h3>
        </div>

        <div>
          <div class="catalog-card-price-row">
            <span style="font-size: 0.85rem; color: var(--text-muted);">Precio de Venta:</span>
            <span class="catalog-price-val">${formatCOP(product.salePriceCOP)}</span>
          </div>

          <div class="catalog-card-actions">
            <button type="button" class="btn-catalog-action edit btn-edit-product" data-id="${product.id}">
              ✏️ Editar
            </button>
            <button type="button" class="btn-catalog-action delete btn-delete-product" data-id="${product.id}">
              🗑️ Eliminar
            </button>
          </div>
        </div>
      `;

      card.querySelector('.btn-edit-product').onclick = () => openModalEditProduct(product);
      card.querySelector('.btn-delete-product').onclick = () => handleDeleteProduct(product);

      DOM.catalogProductsGrid.appendChild(card);
    });
  }

  function openModalNewProduct() {
    if (!DOM.modalProductForm) return;
    DOM.productFormId.value = '';
    DOM.modalProductFormTitle.textContent = '➕ Nuevo Producto';
    DOM.productFormName.value = '';
    DOM.productFormCategory.value = '';
    DOM.productFormStation.value = STATE.activeCatalogStation !== 'ALL' ? STATE.activeCatalogStation : 'KITCHEN';
    DOM.productFormPrice.value = '';
    DOM.productFormAvailable.value = 'true';
    DOM.modalProductForm.classList.add('open');
  }

  function openModalEditProduct(product) {
    if (!DOM.modalProductForm) return;
    DOM.productFormId.value = product.id;
    DOM.modalProductFormTitle.textContent = `✏️ Editar: ${product.name}`;
    DOM.productFormName.value = product.name;
    DOM.productFormCategory.value = product.category;
    DOM.productFormStation.value = product.station || 'KITCHEN';
    DOM.productFormPrice.value = product.salePriceCOP;
    DOM.productFormAvailable.value = product.isAvailable !== false ? 'true' : 'false';
    DOM.modalProductForm.classList.add('open');
  }

  async function handleSaveProduct(e) {
    if (e && e.preventDefault) e.preventDefault();
    const id = DOM.productFormId.value.trim();
    const name = DOM.productFormName.value.trim();
    const category = DOM.productFormCategory.value.trim();
    const station = DOM.productFormStation.value;
    const salePriceCOP = Math.round(Number(DOM.productFormPrice.value) || 0);
    const isAvailable = DOM.productFormAvailable.value === 'true';

    if (!name) {
      showToast('Por favor ingresa el nombre del producto', 'alert');
      return;
    }
    if (!category) {
      showToast('Por favor ingresa la categoría del producto', 'alert');
      return;
    }
    if (salePriceCOP < 0 || isNaN(salePriceCOP)) {
      showToast('El precio en COP debe ser mayor o igual a 0', 'alert');
      return;
    }

    if (!id) {
      // POST /api/products (Crear nuevo producto)
      const newProduct = {
        id: `prod-${Date.now()}`,
        name,
        category,
        station,
        salePriceCOP,
        isAvailable
      };

      try {
        const res = await fetch(`${API_BASE}/api/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, category, station, salePriceCOP, isAvailable })
        });
        if (res.ok) {
          const created = await res.json();
          if (created && created.id) newProduct.id = created.id;
        }
      } catch (_) {}

      STATE.products.push(newProduct);
      showToast(`Producto "${name}" agregado al menú`, 'success');
    } else {
      // PUT /api/products/:id (Editar producto existente)
      const product = STATE.products.find(p => p.id === id);
      if (product) {
        product.name = name;
        product.category = category;
        product.station = station;
        product.salePriceCOP = salePriceCOP;
        product.isAvailable = isAvailable;
      }

      try {
        await fetch(`${API_BASE}/api/products/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, category, station, salePriceCOP, isAvailable })
        });
      } catch (_) {}

      showToast(`Producto "${name}" actualizado`, 'success');
    }

    if (DOM.modalProductForm) DOM.modalProductForm.classList.remove('open');
    renderMenuCatalog();
    renderPosCatalog();
    saveOfflineState();
  }

  async function handleDeleteProduct(product) {
    if (!confirm(`¿Estás seguro de eliminar "${product.name}" del menú?`)) {
      return;
    }

    try {
      await fetch(`${API_BASE}/api/products/${product.id}`, {
        method: 'DELETE'
      });
    } catch (_) {}

    STATE.products = STATE.products.filter(p => p.id !== product.id);
    showToast(`Producto "${product.name}" eliminado del catálogo`, 'info');
    renderMenuCatalog();
    renderPosCatalog();
    saveOfflineState();
  }

  // Eventos de Catálogo
  if (DOM.btnNewProduct) DOM.btnNewProduct.onclick = openModalNewProduct;
  if (DOM.btnSaveProduct) DOM.btnSaveProduct.onclick = handleSaveProduct;
  if (DOM.formProductManage) DOM.formProductManage.onsubmit = handleSaveProduct;
  if (DOM.catalogSearchInput) {
    DOM.catalogSearchInput.oninput = () => renderMenuCatalog();
  }
  if (DOM.catalogFilterButtons) {
    DOM.catalogFilterButtons.forEach(btn => {
      btn.onclick = () => {
        DOM.catalogFilterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        STATE.activeCatalogStation = btn.dataset.station;
        renderMenuCatalog();
      };
    });
  }

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

    const tax = 0; // Sin Impoconsumo
    const tip = 0; // Sin Propina
    const grandTotal = subtotal;

    activeInvoiceData = { subtotal, tax, tip, grandTotal, items };

    DOM.invSubtotalVal.textContent = formatCOP(subtotal);
    DOM.invTaxVal.textContent = formatCOP(0);
    DOM.invTipVal.textContent = formatCOP(0);
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
      const tax = 0; // Sin Impoconsumo
      const tip = 0; // Sin Propina
      const total = sub;
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
            <span>Subtotal:</span>
            <span>${formatCOP(sub)}</span>
          </div>
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

  // --- CONFIGURACIÓN DE URL DEL BACKEND (Render / Local) ---
  function setupBackendConfigModal() {
    function openConfigModal() {
      if (DOM.modalBackendConfig) {
        const currentSaved = localStorage.getItem('comanda_api_url') || '';
        if (DOM.backendUrlInput) {
          DOM.backendUrlInput.value = currentSaved;
        }
        if (DOM.backendCurrentUrlDisplay) {
          DOM.backendCurrentUrlDisplay.textContent = API_BASE;
        }
        DOM.modalBackendConfig.classList.add('open');
        setTimeout(() => {
          if (DOM.backendUrlInput) {
            DOM.backendUrlInput.focus();
            DOM.backendUrlInput.select();
          }
        }, 50);
      } else {
        const currentVal = localStorage.getItem('comanda_api_url') || API_BASE;
        const inputUrl = window.prompt(
          'Ingresa la URL del backend de Render (ej. https://mi-backend.onrender.com) o deja en blanco para restablecer por defecto:',
          currentVal
        );
        if (inputUrl !== null) {
          applyBackendUrl(inputUrl);
        }
      }
    }

    function applyBackendUrl(url) {
      const trimmed = (url || '').trim();
      if (!trimmed) {
        localStorage.removeItem('comanda_api_url');
        API_BASE = getApiBase();
        showToast(`URL restablecida por defecto: ${API_BASE}`, 'info');
      } else {
        let normalized = trimmed;
        if (!/^https?:\/\//i.test(normalized)) {
          normalized = 'https://' + normalized;
        }
        normalized = normalized.replace(/\/+$/, '');
        localStorage.setItem('comanda_api_url', normalized);
        API_BASE = getApiBase();
        showToast(`Backend configurado: ${API_BASE}`, 'success');
      }

      if (DOM.backendCurrentUrlDisplay) {
        DOM.backendCurrentUrlDisplay.textContent = API_BASE;
      }
      if (DOM.modalBackendConfig) {
        DOM.modalBackendConfig.classList.remove('open');
      }

      // Reiniciar conexión SSE y recargar datos iniciales
      initSSE();
      loadInitialData();
    }

    if (DOM.btnBackendConfig) {
      DOM.btnBackendConfig.addEventListener('click', openConfigModal);
    }

    if (DOM.formBackendConfig) {
      DOM.formBackendConfig.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = DOM.backendUrlInput ? DOM.backendUrlInput.value : '';
        applyBackendUrl(url);
      });
    }

    if (DOM.btnSaveBackendUrl) {
      DOM.btnSaveBackendUrl.addEventListener('click', (e) => {
        e.preventDefault();
        const url = DOM.backendUrlInput ? DOM.backendUrlInput.value : '';
        applyBackendUrl(url);
      });
    }

    if (DOM.btnResetBackendUrl) {
      DOM.btnResetBackendUrl.addEventListener('click', () => {
        if (DOM.backendUrlInput) DOM.backendUrlInput.value = '';
        applyBackendUrl('');
      });
    }

    // Exponer para testing o invocación desde consola
    window.setBackendUrl = applyBackendUrl;
    window.openBackendConfig = openConfigModal;
  }

  // --- ARRANQUE DE LA APLICACIÓN ---
  initClock();
  setupNavigation();
  setupBackendConfigModal();
  initSSE();
  setupSplitItemsControls();
  loadInitialData();

  // Exponer utilidades para pruebas y validaciones QA
  window.saveOfflineState = saveOfflineState;
  window.loadOfflineState = loadOfflineState;
  window.renderBillingView = renderBillingView;
  window.executeBlindClose = executeBlindClose;
  window.getApiBase = getApiBase;
  window.initSSE = initSSE;
  window.loadInitialData = loadInitialData;
  window.STATE = STATE;

})();
