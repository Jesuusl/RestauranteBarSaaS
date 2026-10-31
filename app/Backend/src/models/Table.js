const { getDatabase } = require('../config/database');
const eventService = require('../services/eventService');

class Table {
  constructor(data) {
    this.id = data.id;
    this.number = Number(data.number);
    this.zone = data.zone;
    this.capacity = Number(data.capacity);
    this.posX = Number(data.posX ?? 0);
    this.posY = Number(data.posY ?? 0);
    this.status = data.status || 'AVAILABLE'; // AVAILABLE, OCCUPIED, RESERVED, PAYING, CLEANING
    this.currentSessionId = data.currentSessionId || null;
    this.lastOrderAt = data.lastOrderAt || null;
  }

  static async create(tableData, customDb) {
    const db = customDb || getDatabase();
    const table = new Table(tableData);
    await db.query(`
      INSERT INTO tables (id, number, zone, capacity, posX, posY, status, currentSessionId, lastOrderAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        number = EXCLUDED.number,
        zone = EXCLUDED.zone,
        capacity = EXCLUDED.capacity,
        posX = EXCLUDED.posX,
        posY = EXCLUDED.posY,
        status = EXCLUDED.status,
        currentSessionId = EXCLUDED.currentSessionId,
        lastOrderAt = EXCLUDED.lastOrderAt
    `, [
      table.id,
      table.number,
      table.zone,
      table.capacity,
      table.posX,
      table.posY,
      table.status,
      table.currentSessionId,
      table.lastOrderAt
    ]);
    return table;
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM tables WHERE id = $1', [id]);
    return res.rows[0] ? new Table(res.rows[0]) : null;
  }

  static async findByNumber(number, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM tables WHERE number = $1', [number]);
    return res.rows[0] ? new Table(res.rows[0]) : null;
  }

  static async findAll(customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM tables ORDER BY number ASC');
    return res.rows.map(r => new Table(r));
  }

  static async findByZone(zone, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM tables WHERE zone = $1 ORDER BY number ASC', [zone]);
    return res.rows.map(r => new Table(r));
  }

  static async updateStatus(id, status, currentSessionId = null, customDb) {
    const db = customDb || getDatabase();
    await db.query(`
      UPDATE tables
      SET status = $1, currentSessionId = $2
      WHERE id = $3
    `, [status, currentSessionId, id]);
    const updated = await Table.findById(id, db);
    if (updated) {
      eventService.broadcast(eventService.EVENT_TYPES.TABLE_STATUS_CHANGED, updated);
    }
    return updated;
  }

  static async updateLastOrder(id, timestamp, customDb) {
    const db = customDb || getDatabase();
    await db.query('UPDATE tables SET lastOrderAt = $1 WHERE id = $2', [timestamp, id]);
    return await Table.findById(id, db);
  }
}

module.exports = Table;
