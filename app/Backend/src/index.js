const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initSchema } = require('./config/database');
const Table = require('./models/Table');
const Session = require('./models/Session');
const OrderController = require('./controllers/orderController');
const BillingController = require('./controllers/billingController');
const InventoryController = require('./controllers/inventoryController');
const ShiftController = require('./controllers/shiftController');
const eventService = require('./services/eventService');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Iniciar esquema de base de datos
initSchema().catch(err => {
  console.warn('⚠️ Nota sobre inicialización de esquema:', err.message);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Comanda Backend SaaS en ejecución', timestamp: new Date().toISOString() });
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

// --- RUTAS DE MESAS & ZONAS ---
app.get('/api/tables', async (req, res) => {
  try {
    const { zone } = req.query;
    const tables = zone ? await Table.findByZone(zone) : await Table.findAll();
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tables/:id', async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    res.json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tables/:id/status', async (req, res) => {
  try {
    const { status, currentSessionId } = req.body;
    const updated = await Table.updateStatus(req.params.id, status, currentSessionId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- RUTAS DE SESIONES & CUENTAS ---
app.post('/api/sessions', async (req, res) => {
  try {
    const { id, tableId, waiterId, waiterName, dinerCount } = req.body;
    const session = await Session.create({
      id: id || `sess-${Date.now()}`,
      tableId,
      waiterId,
      waiterName,
      dinerCount: dinerCount || 1
    });
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/split', async (req, res) => {
  try {
    const { subAccounts } = req.body;
    const updated = await Session.updateSubAccounts(req.params.id, subAccounts);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/close', async (req, res) => {
  try {
    const closed = await Session.close(req.params.id);
    res.json(closed);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- RUTAS DE INVENTARIO Y MENÚ ---
app.get('/api/inventory/ingredients', InventoryController.getIngredients);
app.get('/api/inventory/low-stock', InventoryController.getLowStock);
app.get('/api/inventory/products', InventoryController.getProducts);
app.post('/api/inventory/wastes', InventoryController.createWaste);
app.get('/api/inventory/wastes', InventoryController.getWastes);

// --- RUTAS DE COMANDAS ---
app.post('/api/orders', OrderController.createOrder);
app.get('/api/orders/station', OrderController.getStationOrders);
app.patch('/api/orders/:id/status', OrderController.updateStatus);

// --- RUTAS DE FACTURACIÓN Y DIVISIÓN ---
app.get('/api/billing/preview/:sessionId', BillingController.getSessionInvoicePreview);
app.post('/api/billing/split-equal', BillingController.splitEqual);
app.post('/api/billing/split-by-items', BillingController.splitByItems);
app.post('/api/billing/checkout', BillingController.checkout);

// --- RUTAS DE CIERRE CIEGO Y AUDITORÍA DE TURNO ---
app.post('/api/shifts', ShiftController.openShift);
app.get('/api/shifts/active', ShiftController.getActiveShift);
app.post('/api/shifts/:id/blind-close', ShiftController.blindClose);

// Iniciar servidor si es invocado directamente
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Comanda Backend escuchando en http://localhost:${PORT}`);
  });
}

module.exports = app;
