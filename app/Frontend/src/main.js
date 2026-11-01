/**
 * GHANIMA CLOUD POS - Main Application Entry Point (ES6)
 * Inicialización orquestada, navegación SPA reactiva, reloj en vivo,
 * sincronización SSE y orquestación de módulos independientes.
 */

import { state, setState } from './state.js';
import { initSSE, setupBackendConfigModal } from './api.js';
import { setupAuth, checkAuthSession, applyModularNavigation, routeToRoleScreen, saveAuthSession } from './modules/auth.js';
import { setupCeoDashboard, loadCeoData } from './modules/ceo.js';
import { setupExpressPos, loadExpressCatalog } from './modules/expressPos.js';
import { setupSalesModule, loadSalesSummary } from './modules/sales.js';
import { setupTablesModule, loadTables } from './modules/tables.js';
import { setupPosModule, loadPosModule, populatePosTableSelect } from './modules/pos.js';
import { setupKdsModule, loadKdsOrders } from './modules/kds.js';
import { setupBillingModule, populateBillingSelect } from './modules/billing.js';
import { setupCatalogModule, loadCatalogProducts, openNewProductModal } from './modules/catalog.js';
import { setupShiftsModule, loadActiveShift } from './modules/shifts.js';
import { showToast } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
  initLiveClock();
  setupBackendConfigModal(() => {
    initAppSSE();
    reloadAllRestaurantData();
  });

  // 1. Inicializar Módulos con Callbacks Cruzados
  setupAuth({
    onLoginSuccess: (user, tenant) => {
      if (user.role === 'SUPER_ADMIN') {
        loadCeoData();
      } else {
        const firstView = applyModularNavigation(tenant?.enabledModules || {});
        reloadAllRestaurantData();
        switchView(firstView || 'view-express');
      }
    },
    onLogout: () => {
      // Estado limpiado por auth.js
    }
  });

  setupCeoDashboard({
    onImpersonateTenant: (tenant) => {
      state.currentTenant = tenant;
      routeToRoleScreen(state.currentUser, tenant, { impersonate: true });
      initAppSSE();
      const firstView = applyModularNavigation(tenant.enabledModules || {});
      reloadAllRestaurantData();
      switchView(firstView || 'view-express');
      showToast(`Operando en: ${tenant.name}`, 'info');
    }
  });

  const btnBackToCeo = document.getElementById('btn-back-to-ceo');
  if (btnBackToCeo) {
    btnBackToCeo.addEventListener('click', () => {
      state.currentTenant = null;
      btnBackToCeo.classList.add('hidden');
      btnBackToCeo.classList.remove('flex');
      routeToRoleScreen(state.currentUser, null);
      loadCeoData();
    });
  }

  setupExpressPos({
    onSaleCompleted: () => {
      loadSalesSummary();
    },
    onOpenProductModal: () => {
      openNewProductModal();
    }
  });

  setupSalesModule();

  setupTablesModule({
    onNavigateToPos: (tableId) => {
      switchView('view-pos');
      populatePosTableSelect();
    },
    onNavigateToBilling: (tableId) => {
      switchView('view-billing');
      populateBillingSelect(tableId);
    }
  });

  setupPosModule({
    onOrderSubmitted: () => {
      loadKdsOrders();
      loadTables();
    }
  });

  setupKdsModule();

  setupBillingModule({
    onCheckoutCompleted: () => {
      loadTables();
      loadSalesSummary();
    }
  });

  setupCatalogModule({
    onCatalogChanged: (products) => {
      loadExpressCatalog(products);
    }
  });

  setupShiftsModule();

  // 2. Navegación SPA por pestañas
  setupNavigationTabs();

  // 3. Conectar Servidor SSE
  initAppSSE();

  // 4. Verificación de sesión activa
  checkAuthSession({
    onSessionValid: (user, tenant) => {
      if (user.role === 'SUPER_ADMIN') {
        loadCeoData();
      } else {
        const firstView = applyModularNavigation(tenant?.enabledModules || {});
        reloadAllRestaurantData();
        switchView(firstView || 'view-express');
      }
    },
    onSessionInvalid: () => {
      // Regresa a auth-screen
    }
  });
});

/**
 * Reloj Digital en Vivo (Zona horaria Colombia)
 */
function initLiveClock() {
  const clockEl = document.getElementById('digital-clock');
  if (!clockEl) return;

  function update() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }
  update();
  setInterval(update, 1000);
}

/**
 * Configuración de las pestañas de navegación de restaurante
 */
function setupNavigationTabs() {
  const navButtons = document.querySelectorAll('.nav-tab-btn');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      if (targetView) {
        switchView(targetView);
      }
    });
  });
}

/**
 * Alterna entre las vistas internas del restaurante
 */
export function switchView(viewId) {
  state.activeView = viewId;
  const navButtons = document.querySelectorAll('.nav-tab-btn');
  const views = document.querySelectorAll('.app-view');

  navButtons.forEach(btn => {
    const isTarget = btn.dataset.view === viewId;
    if (isTarget) {
      btn.classList.add('active', 'border-indigo-500', 'text-indigo-600', 'dark:text-indigo-400', 'shadow-sm');
      btn.classList.remove('border-slate-200', 'dark:border-slate-700');
    } else {
      btn.classList.remove('active', 'border-indigo-500', 'text-indigo-600', 'dark:text-indigo-400', 'shadow-sm');
      btn.classList.add('border-slate-200', 'dark:border-slate-700');
    }
  });

  views.forEach(v => {
    if (v.id === viewId) {
      v.classList.remove('hidden');
    } else {
      v.classList.add('hidden');
    }
  });

  // Ejecutar carga de datos de la vista activada
  if (viewId === 'view-express') {
    loadExpressCatalog(state.products || []);
  } else if (viewId === 'view-sales') {
    loadSalesSummary();
  } else if (viewId === 'view-tables') {
    loadTables();
  } else if (viewId === 'view-pos') {
    loadPosModule();
  } else if (viewId === 'view-kds') {
    loadKdsOrders();
  } else if (viewId === 'view-billing') {
    populateBillingSelect(state.selectedTableId);
  } else if (viewId === 'view-catalog') {
    loadCatalogProducts();
  } else if (viewId === 'view-shifts') {
    loadActiveShift();
  }
}

/**
 * Recarga general de todos los almacenes de datos del restaurante
 */
async function reloadAllRestaurantData() {
  const mods = state.currentTenant?.enabledModules || {};
  const promises = [];

  // Menú / Catálogo
  if (mods.catalog !== false) {
    promises.push(loadCatalogProducts({
      onCatalogChanged: (prods) => loadExpressCatalog(prods)
    }));
  }

  // Mesas
  if (Boolean(mods.tables)) {
    promises.push(loadTables());
  }

  // KDS Cocina
  if (Boolean(mods.kds)) {
    promises.push(loadKdsOrders());
  }

  // Ventas / Analytics
  if (Boolean(mods.sales)) {
    promises.push(loadSalesSummary());
  }

  // Cierre de turno
  if (Boolean(mods.shifts)) {
    promises.push(loadActiveShift());
  }

  // Cobro rápido
  if (Boolean(mods.express_pos)) {
    loadExpressCatalog(state.products || []);
  }

  await Promise.allSettled(promises);
}

/**
 * Inicialización y enrutamiento de eventos SSE en tiempo real
 */
function initAppSSE() {
  initSSE((event) => {
    if (!event || !event.type) return;

    if (event.type === 'STOCK_ALERT') {
      const pName = event.data?.productName || event.data?.name || 'Producto';
      const stock = event.data?.currentStock ?? event.data?.stock ?? 0;
      showToast(`⚠️ Alerta de Stock: ${pName} tiene solo ${stock} unidades`, 'alert');
    } else if (event.type === 'TENANT_UPDATED') {
      if (state.currentTenant && state.currentTenant.id === event.tenantId) {
        state.currentTenant = { ...state.currentTenant, ...event.data };
        saveAuthSession(state.currentUser, state.currentTenant);
        const firstVisibleView = applyModularNavigation(state.currentTenant.enabledModules || {});

        const currentModMap = {
          'view-express': 'express_pos',
          'view-sales': 'sales',
          'view-catalog': 'catalog',
          'view-tables': 'tables',
          'view-pos': 'pos',
          'view-kds': 'kds',
          'view-billing': 'billing',
          'view-shifts': 'shifts'
        };
        const currentMod = currentModMap[state.activeView];
        if (currentMod && !Boolean(state.currentTenant.enabledModules?.[currentMod])) {
          switchView(firstVisibleView || 'view-express');
        }
      }
      if (state.activeScreen === 'ceo-screen') {
        loadCeoData();
      }
    } else if (event.type === 'SALE_COMPLETED') {
      if (Boolean(state.currentTenant?.enabledModules?.sales)) {
        loadSalesSummary();
      }
      if (Boolean(state.currentTenant?.enabledModules?.tables)) {
        loadTables();
      }
      if (state.activeScreen === 'ceo-screen') {
        loadCeoData();
      }
    } else if (event.type === 'ORDER_CREATED' || event.type === 'ORDER_STATUS_CHANGED') {
      if (Boolean(state.currentTenant?.enabledModules?.kds)) {
        loadKdsOrders();
      }
    } else if (event.type === 'TABLE_STATUS_CHANGED') {
      if (Boolean(state.currentTenant?.enabledModules?.tables)) {
        loadTables();
      }
    }
  });
}
