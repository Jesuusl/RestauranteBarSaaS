const { getDatabase } = require('../config/database');
const eventService = require('../services/eventService');

class Table {
  constructor(data) {
    this.id = data.id;
    this.tenantId = data.tenantId || data.tenantid || 'tenant-default';
    this.number = Number(data.number);
    this.zone = data.zone;
    this.capacity = Number(data.capacity);
    this.posX = Number(data.posX ?? data.posx ?? 0);
    this.posY = Number(data.posY ?? data.posy ?? 0);
    this.status = data.status || 'AVAILABLE'; // AVAILABLE, OCCUPIED, RESERVED, PAYING, CLEANING
    this.currentSessionId = data.currentSessionId ?? data.currentsessionid ?? null;
    this.lastOrderAt = data.lastOrderAt ?? data.lastorderat ?? null;
  }

  static async create(tableData, customDb) {
    const db = customDb || getDatabase();
    const id = tableData.id || `tab-${tableData.number !== undefined ? tableData.number : Date.now()}`;
    const tenantId = tableData.tenantId || tableData.tenantid || 'tenant-default';
    const table = new Table({ ...tableData, id, tenantId });

    await db.query(`
      INSERT INTO tables (id, tenantId, number, zone, capacity, posX, posY, status, currentSessionId, lastOrderAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        tenantId = EXCLUDED.tenantId,
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
      table.tenantId,
      table.number,
      table.zone,
      table.capacity,
      table.posX,
      table.posY,
      table.status,
      table.currentSessionId,
      table.lastOrderAt
    ]);

    if (eventService) {
      eventService.broadcast(eventService.EVENT_TYPES.TABLE_STATUS_CHANGED, table);
    }
    return table;
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM tables WHERE id = $1', [id]);
    return res.rows[0] ? new Table(res.rows[0]) : null;
  }

  static async findByNumber(number, customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT * FROM tables WHERE number = $1 AND tenantId = $2'
      : 'SELECT * FROM tables WHERE number = $1';
    const params = tenantId && tenantId !== 'ALL' ? [number, tenantId] : [number];

    const res = await db.query(queryText, params);
    return res.rows[0] ? new Table(res.rows[0]) : null;
  }

  static async findAll(customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT * FROM tables WHERE tenantId = $1 ORDER BY number ASC'
      : 'SELECT * FROM tables ORDER BY number ASC';
    const params = tenantId && tenantId !== 'ALL' ? [tenantId] : [];

    const res = await db.query(queryText, params);
    return res.rows.map(r => new Table(r));
  }

  static async findByZone(zone, customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT * FROM tables WHERE zone = $1 AND tenantId = $2 ORDER BY number ASC'
      : 'SELECT * FROM tables WHERE zone = $1 ORDER BY number ASC';
    const params = tenantId && tenantId !== 'ALL' ? [zone, tenantId] : [zone];

    const res = await db.query(queryText, params);
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
    if (updated && eventService) {
      eventService.broadcast(eventService.EVENT_TYPES.TABLE_STATUS_CHANGED, updated);
    }
    return updated;
  }

  static async updateLastOrder(id, timestamp, customDb) {
    const db = customDb || getDatabase();
    await db.query('UPDATE tables SET lastOrderAt = $1 WHERE id = $2', [timestamp, id]);
    return await Table.findById(id, db);
  }

  static async update(id, data, customDb) {
    const db = customDb || getDatabase();
    const existing = await Table.findById(id, db);
    if (!existing) {
      return null;
    }

    const number = data.number !== undefined ? Number(data.number) : existing.number;
    const zone = data.zone !== undefined ? data.zone : existing.zone;
    const capacity = data.capacity !== undefined ? Number(data.capacity) : existing.capacity;
    const posX = data.posX !== undefined ? Number(data.posX) : existing.posX;
    const posY = data.posY !== undefined ? Number(data.posY) : existing.posY;
    const status = data.status !== undefined ? data.status : existing.status;
    const currentSessionId = data.currentSessionId !== undefined ? data.currentSessionId : existing.currentSessionId;
    const lastOrderAt = data.lastOrderAt !== undefined ? data.lastOrderAt : existing.lastOrderAt;

    await db.query(`
      UPDATE tables
      SET number = $1, zone = $2, capacity = $3, posX = $4, posY = $5,
          status = $6, currentSessionId = $7, lastOrderAt = $8
      WHERE id = $9
    `, [number, zone, capacity, posX, posY, status, currentSessionId, lastOrderAt, id]);

    const updated = await Table.findById(id, db);
    if (updated && eventService) {
      eventService.broadcast(eventService.EVENT_TYPES.TABLE_STATUS_CHANGED, updated);
    }
    return updated;
  }

  static async delete(id, customDb) {
    const db = customDb || getDatabase();
    const existing = await Table.findById(id, db);
    if (!existing) {
      return false;
    }

    await db.query('DELETE FROM tables WHERE id = $1', [id]);
    if (eventService) {
      eventService.broadcast(eventService.EVENT_TYPES.TABLE_STATUS_CHANGED, {
        id,
        number: existing.number,
        zone: existing.zone,
        status: 'DELETED',
        deleted: true
      });
    }
    return true;
  }
}

module.exports = Table;
