const { getDatabase } = require('../config/database');

class Invoice {
  constructor(data) {
    this.id = data.id;
    this.tenantId = data.tenantId || data.tenantid || 'tenant-default';
    this.sessionId = data.sessionId ?? data.sessionid ?? null;
    this.tableId = data.tableId ?? data.tableid ?? null;
    this.saleType = data.saleType || data.saletype || 'TABLE'; // TABLE | EXPRESS
    this.customerNote = data.customerNote || data.customernote || null;
    this.cashierName = data.cashierName || data.cashiername || null;
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
    this.cancelReason = data.cancelReason || data.cancelreason || null;
    this.cancelledAt = data.cancelledAt || data.cancelledat || null;
    this.cancelledBy = data.cancelledBy || data.cancelledby || null;
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

    this.items = (data.items || []).map(i => ({
      id: i.id,
      invoiceId: i.invoiceId || i.invoiceid || this.id,
      tenantId: i.tenantId || i.tenantid || this.tenantId,
      productId: i.productId || i.productid || null,
      productName: i.productName || i.productname || i.name || 'Producto',
      category: i.category || null,
      quantity: Number(i.quantity || 1),
      unitPriceCOP: Number(i.unitPriceCOP ?? i.unitpricecop ?? 0),
      subtotalCOP: Number(i.subtotalCOP ?? i.subtotalcop ?? (Number(i.quantity || 1) * Number(i.unitPriceCOP ?? i.unitpricecop ?? 0))),
      createdAt: i.createdAt || i.createdat || this.createdAt
    }));
  }

  static async create(invoiceData, customDb) {
    const db = customDb || getDatabase();
    const tenantId = invoiceData.tenantId || invoiceData.tenantid || 'tenant-default';
    const invoice = new Invoice({ ...invoiceData, tenantId });

    await db.query(`
      INSERT INTO invoices (
        id, tenantId, sessionId, tableId, saleType, customerNote, cashierName,
        subtotalCOP, impoconsumoRate, impoconsumoCOP,
        ivaRate, ivaCOP, tipRate, tipCOP, totalCOP, splitType, status,
        cancelReason, cancelledAt, cancelledBy, createdAt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (id) DO UPDATE SET
        tenantId = EXCLUDED.tenantId,
        sessionId = EXCLUDED.sessionId,
        tableId = EXCLUDED.tableId,
        saleType = EXCLUDED.saleType,
        customerNote = EXCLUDED.customerNote,
        cashierName = EXCLUDED.cashierName,
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
        cancelReason = EXCLUDED.cancelReason,
        cancelledAt = EXCLUDED.cancelledAt,
        cancelledBy = EXCLUDED.cancelledBy,
        createdAt = EXCLUDED.createdAt
    `, [
      invoice.id,
      invoice.tenantId,
      invoice.sessionId,
      invoice.tableId,
      invoice.saleType,
      invoice.customerNote,
      invoice.cashierName,
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
      invoice.cancelReason,
      invoice.cancelledAt,
      invoice.cancelledBy,
      invoice.createdAt
    ]);

    // Guardar pagos si vienen incluidos
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

    // Guardar items en invoice_items si vienen incluidos
    if (Array.isArray(invoiceData.items) && invoiceData.items.length > 0) {
      for (let i = 0; i < invoiceData.items.length; i++) {
        const it = invoiceData.items[i];
        const itemId = it.id || `${invoice.id}-item-${i + 1}`;
        const qty = Number(it.quantity || 1);
        const unitPrice = Number(it.unitPriceCOP ?? it.unitpricecop ?? 0);
        const subtotal = Number(it.subtotalCOP ?? it.subtotalcop ?? Math.round(qty * unitPrice));

        await db.query(`
          INSERT INTO invoice_items (id, invoiceId, tenantId, productId, productName, category, quantity, unitPriceCOP, subtotalCOP, createdAt)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            invoiceId = EXCLUDED.invoiceId,
            tenantId = EXCLUDED.tenantId,
            productId = EXCLUDED.productId,
            productName = EXCLUDED.productName,
            category = EXCLUDED.category,
            quantity = EXCLUDED.quantity,
            unitPriceCOP = EXCLUDED.unitPriceCOP,
            subtotalCOP = EXCLUDED.subtotalCOP
        `, [
          itemId,
          invoice.id,
          invoice.tenantId,
          it.productId || null,
          it.productName || it.name || 'Producto',
          it.category || null,
          qty,
          unitPrice,
          subtotal,
          it.createdAt || invoice.createdAt
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
    const itemsRes = await db.query('SELECT * FROM invoice_items WHERE invoiceId = $1', [id]);

    return new Invoice({ ...row, payments: payRes.rows, items: itemsRes.rows });
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

  static async findAll(customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT id FROM invoices WHERE tenantId = $1 ORDER BY createdAt DESC'
      : 'SELECT id FROM invoices ORDER BY createdAt DESC';
    const params = tenantId && tenantId !== 'ALL' ? [tenantId] : [];

    const res = await db.query(queryText, params);
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

  static async cancel(id, { reason, cancelledBy }, customDb) {
    const db = customDb || getDatabase();
    const existing = await Invoice.findById(id, db);
    if (!existing) return null;

    const cancelledAt = new Date().toISOString();
    const cBy = cancelledBy || 'Administrador';

    await db.query(`
      UPDATE invoices
      SET status = 'CANCELLED', cancelReason = $1, cancelledAt = $2, cancelledBy = $3
      WHERE id = $4
    `, [reason, cancelledAt, cBy, id]);

    return await Invoice.findById(id, db);
  }
}

module.exports = Invoice;
