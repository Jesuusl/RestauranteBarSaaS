const { getDatabase } = require('../config/database');

class Waste {
  constructor(data) {
    this.id = data.id;
    this.tenantId = data.tenantId || data.tenantid || 'tenant-default';
    this.productId = data.productId || data.productid || null;
    this.ingredientId = data.ingredientId || data.ingredientid || null;
    this.quantity = Number(data.quantity);
    this.unit = data.unit;
    this.type = data.type; // WASTE | COURTESY | STAFF_MEAL
    this.reason = data.reason;
    this.authorizedBy = data.authorizedBy || data.authorizedby;
    this.totalCostCOP = Number(data.totalCostCOP ?? data.totalcostcop ?? 0);
    this.createdAt = data.createdAt || data.createdat || new Date().toISOString();
  }

  static async create(data, customDb) {
    const db = customDb || getDatabase();
    const tenantId = data.tenantId || data.tenantid || 'tenant-default';
    const waste = new Waste({ ...data, tenantId });

    await db.query(`
      INSERT INTO wastes (
        id, tenantId, productId, ingredientId, quantity, unit, type, reason, authorizedBy, totalCostCOP, createdAt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        tenantId = EXCLUDED.tenantId,
        productId = EXCLUDED.productId,
        ingredientId = EXCLUDED.ingredientId,
        quantity = EXCLUDED.quantity,
        unit = EXCLUDED.unit,
        type = EXCLUDED.type,
        reason = EXCLUDED.reason,
        authorizedBy = EXCLUDED.authorizedBy,
        totalCostCOP = EXCLUDED.totalCostCOP,
        createdAt = EXCLUDED.createdAt
    `, [
      waste.id,
      waste.tenantId,
      waste.productId,
      waste.ingredientId,
      waste.quantity,
      waste.unit,
      waste.type,
      waste.reason,
      waste.authorizedBy,
      waste.totalCostCOP,
      waste.createdAt
    ]);

    return await Waste.findById(waste.id, db);
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM wastes WHERE id = $1', [id]);
    return res.rows[0] ? new Waste(res.rows[0]) : null;
  }

  static async findAll(customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT * FROM wastes WHERE tenantId = $1 ORDER BY createdAt DESC'
      : 'SELECT * FROM wastes ORDER BY createdAt DESC';
    const params = tenantId && tenantId !== 'ALL' ? [tenantId] : [];

    const res = await db.query(queryText, params);
    return res.rows.map(r => new Waste(r));
  }

  static async getTotalCostByType(type, customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT SUM(totalCostCOP) as total FROM wastes WHERE type = $1 AND tenantId = $2'
      : 'SELECT SUM(totalCostCOP) as total FROM wastes WHERE type = $1';
    const params = tenantId && tenantId !== 'ALL' ? [type, tenantId] : [type];

    const res = await db.query(queryText, params);
    const row = res.rows[0];
    return row ? Number(row.total || 0) : 0;
  }
}

module.exports = Waste;
