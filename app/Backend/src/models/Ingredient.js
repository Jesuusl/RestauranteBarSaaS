const { getDatabase } = require('../config/database');

class Ingredient {
  constructor(data) {
    this.id = data.id;
    this.tenantId = data.tenantId || data.tenantid || 'tenant-default';
    this.name = data.name;
    this.unit = data.unit; // ML, GR, UNIT
    this.currentStock = Number(data.currentStock ?? data.currentstock ?? 0);
    this.minStock = Number(data.minStock ?? data.minstock ?? 0);
    this.costPerUnitCOP = Number(data.costPerUnitCOP ?? data.costperunitcop ?? 0);
  }

  static async create(data, customDb) {
    const db = customDb || getDatabase();
    const tenantId = data.tenantId || data.tenantid || 'tenant-default';
    const item = new Ingredient({ ...data, tenantId });

    await db.query(`
      INSERT INTO ingredients (id, tenantId, name, unit, currentStock, minStock, costPerUnitCOP)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        tenantId = EXCLUDED.tenantId,
        name = EXCLUDED.name,
        unit = EXCLUDED.unit,
        currentStock = EXCLUDED.currentStock,
        minStock = EXCLUDED.minStock,
        costPerUnitCOP = EXCLUDED.costPerUnitCOP
    `, [item.id, item.tenantId, item.name, item.unit, item.currentStock, item.minStock, item.costPerUnitCOP]);
    return item;
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM ingredients WHERE id = $1', [id]);
    return res.rows[0] ? new Ingredient(res.rows[0]) : null;
  }

  static async findAll(customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT * FROM ingredients WHERE tenantId = $1 ORDER BY name ASC'
      : 'SELECT * FROM ingredients ORDER BY name ASC';
    const params = tenantId && tenantId !== 'ALL' ? [tenantId] : [];

    const res = await db.query(queryText, params);
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

  static async getLowStock(customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT * FROM ingredients WHERE currentStock <= minStock AND tenantId = $1 ORDER BY currentStock ASC'
      : 'SELECT * FROM ingredients WHERE currentStock <= minStock ORDER BY currentStock ASC';
    const params = tenantId && tenantId !== 'ALL' ? [tenantId] : [];

    const res = await db.query(queryText, params);
    return res.rows.map(r => new Ingredient(r));
  }
}

module.exports = Ingredient;
