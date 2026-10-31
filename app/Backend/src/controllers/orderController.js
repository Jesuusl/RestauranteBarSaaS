const Order = require('../models/Order');
const { routeOrderItems } = require('../services/routingService');
const { deductRecipeStock } = require('../services/inventoryService');
const eventService = require('../services/eventService');
const { EVENT_TYPES } = eventService;

class OrderController {
  /**
   * Crea una nueva comanda, la enruta automáticamente por estación y descuenta escandallo.
   */
  static async createOrder(req, res) {
    try {
      const { sessionId, tableId, waiterId, items } = req.body;
      const db = req.db;

      if (!sessionId || !tableId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: sessionId, tableId, items' });
      }

      // Enrutar ítems por estación
      const { kitchen, bar } = await routeOrderItems(items, db);

      const createdOrders = [];

      // Descontar inventario por receta
      const stockResult = await deductRecipeStock(items, db);

      if (kitchen.length > 0) {
        const kitchenOrder = await Order.create({
          id: `ord-kitch-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          sessionId,
          tableId,
          waiterId,
          station: 'KITCHEN',
          items: kitchen
        }, db);
        createdOrders.push(kitchenOrder);
        eventService.broadcast(EVENT_TYPES.ORDER_CREATED, kitchenOrder);
      }

      if (bar.length > 0) {
        const barOrder = await Order.create({
          id: `ord-bar-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          sessionId,
          tableId,
          waiterId,
          station: 'BAR',
          items: bar
        }, db);
        createdOrders.push(barOrder);
        eventService.broadcast(EVENT_TYPES.ORDER_CREATED, barOrder);
      }

      // Emitir alertas de stock si algún ingrediente quedó en o bajo su umbral mínimo
      if (stockResult && Array.isArray(stockResult.lowStockAlerts)) {
        for (const alert of stockResult.lowStockAlerts) {
          eventService.broadcast(EVENT_TYPES.STOCK_ALERT, alert);
        }
      }

      return res.status(201).json({
        success: true,
        orders: createdOrders,
        inventoryAlerts: stockResult.lowStockAlerts
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getStationOrders(req, res) {
    try {
      const { station, status } = req.query;
      const db = req.db;
      const orders = await Order.findByStationAndStatus(station, status, db);
      return res.json(orders);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const db = req.db;
      const updated = await Order.updateStatus(id, status, db);

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
