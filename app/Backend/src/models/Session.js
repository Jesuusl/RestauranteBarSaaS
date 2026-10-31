const { getDatabase } = require('../config/database');

class Session {
  constructor(data) {
    this.id = data.id;
    this.tableId = data.tableId || data.tableid;
    this.waiterId = data.waiterId || data.waiterid;
    this.waiterName = data.waiterName || data.waitername;
    this.dinerCount = Number(data.dinerCount || data.dinercount || 1);
    this.openedAt = data.openedAt || data.openedat || new Date().toISOString();
    this.closedAt = data.closedAt || data.closedat || null;
    this.status = data.status || 'OPEN'; // OPEN, SPLITTING, CLOSED
    const rawSubs = data.subAccounts ?? data.subaccounts;
    this.subAccounts = typeof rawSubs === 'string'
      ? JSON.parse(rawSubs || 'null')
      : rawSubs || null;
  }

  static async create(sessionData, customDb) {
    const db = customDb || getDatabase();
    const session = new Session(sessionData);
    const subAccountsJson = session.subAccounts ? JSON.stringify(session.subAccounts) : null;

    await db.query(`
      INSERT INTO sessions (id, tableId, waiterId, waiterName, dinerCount, openedAt, closedAt, status, subAccounts)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        tableId = EXCLUDED.tableId,
        waiterId = EXCLUDED.waiterId,
        waiterName = EXCLUDED.waiterName,
        dinerCount = EXCLUDED.dinerCount,
        openedAt = EXCLUDED.openedAt,
        closedAt = EXCLUDED.closedAt,
        status = EXCLUDED.status,
        subAccounts = EXCLUDED.subAccounts
    `, [
      session.id,
      session.tableId,
      session.waiterId,
      session.waiterName,
      session.dinerCount,
      session.openedAt,
      session.closedAt,
      session.status,
      subAccountsJson
    ]);

    // Actualizar estado de la mesa a OCCUPIED
    await db.query('UPDATE tables SET status = $1, currentSessionId = $2 WHERE id = $3', [
      'OCCUPIED',
      session.id,
      session.tableId
    ]);

    return session;
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM sessions WHERE id = $1', [id]);
    return res.rows[0] ? new Session(res.rows[0]) : null;
  }

  static async findActiveByTable(tableId, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query(
      "SELECT * FROM sessions WHERE tableId = $1 AND status IN ('OPEN', 'SPLITTING') ORDER BY openedAt DESC LIMIT 1",
      [tableId]
    );
    return res.rows[0] ? new Session(res.rows[0]) : null;
  }

  static async updateSubAccounts(id, subAccounts, customDb) {
    const db = customDb || getDatabase();
    const subAccountsJson = JSON.stringify(subAccounts);
    await db.query('UPDATE sessions SET subAccounts = $1, status = $2 WHERE id = $3', [
      subAccountsJson,
      'SPLITTING',
      id
    ]);
    return await Session.findById(id, db);
  }

  static async close(id, customDb) {
    const db = customDb || getDatabase();
    const session = await Session.findById(id, db);
    if (!session) return null;

    const closedAt = new Date().toISOString();
    await db.query("UPDATE sessions SET status = 'CLOSED', closedAt = $1 WHERE id = $2", [closedAt, id]);

    // Actualizar mesa a CLEANING o AVAILABLE
    await db.query("UPDATE tables SET status = 'CLEANING', currentSessionId = NULL WHERE id = $1", [session.tableId]);

    return await Session.findById(id, db);
  }
}

module.exports = Session;
