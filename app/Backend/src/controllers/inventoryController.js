const Ingredient = require('../models/Ingredient');
const Product = require('../models/Product');
const Waste = require('../models/Waste');
const { registerWaste } = require('../services/inventoryService');

class InventoryController {
  static async getIngredients(req, res) {
    try {
      const ingredients = await Ingredient.findAll();
      return res.json(ingredients);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getLowStock(req, res) {
    try {
      const lowStock = await Ingredient.getLowStock();
      return res.json(lowStock);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getProducts(req, res) {
    try {
      const products = await Product.findAll();
      return res.json(products);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createWaste(req, res) {
    try {
      const waste = await registerWaste(req.body);
      return res.status(201).json(waste);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async getWastes(req, res) {
    try {
      const wastes = await Waste.findAll();
      return res.json(wastes);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = InventoryController;
