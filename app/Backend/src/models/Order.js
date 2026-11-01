const { getDatabase } = require('../config/database');

class Order {
  constructor(data) {
    this.id = data.id;
    this.tenantId = data.tenantId || data.tenantid || 'tenant-default';
    this.sessionId = data.sessionId || data.sessionid;
    this.tableId = data.tableId || data.tableid;
    this.tableNumber = data.tableNumber !== undefined ? (data.tableNumber !== null ? Number(data.tableNumber) : null) : (data.tablenumber !== undefined ? (data.tablenumber !== null ? Number(data.tablenumber) : null) : null);
    this.waiterId = data.waiterId || data.waiterid;
    this.station = data.station; // KITCHEN | BAR
    this.status = data.status || 'PENDING'; // PENDING, IN_PREP, READY, SERVED, CANCELLED
    this.createdAt = data.createdAt || data.createdat || new Date().toISOString();
    this.items = (data.items || []).map(item => {
      const rawMods = item.modifiers;
      return {
        id: item.id,
        orderId: item.orderId || item.orderid || this.id,
        productId: item.productId || item.productid,
        productName: item.productName || item.productname,
        quantity: Number(item.quantity),
        seatNumber: Number(item.seatNumber || item.seatnumber || 1),
        modifiers: typeof rawMods === 'string'
          ? JSON.parse(rawMods || '[]')
          : (rawMods || []),
        notes: item.notes || null,
        unitPriceCOP: Number(item.unitPriceCOP ?? item.unitpricecop ?? 0)
      };
    });
  }

  static async create(orderData, customDb) {
    const db = customDb || getDatabase();
    const tenantId = orderData.tenantId || orderData.tenantid || 'tenant-default';
    const order = new Order({ ...orderData, tenantId });

    await db.query(`
      INSERT INTO orders (id, tenantId, sessionId, tableId, waiterId, station, status, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        tenantId = EXCLUDED.tenantId,
        sessionId = EXCLUDED.sessionId,
        tableId = EXCLUDED.tableId,
        waiterId = EXCLUDED.waiterId,
        station = EXCLUDED.station,
        status = EXCLUDED.status,
        createdAt = EXCLUDED.createdAt
    `, [
      order.id,
      order.tenantId,
      order.sessionId,
      order.tableId,
      order.waiterId,
      order.station,
      order.status,
      order.createdAt
    ]);

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      const itemId = item.id || `${order.id}-item-${i + 1}`;
      const modifiersJson = JSON.stringify(item.modifiers || []);
      await db.query(`
        INSERT INTO order_items (id, orderId, productId, productName, quantity, seatNumber, modifiers, notes, unitPriceCOP)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          orderId = EXCLUDED.orderId,
          productId = EXCLUDED.productId,
          productName = EXCLUDED.productName,
          quantity = EXCLUDED.quantity,
          seatNumber = EXCLUDED.seatNumber,
          modifiers = EXCLUDED.modifiers,
          notes = EXCLUDED.notes,
          unitPriceCOP = EXCLUDED.unitPriceCOP
      `, [
        itemId,
        order.id,
        item.productId,
        item.productName,
        item.quantity,
        item.seatNumber || 1,
        modifiersJson,
        item.notes || null,
        item.unitPriceCOP
      ]);
    }

    // Actualizar última orden en la mesa
    if (order.tableId) {
      await db.query('UPDATE tables SET lastOrderAt = $1 WHERE id = $2', [order.createdAt, order.tableId]);
    }

    return await Order.findById(order.id, db);
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query(`
      SELECT o.*, t.number AS tableNumber
      FROM orders o
      LEFT JOIN tables t ON o.tableId = t.id
      WHERE o.id = $1
    `, [id]);
    const row = res.rows[0];
    if (!row) return null;

    const itemsRes = await db.query('SELECT * FROM order_items WHERE orderId = $1', [id]);
    return new Order({ ...row, items: itemsRes.rows });
  }

  static async findBySession(sessionId, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT id FROM orders WHERE sessionId = $1 ORDER BY createdAt ASC', [sessionId]);
    const orders = [];
    for (const r of res.rows) {
      const order = await Order.findById(r.id, db);
      if (order) orders.push(order);
    }
    return orders;
  }

  static async findByStationAndStatus(station, status, customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const conditions = [];
    const params = [];

    const normalizedStation = station ? station.toString().trim().toUpperCase() : null;
    const normalizedStatus = status ? status.toString().trim().toUpperCase() : null;

    if (tenantId && tenantId !== 'ALL') {
      params.push(tenantId);
      conditions.push(`tenantId = $${params.length}`);
    }

    if (normalizedStation && normalizedStation !== 'ALL') {
      params.push(normalizedStation);
      conditions.push(`station = $${params.length}`);
    }

    if (!normalizedStatus || normalizedStatus === 'ACTIVE') {
      conditions.push(`status IN ('PENDING', 'IN_PREP', 'READY')`);
    } else {
      params.push(normalizedStatus);
      conditions.push(`status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await db.query(`SELECT id FROM orders ${whereClause} ORDER BY createdAt ASC`, params);
    const orders = [];
    for (const r of res.rows) {
      const order = await Order.findById(r.id, db);
      if (order) orders.push(order);
    }
    return orders;
  }

  static async updateStatus(id, newStatus, customDb) {
    const db = customDb || getDatabase();
    const normStatus = newStatus === 'IN_PREPARATION' ? 'IN_PREP' : newStatus;
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', [normStatus, id]);
    return await Order.findById(id, db);
  }
}

module.exports = Order;
