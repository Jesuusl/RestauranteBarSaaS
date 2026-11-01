const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initSchema, getDatabase } = require('./config/database');
const Table = require('./models/Table');
const Session = require('./models/Session');
const User = require('./models/User');
const Tenant = require('./models/Tenant');
const { verifyJwt } = require('./utils/cryptoAuth');

const OrderController = require('./controllers/orderController');
const BillingController = require('./controllers/billingController');
const InventoryController = require('./controllers/inventoryController');
const ShiftController = require('./controllers/shiftController');
const AuthController = require('./controllers/authController');
const CeoController = require('./controllers/ceoController');
const SalesController = require('./controllers/salesController');

const { authenticate, requireSuperAdmin, requireModule } = require('./middlewares/authMiddleware');
const eventService = require('./services/eventService');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares base
app.use(cors());
app.use(express.json());

// Iniciar esquema de base de datos y asegurar usuario maestro CEO (sin datos demo)
initSchema().then(async () => {
  if (process.env.NODE_ENV !== 'test') {
    try {
      const db = getDatabase();
      // Asegurar credenciales y existencia del usuario maestro CEO en cualquier arranque
      await User.ensureMasterCeoUser(db);
    } catch (err) {
      console.warn('⚠️ Nota sobre inicialización de usuario maestro CEO:', err.message);
    }
  }
}).catch(err => {
  console.warn('⚠️ Nota sobre inicialización de esquema:', err.message);
});

// Middleware contextual Multi-Tenant y resolución opcional de token
app.use(async (req, res, next) => {
  req.db = req.db || getDatabase();
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query && req.query.token) {
    token = String(req.query.token).trim();
  }

  if (token) {
    const payload = verifyJwt(token);
    if (payload && payload.userId) {
      try {
        const user = await User.findById(payload.userId, req.db);
        if (user && user.isActive) {
          req.user = user;
          if (user.role === 'SUPER_ADMIN') {
            const targetTenantId = req.headers['x-tenant-id'] || req.query.tenantId;
            if (targetTenantId) {
              req.tenant = await Tenant.findById(targetTenantId, req.db);
              req.tenantId = targetTenantId;
            } else {
              req.tenantId = 'tenant-default';
            }
          } else if (user.tenantId) {
            req.tenant = await Tenant.findById(user.tenantId, req.db);
            req.tenantId = user.tenantId;
          }
        }
      } catch (_) {}
    }
  }

  if (!req.tenantId) {
    req.tenantId = req.headers['x-tenant-id'] || req.query?.tenantId || 'tenant-default';
  }
  if (!req.tenant && req.tenantId) {
    try {
      req.tenant = await Tenant.findById(req.tenantId, req.db);
    } catch (_) {}
  }

  next();
});

/**
 * Helper de protección condicional: si la petición proviene de un usuario autenticado
 * de restaurante (no CEO), valida que el restaurante tenga habilitado al menos uno
 * de los módulos indicados. Si no viene usuario autenticado (llamadas internas legacy), permite el paso.
 */
function guardIfAuthenticatedModule(moduleKeys) {
  return (req, res, next) => {
    if (!req.user || req.user.role === 'SUPER_ADMIN') {
      return next();
    }
    const enabledModules = req.tenant?.enabledModules || {};
    const keys = Array.isArray(moduleKeys) ? moduleKeys : [moduleKeys];
    const isAllowed = keys.some(k => Boolean(enabledModules[k]));
    if (!isAllowed) {
      return res.status(403).json({
        error: 'Este módulo no está habilitado para tu restaurante.',
        module: moduleKeys
      });
    }
    return next();
  };
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Comanda Backend SaaS en ejecución',
    mode: 'Multi-Tenant ACID',
    timestamp: new Date().toISOString()
  });
});

// --- EVENTOS EN TIEMPO REAL (SSE - Server-Sent Events) ---
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  eventService.addClient(res, req);
});

// --- AUTENTICACIÓN (LOGIN & ME) ---
app.post('/api/auth/login', AuthController.login);
app.get('/api/auth/me', authenticate, AuthController.me);

// --- PANEL CEO SAAS (SUPER ADMIN) ---
app.get('/api/ceo/tenants', authenticate, requireSuperAdmin, CeoController.getTenants);
app.post('/api/ceo/tenants', authenticate, requireSuperAdmin, CeoController.createTenant);
app.patch('/api/ceo/tenants/:id', authenticate, requireSuperAdmin, CeoController.updateTenant);
app.patch('/api/ceo/tenants/:id/modules', authenticate, requireSuperAdmin, CeoController.updateModules);
app.patch('/api/ceo/tenants/:id/credentials', authenticate, requireSuperAdmin, CeoController.updateCredentials);
app.delete('/api/ceo/tenants/:id', authenticate, requireSuperAdmin, CeoController.deleteTenant);

// --- ANALÍTICA DE VENTAS & EXPORTACIÓN CSV ---
app.get('/api/sales/summary', authenticate, requireModule('sales'), SalesController.getSummary);
app.get('/api/sales/export.csv', authenticate, requireModule('sales'), SalesController.exportCsv);

// --- RUTAS DE MESAS & ZONAS (CRUD) ---
app.use('/api/tables', guardIfAuthenticatedModule(['tables', 'pos', 'billing']));
app.get('/api/tables', InventoryController.getTables);
app.get('/api/tables/:id', InventoryController.getTableById);
app.post('/api/tables', InventoryController.createTable);
app.put('/api/tables/:id', InventoryController.updateTable);
app.delete('/api/tables/:id', InventoryController.deleteTable);
app.patch('/api/tables/:id/status', async (req, res) => {
  try {
    const { status, currentSessionId } = req.body;
    const db = req.db || getDatabase();
    const updated = await Table.updateStatus(req.params.id, status, currentSessionId, db);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- RUTAS DE SESIONES & CUENTAS ---
app.post('/api/sessions', async (req, res) => {
  try {
    const { id, tableId, dinerCount } = req.body;
    const waiterId = req.body.waiterId || req.user?.id || 'usr-default';
    const waiterName = req.body.waiterName || req.user?.name || 'Mesero de Turno';
    const db = req.db || getDatabase();
    const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';
    const session = await Session.create({
      id: id || `sess-${Date.now()}`,
      tenantId,
      tableId,
      waiterId,
      waiterName,
      dinerCount: dinerCount || 1
    }, db);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const db = req.db || getDatabase();
    const session = await Session.findById(req.params.id, db);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/split', async (req, res) => {
  try {
    const { subAccounts } = req.body;
    const db = req.db || getDatabase();
    const updated = await Session.updateSubAccounts(req.params.id, subAccounts, db);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/close', async (req, res) => {
  try {
    const db = req.db || getDatabase();
    const closed = await Session.close(req.params.id, db);
    res.json(closed);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- RUTAS DE PRODUCTOS (CRUD) ---
app.get('/api/products', InventoryController.getProducts);
app.get('/api/products/:id', InventoryController.getProductById);
app.post('/api/products', InventoryController.createProduct);
app.put('/api/products/:id', InventoryController.updateProduct);
app.delete('/api/products/:id', InventoryController.deleteProduct);

// --- RUTAS DE INVENTARIO Y MENÚ ---
app.get('/api/inventory/ingredients', InventoryController.getIngredients);
app.get('/api/inventory/low-stock', InventoryController.getLowStock);
app.get('/api/inventory/products', InventoryController.getProducts);
app.post('/api/inventory/wastes', InventoryController.createWaste);
app.get('/api/inventory/wastes', InventoryController.getWastes);

// --- RUTAS DE COMANDAS ---
app.use('/api/orders', guardIfAuthenticatedModule(['pos', 'kds']));
app.post('/api/orders', OrderController.createOrder);
app.get('/api/orders/station', OrderController.getStationOrders);
app.patch('/api/orders/:id/status', OrderController.updateStatus);

// --- RUTAS DE FACTURACIÓN Y DIVISIÓN ---
app.get('/api/billing/preview/:sessionId', BillingController.getSessionInvoicePreview);
app.post('/api/billing/split-equal', BillingController.splitEqual);
app.post('/api/billing/split-by-items', BillingController.splitByItems);
app.post('/api/billing/checkout', guardIfAuthenticatedModule(['billing']), BillingController.checkout);
app.post(
  '/api/billing/express-checkout',
  authenticate,
  requireModule(['express_pos', 'billing']),
  BillingController.expressCheckout
);

// --- RUTAS DE CIERRE CIEGO Y AUDITORÍA DE TURNO ---
app.use('/api/shifts', guardIfAuthenticatedModule(['shifts']));
app.post('/api/shifts', ShiftController.openShift);
app.get('/api/shifts/active', ShiftController.getActiveShift);
app.post('/api/shifts/:id/blind-close', ShiftController.blindClose);

// Iniciar servidor si es invocado directamente
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Comanda Backend SaaS escuchando en http://localhost:${PORT}`);

    // --- AUTO-PING KEEP-ALIVE (Evita que Render entre en reposo) ---
    const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
    if (RENDER_EXTERNAL_URL) {
      const PING_INTERVAL_MS = 10 * 60 * 1000; // Cada 10 minutos
      setInterval(async () => {
        try {
          const res = await fetch(`${RENDER_EXTERNAL_URL}/api/health`);
          if (res.ok) {
            console.log(`💓 [Keep-Alive] Ping exitoso a ${RENDER_EXTERNAL_URL}/api/health (${new Date().toLocaleTimeString()})`);
          }
        } catch (err) {
          console.warn(`⚠️ [Keep-Alive] Ping falló: ${err.message}`);
        }
      }, PING_INTERVAL_MS);
      console.log(`🛡️ Auto Keep-Alive activado cada 10 min para: ${RENDER_EXTERNAL_URL}`);
    }
  });
}

module.exports = app;
