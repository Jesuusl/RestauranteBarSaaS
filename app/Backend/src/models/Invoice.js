const { getDatabase } = require('../config/database');

class Invoice {
  constructor(data) {
    this.id = data.id;
    this.sessionId = data.sessionId || data.sessionid;
    this.tableId = data.tableId || data.tableid;
    this.subtotalCOP = Number(data.subtotalCOP ?? data.subtotalcop ?? 0);
    this.impoconsumoRate = Number(data.impoconsumoRate ?? data.impoconsumorate ?? 0.08);
    this.impoconsumoCOP = Number(data.impoconsumoCOP ?? data.impoconsumocop ?? 0);
    this.ivaRate = Number(data.ivaRate ?? data.ivarate ?? 0.00);
    this.ivaCOP = Number(data.ivaCOP ?? data.ivacop ?? 0.00);
    this.tipRate = Number(data.tipRate ?? data.tiprate ?? 0.10);
    this.tipCOP = Number(data.tipCOP ?? data.tipcop ?? 0);
    this.totalCOP = Number(data.totalCOP ?? data.totalcop ?? 0);
    this.splitType = data.splitType || data.splittype || 'SINGLE'; // SINGLE | EQUAL | ITEMS
    this.status = data.status || 'PAID'; // DRAFT | PAID | CANCELLED
    this.createdAt = data.createdAt || data.createdat || new Date().toISOString();
    this.payments = (data.payments || []).map(p => ({
      id: p.id,
      invoiceId: p.invoiceId || p.invoiceid || this.id,
      subAccountId: p.subAccountId || p.subaccountid || null,
      method: p.method,
      amountCOP: Number(p.amountCOP ?? p.amountcop ?? 0),
      reference: p.reference || null,
      createdAt: p.createdAt || p.createdat || this.createdAt
    }));
  }

  static async create(invoiceData, customDb) {
    const db = customDb || getDatabase();
    const invoice = new Invoice(invoiceData);

    await db.query(`
      INSERT INTO invoices (
        id, sessionId, tableId, subtotalCOP, impoconsumoRate, impoconsumoCOP,
        ivaRate, ivaCOP, tipRate, tipCOP, totalCOP, splitType, status, createdAt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        sessionId = EXCLUDED.sessionId,
        tableId = EXCLUDED.tableId,
        subtotalCOP = EXCLUDED.subtotalCOP,
        impoconsumoRate = EXCLUDED.impoconsumoRate,
        impoconsumoCOP = EXCLUDED.impoconsumoCOP,
        ivaRate = EXCLUDED.ivaRate,
        ivaCOP = EXCLUDED.ivaCOP,
        tipRate = EXCLUDED.tipRate,
        tipCOP = EXCLUDED.tipCOP,
        totalCOP = EXCLUDED.totalCOP,
        splitType = EXCLUDED.splitType,
        status = EXCLUDED.status,
        createdAt = EXCLUDED.createdAt
    `, [
      invoice.id,
      invoice.sessionId,
      invoice.tableId,
      invoice.subtotalCOP,
      invoice.impoconsumoRate,
      invoice.impoconsumoCOP,
      invoice.ivaRate,
      invoice.ivaCOP,
      invoice.tipRate,
      invoice.tipCOP,
      invoice.totalCOP,
      invoice.splitType,
      invoice.status,
      invoice.createdAt
    ]);

    if (Array.isArray(invoiceData.payments) && invoiceData.payments.length > 0) {
      for (let i = 0; i < invoiceData.payments.length; i++) {
        const p = invoiceData.payments[i];
        const payId = p.id || `${invoice.id}-pay-${i + 1}`;
        await db.query(`
          INSERT INTO invoice_payments (id, invoiceId, subAccountId, method, amountCOP, reference, createdAt)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            invoiceId = EXCLUDED.invoiceId,
            subAccountId = EXCLUDED.subAccountId,
            method = EXCLUDED.method,
            amountCOP = EXCLUDED.amountCOP,
            reference = EXCLUDED.reference,
            createdAt = EXCLUDED.createdAt
        `, [
          payId,
          invoice.id,
          p.subAccountId || null,
          p.method,
          Number(p.amountCOP),
          p.reference || null,
          p.createdAt || invoice.createdAt
        ]);
      }
    }

    return await Invoice.findById(invoice.id, db);
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) return null;

    const payRes = await db.query('SELECT * FROM invoice_payments WHERE invoiceId = $1', [id]);
    return new Invoice({ ...row, payments: payRes.rows });
  }

  static async findBySession(sessionId, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT id FROM invoices WHERE sessionId = $1', [sessionId]);
    const invoices = [];
    for (const r of res.rows) {
      const inv = await Invoice.findById(r.id, db);
      if (inv) invoices.push(inv);
    }
    return invoices;
  }

  static async addPayment(invoiceId, paymentData, customDb) {
    const db = customDb || getDatabase();
    const id = paymentData.id || `${invoiceId}-pay-${Date.now()}`;
    await db.query(`
      INSERT INTO invoice_payments (id, invoiceId, subAccountId, method, amountCOP, reference, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        invoiceId = EXCLUDED.invoiceId,
        subAccountId = EXCLUDED.subAccountId,
        method = EXCLUDED.method,
        amountCOP = EXCLUDED.amountCOP,
        reference = EXCLUDED.reference,
        createdAt = EXCLUDED.createdAt
    `, [
      id,
      invoiceId,
      paymentData.subAccountId || null,
      paymentData.method,
      Number(paymentData.amountCOP),
      paymentData.reference || null,
      paymentData.createdAt || new Date().toISOString()
    ]);
    return await Invoice.findById(invoiceId, db);
  }
}

module.exports = Invoice;
