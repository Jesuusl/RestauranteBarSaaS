/**
 * HERA CLOUD POS - Central State & Mock Fallback (ES6)
 * Estado global reactivo y persistencia offline segura en LocalStorage.
 */

const OFFLINE_DB_KEY = 'hera_pos_db_v1';
const TOKEN_KEY = 'hera_token';
const TENANT_KEY = 'hera_active_tenant';
const USER_KEY = 'hera_current_user';

// Tenants creados en producción (inicia limpio para creación desde Panel CEO)
export const SEED_TENANTS = [];

export const SEED_PRODUCTS = [
  { id: 'prod-mojito', name: 'Cóctel Mojito Clásico', category: 'Cócteles', station: 'BAR', salePriceCOP: 32000, isAvailable: true },
  { id: 'prod-gin-tonic', name: 'Gin Tonic Tanqueray', category: 'Cócteles', station: 'BAR', salePriceCOP: 38000, isAvailable: true },
  { id: 'prod-shot-guaro', name: 'Shot de Aguardiente Antioqueño', category: 'Licores', station: 'BAR', salePriceCOP: 8000, isAvailable: true },
  { id: 'prod-cerveza-club', name: 'Cerveza Club Colombia Dorada', category: 'Cervezas', station: 'BAR', salePriceCOP: 10000, isAvailable: true },
  { id: 'prod-punta-anca', name: 'Punta de Anca 350g', category: 'Carnes', station: 'KITCHEN', salePriceCOP: 54000, isAvailable: true },
  { id: 'prod-picada-criolla', name: 'Picada Criolla Tradicional', category: 'Para Compartir', station: 'KITCHEN', salePriceCOP: 68000, isAvailable: true },
  { id: 'prod-alitas-bbq', name: 'Alitas BBQ Glaseadas (8 piezas)', category: 'Entradas', station: 'KITCHEN', salePriceCOP: 34000, isAvailable: true },
  { id: 'prod-limonada-coco', name: 'Limonada de Coco Cremosita', category: 'Bebidas', station: 'BAR', salePriceCOP: 16000, isAvailable: true },
  { id: 'prod-burger-angus', name: 'Hamburguesa Angus Artesanal', category: 'Carnes', station: 'KITCHEN', salePriceCOP: 38000, isAvailable: true },
  { id: 'prod-papas-rusticas', name: 'Papas Rústicas con Trufa', category: 'Entradas', station: 'KITCHEN', salePriceCOP: 22000, isAvailable: true }
];

export const SEED_TABLES = [
  { id: 'tab-1', number: 1, zone: 'Salón Principal', capacity: 4, status: 'AVAILABLE', currentSessionId: null, openedAt: null },
  { id: 'tab-2', number: 2, zone: 'Salón Principal', capacity: 2, status: 'OCCUPIED', currentSessionId: 'sess-102', openedAt: Date.now() - 42 * 60000 },
  { id: 'tab-3', number: 3, zone: 'Salón Principal', capacity: 6, status: 'RESERVED', currentSessionId: null, openedAt: null },
  { id: 'tab-4', number: 4, zone: 'Terraza', capacity: 4, status: 'AVAILABLE', currentSessionId: null, openedAt: null },
  { id: 'tab-5', number: 5, zone: 'Terraza', capacity: 4, status: 'PAYING', currentSessionId: 'sess-105', openedAt: Date.now() - 65 * 60000 },
  { id: 'tab-6', number: 6, zone: 'Terraza', capacity: 2, status: 'CLEANING', currentSessionId: null, openedAt: null },
  { id: 'tab-7', number: 7, zone: 'Barra VIP', capacity: 2, status: 'AVAILABLE', currentSessionId: null, openedAt: null },
  { id: 'tab-8', number: 8, zone: 'Barra VIP', capacity: 2, status: 'OCCUPIED', currentSessionId: 'sess-108', openedAt: Date.now() - 18 * 60000 }
];

export const SEED_KDS_ORDERS = [
  {
    id: 'ord-101',
    orderNumber: 101,
    tableNumber: 2,
    tableName: 'Mesa 2',
    station: 'KITCHEN',
    status: 'IN_PREP',
    createdAt: new Date(Date.now() - 14 * 60000).toISOString(),
    items: [
      { productName: 'Punta de Anca 350g', quantity: 1, modifiers: 'Término 3/4', notes: 'Poco término' },
      { productName: 'Alitas BBQ Glaseadas (8 piezas)', quantity: 1, modifiers: 'Sin cebolla', notes: '' }
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

// Helper para recuperar token y usuario persistido
function loadSavedAuth() {
  try {
    const token = localStorage.getItem(TOKEN_KEY) || null;
    const userRaw = localStorage.getItem(USER_KEY);
    const tenantRaw = localStorage.getItem(TENANT_KEY);
    return {
      token,
      currentUser: userRaw ? JSON.parse(userRaw) : null,
      currentTenant: tenantRaw ? JSON.parse(tenantRaw) : null
    };
  } catch (_) {
    return { token: null, currentUser: null, currentTenant: null };
  }
}

const savedAuth = loadSavedAuth();

// Estado Global Reactivo
export const state = {
  // Autenticación & Multitenant
  token: savedAuth.token,
  currentUser: savedAuth.currentUser,
  currentTenant: savedAuth.currentTenant,

  // Vistas y Pantallas
  activeScreen: 'auth-screen', // 'auth-screen' | 'ceo-screen' | 'pos-app-screen'
  activeView: 'view-express',   // 'view-express' | 'view-sales' | 'view-tables' | 'view-pos' | 'view-kds' | 'view-billing' | 'view-catalog' | 'view-shifts'
  
  // Filtros operativos
  activeZone: 'ALL',
  activeKdsStation: 'ALL',
  activePosStation: 'ALL',
  activeCatalogStation: 'ALL',
  activeCatalogCategory: 'ALL',
  activeExpressCategory: 'ALL',

  // Selección activa
  selectedTableId: null,
  selectedSessionId: null,

  // Carritos
  expressCart: [], // [{ product, quantity, unitPriceCOP }]
  posCart: [],     // [{ product, quantity, modifiers, notes }]
  selectedModifiersTemp: [],

  // Datos en memoria
  tenants: [],
  tables: [],
  products: [],
  kdsOrders: [],
  invoices: [],
  salesSummary: null,
  activeShift: null,

  // Conectividad
  isBackendOnline: false,
  sseEventSource: null
};

// Listeners reactivos
const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyStateChange(changedKeys = []) {
  listeners.forEach(fn => {
    try {
      fn(state, changedKeys);
    } catch (err) {
      console.warn('Error en listener de estado:', err);
    }
  });
}

export function setState(updates = {}) {
  const keys = Object.keys(updates);
  Object.assign(state, updates);
  notifyStateChange(keys);
}

export function saveAuthSession(token, user, tenant) {
  state.token = token;
  state.currentUser = user;
  state.currentTenant = tenant;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);

    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);

    if (tenant) localStorage.setItem(TENANT_KEY, JSON.stringify(tenant));
    else localStorage.removeItem(TENANT_KEY);
  } catch (err) {
    console.warn('Error al guardar credenciales en localStorage:', err);
  }
  notifyStateChange(['token', 'currentUser', 'currentTenant']);
}

export function clearAuthSession() {
  state.token = null;
  state.currentUser = null;
  state.currentTenant = null;
  state.expressCart = [];
  state.posCart = [];
  state.selectedTableId = null;
  state.selectedSessionId = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TENANT_KEY);
  } catch (_) {}
  notifyStateChange(['token', 'currentUser', 'currentTenant']);
}

// Persistencia Offline en LocalStorage
export function loadOfflineDb() {
  try {
    const raw = localStorage.getItem(OFFLINE_DB_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Error al leer offline DB:', err);
  }
  return null;
}

export function saveOfflineDb(db) {
  try {
    localStorage.setItem(OFFLINE_DB_KEY, JSON.stringify(db));
  } catch (err) {
    console.warn('Error al persistir offline DB:', err);
  }
}

export function initOfflineDb() {
  let db = loadOfflineDb();
  if (!db) {
    db = {
      tenants: [],
      products: [],
      tables: [],
      kdsOrders: [],
      invoices: [],
      shifts: []
    };
    saveOfflineDb(db);
  }
  return db;
}
