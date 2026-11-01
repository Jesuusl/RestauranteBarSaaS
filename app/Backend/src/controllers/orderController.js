const Order = require('../models/Order');
const Session = require('../models/Session');
const Table = require('../models/Table');
const Product = require('../models/Product');
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
      const resolvedSessionId = sessionId || `sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: tableId, items' });
      }

      // Ejecución atómica en transacción
      const { createdOrders, lowStockAlerts } = await withTransaction(db, async (txDb) => {
        // Verificar si la sesión existe, de lo contrario crearla automáticamente
        const existingSession = await Session.findById(resolvedSessionId, txDb);
        if (!existingSession) {
          await Session.create({
            id: resolvedSessionId,
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

        // Descontar inventario por producto directo (trackStock) si el módulo inventory está activo
        const isInventoryModuleActive = !req.tenant || req.tenant.enabledModules?.inventory !== false;
        const productStockAlerts = [];
        if (isInventoryModuleActive) {
          const productQuantities = {};
          for (const it of items) {
            if (it.productId) {
              productQuantities[it.productId] = (productQuantities[it.productId] || 0) + (Number(it.quantity) || 1);
            }
          }

          for (const [prodId, qty] of Object.entries(productQuantities)) {
            const prod = await Product.findById(prodId, txDb);
            if (prod && prod.trackStock) {
              const updatedProd = await Product.deductStock(prodId, qty, txDb);
              if (updatedProd.stockUnits <= updatedProd.minStockUnits) {
                productStockAlerts.push({
                  productId: updatedProd.id,
                  productName: updatedProd.name,
                  currentStock: updatedProd.stockUnits,
                  minStock: updatedProd.minStockUnits,
                  unit: 'UNIT',
                  message: `⚠️ Stock crítico de producto: ${updatedProd.name} (${updatedProd.stockUnits} unidades)`
                });
              }
            }
          }
        }

        const orders = [];

        if (kitchen.length > 0) {
          const kitchenOrder = await Order.create({
            id: `ord-kitch-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            tenantId,
            sessionId: resolvedSessionId,
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
            sessionId: resolvedSessionId,
            tableId,
            waiterId: resolvedWaiterId,
            station: 'BAR',
            items: bar
          }, txDb);
          orders.push(barOrder);
        }

        const combinedAlerts = [...(stockResult?.lowStockAlerts || []), ...productStockAlerts];

        return {
          createdOrders: orders,
          lowStockAlerts: combinedAlerts
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
      if (err.statusCode === 400) {
        return res.status(400).json({ error: err.message });
      }
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

      const existingOrder = await Order.findById(id, db);
      let updated;

      if (existingOrder && existingOrder.status !== 'CANCELLED' && normStatus === 'CANCELLED') {
        updated = await withTransaction(db, async (txDb) => {
          for (const it of existingOrder.items || []) {
            if (it.productId) {
              await Product.restoreStock(it.productId, it.quantity, txDb);
            }
          }
          return await Order.updateStatus(id, normStatus, txDb);
        });
      } else {
        updated = await Order.updateStatus(id, normStatus, db);
      }

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
