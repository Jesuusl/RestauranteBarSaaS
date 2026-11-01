const Ingredient = require('../models/Ingredient');
const Product = require('../models/Product');
const Table = require('../models/Table');
const Waste = require('../models/Waste');
const { registerWaste } = require('../services/inventoryService');
const { withTransaction, getDatabase } = require('../config/database');
const eventService = require('../services/eventService');
const { EVENT_TYPES } = eventService;

class InventoryController {
  // --- INGREDIENTES / STOCK ---
  static async getIngredients(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.query?.tenantId || 'tenant-default';
      const ingredients = await Ingredient.findAll(db, tenantId);
      return res.json(ingredients);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getLowStock(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.query?.tenantId || 'tenant-default';
      const lowStock = await Ingredient.getLowStock(db, tenantId);
      return res.json(lowStock);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // --- PRODUCTOS ---
  static async getProducts(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.query?.tenantId || 'tenant-default';
      const products = await Product.findAll(db, tenantId);
      return res.json(products);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getProductById(req, res) {
    try {
      const db = req.db || getDatabase();
      const product = await Product.findById(req.params.id, db);
      if (!product) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      return res.json(product);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createProduct(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';
      const { name, category, station, salePriceCOP, trackStock, stockUnits, minStockUnits } = req.body;

      if (!name || !category || !station) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: name, category, station' });
      }

      const normalizedStation = String(station).toUpperCase();
      if (!['KITCHEN', 'BAR'].includes(normalizedStation)) {
        return res.status(400).json({ error: 'Estación inválida. Debe ser KITCHEN o BAR' });
      }

      if (salePriceCOP !== undefined && (isNaN(Number(salePriceCOP)) || Number(salePriceCOP) < 0)) {
        return res.status(400).json({ error: 'El precio de venta debe ser un número mayor o igual a 0' });
      }

      if (stockUnits !== undefined && (isNaN(Number(stockUnits)) || Number(stockUnits) < 0)) {
        return res.status(400).json({ error: 'Las unidades de stock deben ser un número mayor o igual a 0' });
      }

      if (minStockUnits !== undefined && (isNaN(Number(minStockUnits)) || Number(minStockUnits) < 0)) {
        return res.status(400).json({ error: 'El stock mínimo debe ser un número mayor o igual a 0' });
      }

      const product = await Product.create({
        ...req.body,
        tenantId,
        station: normalizedStation,
        trackStock: trackStock !== undefined ? Boolean(trackStock) : false,
        stockUnits: stockUnits !== undefined ? Number(stockUnits) : 0,
        minStockUnits: minStockUnits !== undefined ? Number(minStockUnits) : 5
      }, db);
      return res.status(201).json(product);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async updateProduct(req, res) {
    try {
      const db = req.db || getDatabase();
      const { station, salePriceCOP, stockUnits, minStockUnits } = req.body;

      if (station !== undefined) {
        const normalizedStation = String(station).toUpperCase();
        if (!['KITCHEN', 'BAR'].includes(normalizedStation)) {
          return res.status(400).json({ error: 'Estación inválida. Debe ser KITCHEN o BAR' });
        }
        req.body.station = normalizedStation;
      }

      if (salePriceCOP !== undefined && (isNaN(Number(salePriceCOP)) || Number(salePriceCOP) < 0)) {
        return res.status(400).json({ error: 'El precio de venta debe ser un número mayor o igual a 0' });
      }

      if (stockUnits !== undefined && (isNaN(Number(stockUnits)) || Number(stockUnits) < 0)) {
        return res.status(400).json({ error: 'Las unidades de stock deben ser un número mayor o igual a 0' });
      }

      if (minStockUnits !== undefined && (isNaN(Number(minStockUnits)) || Number(minStockUnits) < 0)) {
        return res.status(400).json({ error: 'El stock mínimo debe ser un número mayor o igual a 0' });
      }

      const updated = await Product.update(req.params.id, req.body, db);
      if (!updated) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      return res.json(updated);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Ajuste directo de existencias de inventario simple (PATCH /api/products/:id/stock).
   * Soporta ajuste por delta (+/-) o fijación absoluta de stockUnits, minStockUnits y trackStock.
   */
  static async adjustProductStock(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || 'tenant-default';
      const product = await Product.findById(req.params.id, db);
      if (!product || (req.user && req.user.role !== 'SUPER_ADMIN' && product.tenantId !== tenantId)) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      const updated = await Product.adjustStock(req.params.id, req.body, db);

      // Eventos SSE de inventario en tiempo real
      eventService.broadcast(EVENT_TYPES.PRODUCT_STOCK_UPDATED, {
        tenantId: updated.tenantId,
        productId: updated.id,
        trackStock: updated.trackStock,
        stockUnits: updated.stockUnits,
        minStockUnits: updated.minStockUnits
      });

      if (updated.trackStock && updated.stockUnits <= updated.minStockUnits) {
        eventService.broadcast(EVENT_TYPES.STOCK_ALERT, {
          tenantId: updated.tenantId,
          productId: updated.id,
          productName: updated.name,
          stockUnits: updated.stockUnits,
          minStockUnits: updated.minStockUnits,
          message: `Alerta: Stock bajo para "${updated.name}" (${updated.stockUnits} unidades restantes)`
        });
      }

      return res.json(updated);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async deleteProduct(req, res) {
    try {
      const db = req.db || getDatabase();
      const deleted = await Product.delete(req.params.id, db);
      if (!deleted) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      return res.json({ message: 'Producto eliminado correctamente', id: req.params.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // --- MESAS (CONTROLADOR AUXILIAR) ---
  static async getTables(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.query?.tenantId || 'tenant-default';
      const { zone } = req.query;
      const tables = zone ? await Table.findByZone(zone, db, tenantId) : await Table.findAll(db, tenantId);
      return res.json(tables);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getTableById(req, res) {
    try {
      const db = req.db || getDatabase();
      const table = await Table.findById(req.params.id, db);
      if (!table) {
        return res.status(404).json({ error: 'Mesa no encontrada' });
      }
      return res.json(table);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createTable(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';
      const { number, zone, capacity } = req.body;

      if (number === undefined || !zone || capacity === undefined) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: number, zone, capacity' });
      }

      if (isNaN(Number(number)) || Number(number) <= 0) {
        return res.status(400).json({ error: 'El número de mesa debe ser un entero positivo' });
      }

      if (isNaN(Number(capacity)) || Number(capacity) <= 0) {
        return res.status(400).json({ error: 'La capacidad debe ser mayor a 0' });
      }

      const table = await Table.create({ ...req.body, tenantId }, db);
      return res.status(201).json(table);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async updateTable(req, res) {
    try {
      const db = req.db || getDatabase();
      const { number, capacity } = req.body;

      if (number !== undefined && (isNaN(Number(number)) || Number(number) <= 0)) {
        return res.status(400).json({ error: 'El número de mesa debe ser un entero positivo' });
      }

      if (capacity !== undefined && (isNaN(Number(capacity)) || Number(capacity) <= 0)) {
        return res.status(400).json({ error: 'La capacidad debe ser mayor a 0' });
      }

      const updated = await Table.update(req.params.id, req.body, db);
      if (!updated) {
        return res.status(404).json({ error: 'Mesa no encontrada' });
      }
      return res.json(updated);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async deleteTable(req, res) {
    try {
      const db = req.db || getDatabase();
      const table = await Table.findById(req.params.id, db);
      if (!table) {
        return res.status(404).json({ error: 'Mesa no encontrada' });
      }

      if (table.status === 'OCCUPIED' || table.status === 'PAYING') {
        return res.status(409).json({
          error: 'No se puede eliminar una mesa ocupada o en proceso de pago',
          message: 'No se puede eliminar una mesa ocupada o en proceso de pago'
        });
      }

      const deleted = await Table.delete(req.params.id, db);
      if (!deleted) {
        return res.status(404).json({ error: 'Mesa no encontrada' });
      }
      return res.json({ message: 'Mesa eliminada correctamente', id: req.params.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // --- MERMAS ---
  static async createWaste(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';

      const waste = await withTransaction(db, async (txDb) => {
        return await registerWaste({
          ...req.body,
          tenantId
        }, txDb);
      });

      return res.status(201).json(waste);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async getWastes(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.query?.tenantId || 'tenant-default';
      const wastes = await Waste.findAll(db, tenantId);
      return res.json(wastes);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = InventoryController;
