const Ingredient = require('../models/Ingredient');
const Product = require('../models/Product');
const Table = require('../models/Table');
const Waste = require('../models/Waste');
const { registerWaste } = require('../services/inventoryService');

class InventoryController {
  // --- INGREDIENTES / STOCK ---
  static async getIngredients(req, res) {
    try {
      const db = req.db;
      const ingredients = await Ingredient.findAll(db);
      return res.json(ingredients);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getLowStock(req, res) {
    try {
      const db = req.db;
      const lowStock = await Ingredient.getLowStock(db);
      return res.json(lowStock);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // --- PRODUCTOS ---
  static async getProducts(req, res) {
    try {
      const db = req.db;
      const products = await Product.findAll(db);
      return res.json(products);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getProductById(req, res) {
    try {
      const db = req.db;
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
      const db = req.db;
      const { name, category, station, salePriceCOP } = req.body;

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

      const product = await Product.create({
        ...req.body,
        station: normalizedStation
      }, db);
      return res.status(201).json(product);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async updateProduct(req, res) {
    try {
      const db = req.db;
      const { station, salePriceCOP } = req.body;

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

      const updated = await Product.update(req.params.id, req.body, db);
      if (!updated) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      return res.json(updated);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async deleteProduct(req, res) {
    try {
      const db = req.db;
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
      const db = req.db;
      const { zone } = req.query;
      const tables = zone ? await Table.findByZone(zone, db) : await Table.findAll(db);
      return res.json(tables);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getTableById(req, res) {
    try {
      const db = req.db;
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
      const db = req.db;
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

      const table = await Table.create(req.body, db);
      return res.status(201).json(table);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async updateTable(req, res) {
    try {
      const db = req.db;
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
      const db = req.db;
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
      const db = req.db;
      const waste = await registerWaste(req.body, db);
      return res.status(201).json(waste);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async getWastes(req, res) {
    try {
      const db = req.db;
      const wastes = await Waste.findAll(db);
      return res.json(wastes);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = InventoryController;
