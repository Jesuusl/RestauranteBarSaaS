const { getDatabase } = require('../config/database');

class Ingredient {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.unit = data.unit; // ML, GR, UNIT
    this.currentStock = Number(data.currentStock ?? 0);
    this.minStock = Number(data.minStock ?? 0);
    this.costPerUnitCOP = Number(data.costPerUnitCOP ?? 0);
  }

  static async create(data, customDb) {
    const db = customDb || getDatabase();
    const item = new Ingredient(data);
    await db.query(`
      INSERT INTO ingredients (id, name, unit, currentStock, minStock, costPerUnitCOP)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        unit = EXCLUDED.unit,
        currentStock = EXCLUDED.currentStock,
        minStock = EXCLUDED.minStock,
        costPerUnitCOP = EXCLUDED.costPerUnitCOP
    `, [item.id, item.name, item.unit, item.currentStock, item.minStock, item.costPerUnitCOP]);
    return item;
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM ingredients WHERE id = $1', [id]);
    return res.rows[0] ? new Ingredient(res.rows[0]) : null;
  }

  static async findAll(customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM ingredients ORDER BY name ASC');
    return res.rows.map(r => new Ingredient(r));
  }

  static async updateStock(id, newStock, customDb) {
    const db = customDb || getDatabase();
    await db.query('UPDATE ingredients SET currentStock = $1 WHERE id = $2', [newStock, id]);
    return await Ingredient.findById(id, db);
  }

  static async deductStock(id, quantity, customDb) {
    const db = customDb || getDatabase();
    const ingredient = await Ingredient.findById(id, db);
    if (!ingredient) {
      throw new Error(`Insumo no encontrado: ${id}`);
    }

    const updatedStock = ingredient.currentStock - quantity;
    await db.query('UPDATE ingredients SET currentStock = $1 WHERE id = $2', [updatedStock, id]);

    const isLowStock = updatedStock <= ingredient.minStock;

    return {
      ingredient: await Ingredient.findById(id, db),
      previousStock: ingredient.currentStock,
      deducted: quantity,
      currentStock: updatedStock,
      isLowStock,
      minStock: ingredient.minStock
    };
  }

  static async getLowStock(customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM ingredients WHERE currentStock <= minStock ORDER BY currentStock ASC');
    return res.rows.map(r => new Ingredient(r));
  }
}

module.exports = Ingredient;
