const { getDatabase } = require('../config/database');

class ShiftAudit {
  constructor(data) {
    this.id = data.id;
    this.tenantId = data.tenantId || data.tenantid || 'tenant-default';
    this.shiftNumber = Number(data.shiftNumber ?? data.shiftnumber ?? 1);
    this.cashierId = data.cashierId || data.cashierid;
    this.cashierName = data.cashierName || data.cashiername;
    this.openedAt = data.openedAt || data.openedat || new Date().toISOString();
    this.closedAt = data.closedAt || data.closedat || null;
    this.initialCashCOP = Number(data.initialCashCOP ?? data.initialcashcop ?? 0);
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
    const tenantId = data.tenantId || data.tenantid || 'tenant-default';
    const openedAt = data.openedAt || new Date().toISOString();
    const initialCashCOP = Number(data.initialCashCOP ?? data.initialcashcop ?? 0);

    await db.query(`
      INSERT INTO shift_audits (
        id, tenantId, shiftNumber, cashierId, cashierName, openedAt, initialCashCOP, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8)
      ON CONFLICT (id) DO UPDATE SET
        tenantId = EXCLUDED.tenantId,
        shiftNumber = EXCLUDED.shiftNumber,
        cashierId = EXCLUDED.cashierId,
        cashierName = EXCLUDED.cashierName,
        openedAt = EXCLUDED.openedAt,
        initialCashCOP = EXCLUDED.initialCashCOP,
        notes = EXCLUDED.notes
    `, [
      id,
      tenantId,
      data.shiftNumber || 1,
      data.cashierId,
      data.cashierName,
      openedAt,
      initialCashCOP,
      data.notes || null
    ]);

    return await ShiftAudit.findById(id, db);
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM shift_audits WHERE id = $1', [id]);
    return res.rows[0] ? new ShiftAudit(res.rows[0]) : null;
  }

  static async findActive(customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? "SELECT * FROM shift_audits WHERE status = 'OPEN' AND tenantId = $1 ORDER BY openedAt DESC LIMIT 1"
      : "SELECT * FROM shift_audits WHERE status = 'OPEN' ORDER BY openedAt DESC LIMIT 1";
    const params = tenantId && tenantId !== 'ALL' ? [tenantId] : [];

    const res = await db.query(queryText, params);
    return res.rows[0] ? new ShiftAudit(res.rows[0]) : null;
  }

  /**
   * Ejecuta el cierre ciego calculando las discrepancias contra las ventas reales del sistema.
   * Filtra por tenantId para asegurar aislamiento estricto de restaurantes.
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

    const tenantId = shift.tenantId || 'tenant-default';
    const closedAt = new Date().toISOString();

    // Consultar pagos de facturas PAGADAS registradas durante el turno
    const res = await db.query(`
      SELECT p.method, SUM(p.amountCOP) as total
      FROM invoice_payments p
      JOIN invoices i ON p.invoiceId = i.id
      WHERE p.createdAt >= $1 AND p.createdAt <= $2 AND i.tenantId = $3 AND i.status = 'PAID'
      GROUP BY p.method
    `, [shift.openedAt, closedAt, tenantId]);

    let systemCashFromPayments = 0;
    let systemCard = 0;
    let systemTransfers = 0;

    for (const row of res.rows) {
      const amount = Number(row.total);
      if (row.method === 'CASH') systemCashFromPayments += amount;
      else if (row.method === 'CARD') systemCard += amount;
      else if (row.method === 'NEQUI' || row.method === 'DAVIPLATA' || row.method === 'TRANSFER') systemTransfers += amount;
    }

    const initialCash = Number(shift.initialCashCOP) || 0;
    const systemCash = initialCash + systemCashFromPayments;

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

    const closedShift = await ShiftAudit.findById(shiftId, db);
    if (closedShift) {
      closedShift.cashSalesCOP = systemCashFromPayments;
      closedShift.initialCashCOP = initialCash;
    }
    return closedShift;
  }
}

module.exports = ShiftAudit;
