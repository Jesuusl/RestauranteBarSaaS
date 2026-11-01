const Order = require('../models/Order');
const Session = require('../models/Session');
const Table = require('../models/Table');
const { routeOrderItems } = require('../services/routingService');
const { deductRecipeStock } = require('../services/inventoryService');
const { withTransaction, getDatabase } = require('../config/database');
const eventService = require('../services/eventService');
const { EVENT_TYPES } = eventService;

class OrderController {
  /**
   * Crea una nueva comanda bajo transacción ACID, la enruta automáticamente por estación y descuenta escandallo.
   */
  static async createOrder(req, res) {
    try {
      const { sessionId, tableId, waiterId, items } = req.body;
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';
      const resolvedWaiterId = waiterId || req.user?.id || 'usr-default';

      if (!sessionId || !tableId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: sessionId, tableId, items' });
      }

      // Ejecución atómica en transacción
      const { createdOrders, lowStockAlerts } = await withTransaction(db, async (txDb) => {
        // Verificar si la sesión existe, de lo contrario crearla automáticamente
        const existingSession = await Session.findById(sessionId, txDb);
        if (!existingSession) {
          await Session.create({
            id: sessionId,
            tenantId,
            tableId,
            waiterId: resolvedWaiterId,
            waiterName: req.user?.name || 'Mesero',
            dinerCount: 2
          }, txDb);
          await Table.updateStatus(tableId, 'OCCUPIED', sessionId, txDb);
        }

        // Enrutar ítems por estación
        const { kitchen, bar } = await routeOrderItems(items, txDb);

        // Descontar inventario por receta
        const stockResult = await deductRecipeStock(items, txDb);

        const orders = [];

        if (kitchen.length > 0) {
          const kitchenOrder = await Order.create({
            id: `ord-kitch-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            tenantId,
            sessionId,
            tableId,
            waiterId: resolvedWaiterId,
            station: 'KITCHEN',
            items: kitchen
          }, txDb);
          orders.push(kitchenOrder);
        }

        if (bar.length > 0) {
          const barOrder = await Order.create({
            id: `ord-bar-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            tenantId,
            sessionId,
            tableId,
            waiterId: resolvedWaiterId,
            station: 'BAR',
            items: bar
          }, txDb);
          orders.push(barOrder);
        }

        return {
          createdOrders: orders,
          lowStockAlerts: stockResult?.lowStockAlerts || []
        };
      });

      // Solo después de que la transacción se confirmó (COMMIT) se emiten los eventos SSE
      for (const ord of createdOrders) {
        eventService.broadcast(EVENT_TYPES.ORDER_CREATED, ord);
      }

      for (const alert of lowStockAlerts) {
        eventService.broadcast(EVENT_TYPES.STOCK_ALERT, alert);
      }

      return res.status(201).json({
        success: true,
        orders: createdOrders,
        inventoryAlerts: lowStockAlerts
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getStationOrders(req, res) {
    try {
      const { station, status } = req.query;
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || 'tenant-default';
      const orders = await Order.findByStationAndStatus(station, status, db, tenantId);
      return res.json(orders);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const db = req.db || getDatabase();
      const normStatus = status === 'IN_PREPARATION' ? 'IN_PREP' : status;
      const updated = await Order.updateStatus(id, normStatus, db);

      if (updated) {
        eventService.broadcast(EVENT_TYPES.ORDER_STATUS_CHANGED, updated);
      }

      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = OrderController;
