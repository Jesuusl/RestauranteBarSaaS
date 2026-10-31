const { getDatabase } = require('../config/database');

class ShiftAudit {
  constructor(data) {
    this.id = data.id;
    this.shiftNumber = Number(data.shiftNumber ?? data.shiftnumber ?? 1);
    this.cashierId = data.cashierId || data.cashierid;
    this.cashierName = data.cashierName || data.cashiername;
    this.openedAt = data.openedAt || data.openedat || new Date().toISOString();
    this.closedAt = data.closedAt || data.closedat || null;
    this.declaredCashCOP = Number(data.declaredCashCOP ?? data.declaredcashcop ?? 0);
    this.declaredCardCOP = Number(data.declaredCardCOP ?? data.declaredcardcop ?? 0);
    this.declaredTransfersCOP = Number(data.declaredTransfersCOP ?? data.declaredtransferscop ?? 0);
    this.systemCashCOP = Number(data.systemCashCOP ?? data.systemcashcop ?? 0);
    this.systemCardCOP = Number(data.systemCardCOP ?? data.systemcardcop ?? 0);
    this.systemTransfersCOP = Number(data.systemTransfersCOP ?? data.systemtransferscop ?? 0);
    this.discrepancyCashCOP = Number(data.discrepancyCashCOP ?? data.discrepancycashcop ?? 0);
    this.discrepancyCardCOP = Number(data.discrepancyCardCOP ?? data.discrepancycardcop ?? 0);
    this.discrepancyTransfersCOP = Number(data.discrepancyTransfersCOP ?? data.discrepancytransferscop ?? 0);
    this.totalDiscrepancyCOP = Number(data.totalDiscrepancyCOP ?? data.totaldiscrepancycop ?? 0);
    this.status = data.status || 'OPEN'; // OPEN | CLOSED
    this.notes = data.notes || null;
  }

  static async openShift(data, customDb) {
    const db = customDb || getDatabase();
    const id = data.id || `shift-${Date.now()}`;
    const openedAt = data.openedAt || new Date().toISOString();

    await db.query(`
      INSERT INTO shift_audits (
        id, shiftNumber, cashierId, cashierName, openedAt, status, notes
      ) VALUES ($1, $2, $3, $4, $5, 'OPEN', $6)
      ON CONFLICT (id) DO UPDATE SET
        shiftNumber = EXCLUDED.shiftNumber,
        cashierId = EXCLUDED.cashierId,
        cashierName = EXCLUDED.cashierName,
        openedAt = EXCLUDED.openedAt,
        notes = EXCLUDED.notes
    `, [
      id,
      data.shiftNumber || 1,
      data.cashierId,
      data.cashierName,
      openedAt,
      data.notes || null
    ]);

    return await ShiftAudit.findById(id, db);
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM shift_audits WHERE id = $1', [id]);
    return res.rows[0] ? new ShiftAudit(res.rows[0]) : null;
  }

  static async findActive(customDb) {
    const db = customDb || getDatabase();
    const res = await db.query("SELECT * FROM shift_audits WHERE status = 'OPEN' ORDER BY openedAt DESC LIMIT 1");
    return res.rows[0] ? new ShiftAudit(res.rows[0]) : null;
  }

  /**
   * Ejecuta el cierre ciego calculando las discrepancias contra las ventas reales del sistema.
   *
   * @param {string} shiftId
   * @param {Object} declared - { declaredCashCOP, declaredCardCOP, declaredTransfersCOP }
   * @param {string} [notes]
   * @param {Object} [customDb]
   */
  static async performBlindClose(shiftId, declared, notes = null, customDb) {
    const db = customDb || getDatabase();
    const shift = await ShiftAudit.findById(shiftId, db);
    if (!shift) throw new Error(`Turno no encontrado: ${shiftId}`);

    const closedAt = new Date().toISOString();

    // Consultar ventas registradas durante el turno
    const res = await db.query(`
      SELECT p.method, SUM(p.amountCOP) as total
      FROM invoice_payments p
      WHERE p.createdAt >= $1 AND p.createdAt <= $2
      GROUP BY p.method
    `, [shift.openedAt, closedAt]);

    let systemCash = 0;
    let systemCard = 0;
    let systemTransfers = 0;

    for (const row of res.rows) {
      const amount = Number(row.total);
      if (row.method === 'CASH') systemCash += amount;
      else if (row.method === 'CARD') systemCard += amount;
      else if (row.method === 'NEQUI' || row.method === 'DAVIPLATA') systemTransfers += amount;
    }

    const declaredCash = Number(declared.declaredCashCOP || 0);
    const declaredCard = Number(declared.declaredCardCOP || 0);
    const declaredTransfers = Number(declared.declaredTransfersCOP || 0);

    // Discrepancia = Declarado - Sistema (positivo = sobrante, negativo = faltante)
    const discrepancyCash = declaredCash - systemCash;
    const discrepancyCard = declaredCard - systemCard;
    const discrepancyTransfers = declaredTransfers - systemTransfers;
    const totalDiscrepancy = discrepancyCash + discrepancyCard + discrepancyTransfers;

    await db.query(`
      UPDATE shift_audits
      SET closedAt = $1,
          declaredCashCOP = $2,
          declaredCardCOP = $3,
          declaredTransfersCOP = $4,
          systemCashCOP = $5,
          systemCardCOP = $6,
          systemTransfersCOP = $7,
          discrepancyCashCOP = $8,
          discrepancyCardCOP = $9,
          discrepancyTransfersCOP = $10,
          totalDiscrepancyCOP = $11,
          status = 'CLOSED',
          notes = $12
      WHERE id = $13
    `, [
      closedAt,
      declaredCash,
      declaredCard,
      declaredTransfers,
      systemCash,
      systemCard,
      systemTransfers,
      discrepancyCash,
      discrepancyCard,
      discrepancyTransfers,
      totalDiscrepancy,
      notes || shift.notes,
      shiftId
    ]);

    return await ShiftAudit.findById(shiftId, db);
  }
}

module.exports = ShiftAudit;
