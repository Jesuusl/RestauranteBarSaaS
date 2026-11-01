const { getDatabase, withTransaction } = require('../config/database');
const Tenant = require('../models/Tenant');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const eventService = require('../services/eventService');
const { EVENT_TYPES } = eventService;

class SalesController {
  /**
   * Resumen analítico integral de ventas, productos más vendidos y desglose por medio de pago.
   */
  static async getSummary(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || 'tenant-default';
      const { from, to } = req.query;

      const salesData = await SalesController._fetchSalesData(db, tenantId, from, to);
      return res.json(salesData.summary);
    } catch (err) {
      return res.status(500).json({ error: 'Error al obtener resumen de ventas: ' + err.message });
    }
  }

  /**
   * Anula una factura de venta, restaurando existencias de inventario simple si aplica.
   * Excluye la venta de los ingresos pagados y cierres ciegos posteriores.
   */
  static async cancelSale(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || 'tenant-default';
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
        return res.status(400).json({ error: 'El motivo de anulación es obligatorio y debe tener al menos 3 caracteres.' });
      }

      const inv = await Invoice.findById(id, db);
      if (!inv || inv.tenantId !== tenantId) {
        return res.status(404).json({ error: 'Factura no encontrada.' });
      }

      if (inv.status === 'CANCELLED') {
        return res.status(409).json({ error: 'La factura ya se encuentra anulada.' });
      }

      const isInventoryActive = !req.tenant || !req.tenant.enabledModules || req.tenant.enabledModules.inventory !== false;

      const cancelledInvoice = await withTransaction(db, async (txDb) => {
        const cancelledBy = req.user?.name || req.body.cancelledBy || 'Administrador';
        const updated = await Invoice.cancel(id, { reason: reason.trim(), cancelledBy }, txDb);

        // Restaurar inventario si el módulo está activo
        if (isInventoryActive && updated.items && updated.items.length > 0) {
          for (const it of updated.items) {
            if (it.productId) {
              const prod = await Product.findById(it.productId, txDb);
              if (prod && prod.trackStock) {
                await Product.restoreStock(it.productId, Number(it.quantity) || 1, txDb);
              }
            }
          }
        }

        return updated;
      });

      eventService.broadcast(EVENT_TYPES.SALE_CANCELLED, {
        invoiceId: id,
        tenantId,
        reason: reason.trim(),
        cancelledBy: cancelledInvoice.cancelledBy
      });

      return res.json({
        success: true,
        message: 'Factura anulada exitosamente.',
        invoice: cancelledInvoice
      });
    } catch (err) {
      return res.status(500).json({ error: 'Error al anular la factura: ' + err.message });
    }
  }

  /**
   * Exportación de ventas a archivo CSV con cabecera BOM UTF-8 y zona horaria Colombia.
   */
  static async exportCsv(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || 'tenant-default';
      const { from, to } = req.query;

      const tenant = req.tenant || (await Tenant.findById(tenantId, db));
      const tenantSlug = tenant?.slug || tenantId;

      const salesData = await SalesController._fetchSalesData(db, tenantId, from, to);
      const csvContent = SalesController._generateCsv(salesData.sales);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ventas_${tenantSlug}.csv"`);

      // Enviar BOM UTF-8 (\uFEFF) para compatibilidad con Excel en español
      return res.send('\uFEFF' + csvContent);
    } catch (err) {
      return res.status(500).json({ error: 'Error al exportar CSV de ventas: ' + err.message });
    }
  }

  /**
   * Consulta centralizada de facturas e ítems asociados para el tenant y rango de fechas.
   * Los KPIs (ingresos, ranking, productos vendidos) se calculan EXCLUSIVAMENTE sobre facturas PAID.
   * @private
   */
  static async _fetchSalesData(db, tenantId, from, to) {
    const conditions = ["tenantId = $1", "status IN ('PAID', 'CANCELLED')"];
    const params = [tenantId];

    if (from) {
      const fromIso = from.includes('T') ? from : `${from}T00:00:00.000-05:00`;
      params.push(fromIso);
      conditions.push(`createdAt >= $${params.length}`);
    }

    if (to) {
      const toIso = to.includes('T') ? to : `${to}T23:59:59.999-05:00`;
      params.push(toIso);
      conditions.push(`createdAt <= $${params.length}`);
    }

    const sql = `SELECT * FROM invoices WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC`;
    const invRes = await db.query(sql, params);

    const sales = [];
    const productAggregates = new Map();
    const paymentBreakdown = {
      CASH: 0,
      CARD: 0,
      NEQUI: 0,
      DAVIPLATA: 0,
      TRANSFER: 0
    };

    let totalProductsSold = 0;
    let totalRevenueCOP = 0;
    let paidSalesCount = 0;
    let cancelledCount = 0;
    let cancelledTotalCOP = 0;

    for (const rawInv of invRes.rows) {
      const invId = rawInv.id;
      const isPaid = (rawInv.status === 'PAID');
      const invTotalCOP = Number(rawInv.totalCOP ?? rawInv.totalcop ?? 0);

      // 1. Obtener pagos
      const payRes = await db.query('SELECT * FROM invoice_payments WHERE invoiceId = $1', [invId]);
      const payments = payRes.rows.map(p => ({
        id: p.id,
        method: p.method,
        amountCOP: Number(p.amountCOP ?? p.amountcop ?? 0),
        reference: p.reference || null,
        createdAt: p.createdAt || p.createdat
      }));

      // 2. Obtener items desde invoice_items
      let items = [];
      const itemRes = await db.query('SELECT * FROM invoice_items WHERE invoiceId = $1', [invId]);

      if (itemRes.rows.length > 0) {
        items = itemRes.rows.map(r => ({
          productId: r.productId || r.productid || null,
          productName: r.productName || r.productname,
          category: r.category || 'General',
          quantity: Number(r.quantity),
          unitPriceCOP: Number(r.unitPriceCOP ?? r.unitpricecop ?? 0),
          subtotalCOP: Number(r.subtotalCOP ?? r.subtotalcop ?? 0)
        }));
      } else if (rawInv.sessionId || rawInv.sessionid) {
        // Fallback a order_items si la factura histórica no tenía invoice_items
        const sessId = rawInv.sessionId || rawInv.sessionid;
        const fallbackRes = await db.query(`
          SELECT oi.productId as "productId", oi.productName as "productName", oi.quantity,
                 oi.unitPriceCOP as "unitPriceCOP", p.category
          FROM order_items oi
          JOIN orders o ON oi.orderId = o.id
          LEFT JOIN products p ON oi.productId = p.id
          WHERE o.sessionId = $1
        `, [sessId]);

        items = fallbackRes.rows.map(r => ({
          productId: r.productId,
          productName: r.productName,
          category: r.category || 'General',
          quantity: Number(r.quantity),
          unitPriceCOP: Number(r.unitPriceCOP ?? 0),
          subtotalCOP: Math.round(Number(r.quantity) * Number(r.unitPriceCOP ?? 0))
        }));
      }

      let invoiceItemsCount = 0;

      if (isPaid) {
        paidSalesCount++;
        totalRevenueCOP += invTotalCOP;

        // Acumular desglose de medios de pago solo para facturas válidas (PAID)
        for (const p of payments) {
          if (paymentBreakdown[p.method] !== undefined) {
            paymentBreakdown[p.method] += p.amountCOP;
          } else {
            paymentBreakdown[p.method] = (paymentBreakdown[p.method] || 0) + p.amountCOP;
          }
        }

        // Acumular cantidades e ítems para métricas y ranking
        for (const it of items) {
          const qty = Number(it.quantity) || 0;
          const subtotal = Number(it.subtotalCOP) || 0;
          invoiceItemsCount += qty;
          totalProductsSold += qty;

          const prodKey = it.productId || it.productName;
          if (!productAggregates.has(prodKey)) {
            productAggregates.set(prodKey, {
              productId: it.productId,
              productName: it.productName,
              category: it.category || 'General',
              quantitySold: 0,
              revenueCOP: 0
            });
          }
          const agg = productAggregates.get(prodKey);
          agg.quantitySold += qty;
          agg.revenueCOP += subtotal;
        }
      } else {
        cancelledCount++;
        cancelledTotalCOP += invTotalCOP;
        invoiceItemsCount = items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
      }

      sales.push({
        id: rawInv.id,
        createdAt: rawInv.createdAt || rawInv.createdat,
        status: rawInv.status,
        cancelReason: rawInv.cancelReason || rawInv.cancelreason || null,
        cancelledAt: rawInv.cancelledAt || rawInv.cancelledat || null,
        cancelledBy: rawInv.cancelledBy || rawInv.cancelledby || null,
        saleType: rawInv.saleType || rawInv.saletype || 'TABLE',
        tableId: rawInv.tableId || rawInv.tableid || null,
        cashierName: rawInv.cashierName || rawInv.cashiername || null,
        customerNote: rawInv.customerNote || rawInv.customernote || null,
        subtotalCOP: Number(rawInv.subtotalCOP ?? rawInv.subtotalcop ?? 0),
        impoconsumoCOP: Number(rawInv.impoconsumoCOP ?? rawInv.impoconsumocop ?? 0),
        tipCOP: Number(rawInv.tipCOP ?? rawInv.tipcop ?? 0),
        totalCOP: invTotalCOP,
        itemsCount: invoiceItemsCount,
        paymentMethod: payments.length > 1 ? 'MIXED' : (payments[0]?.method || 'CASH'),
        payments,
        items
      });
    }

    const totalSalesCount = paidSalesCount;
    const averageTicketCOP = totalSalesCount > 0 ? Math.round(totalRevenueCOP / totalSalesCount) : 0;

    // Generar ranking de productos exclusivamente de ventas pagadas
    const productRankingList = Array.from(productAggregates.values())
      .sort((a, b) => b.quantitySold - a.quantitySold || b.revenueCOP - a.revenueCOP);

    const productRanking = productRankingList.map((p, idx) => ({
      rank: idx + 1,
      productId: p.productId,
      productName: p.productName,
      category: p.category,
      quantitySold: p.quantitySold,
      revenueCOP: p.revenueCOP,
      sharePercent: totalProductsSold > 0 ? Number(((p.quantitySold / totalProductsSold) * 100).toFixed(1)) : 0
    }));

    const topProduct = productRanking.length > 0 ? productRanking[0] : null;

    return {
      sales,
      summary: {
        totalProductsSold,
        totalSalesCount,
        totalRevenueCOP,
        averageTicketCOP,
        cancelledCount,
        cancelledTotalCOP,
        topProduct,
        productRanking,
        paymentBreakdown,
        sales
      }
    };
  }

  /**
   * Genera el contenido de texto CSV escapando comillas y delimitando por comas.
   * Incluye las nuevas columnas Estado y Motivo_Anulacion al final para compatibilidad.
   * @private
   */
  static _generateCsv(sales) {
    const headers = [
      'ID_Venta',
      'Fecha',
      'Hora',
      'Modalidad',
      'Productos',
      'Cantidad_Productos',
      'Metodo_Pago',
      'Cajero',
      'Subtotal_COP',
      'Impoconsumo_COP',
      'Propina_COP',
      'Valor_Total_COP',
      'Estado',
      'Motivo_Anulacion'
    ];

    const lines = [headers.join(',')];

    for (const s of sales) {
      const dateObj = new Date(s.createdAt);

      let fechaStr = '';
      let horaStr = '';
      try {
        fechaStr = dateObj.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        horaStr = dateObj.toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour12: false });
      } catch (_) {
        fechaStr = dateObj.toISOString().split('T')[0];
        horaStr = dateObj.toISOString().split('T')[1].substring(0, 8);
      }

      // Detalle de productos compacto (ej. "2x Café Latte; 1x Empanada")
      const productsSummary = (s.items || []).map(it => `${it.quantity}x ${it.productName}`).join('; ');
      const escapedProducts = `"${productsSummary.replace(/"/g, '""')}"`;
      const escapedCashier = `"${(s.cashierName || 'Caja Principal').replace(/"/g, '""')}"`;
      const escapedReason = `"${(s.cancelReason || '').replace(/"/g, '""')}"`;

      const row = [
        s.id,
        fechaStr,
        horaStr,
        s.saleType,
        escapedProducts,
        s.itemsCount,
        s.paymentMethod,
        escapedCashier,
        s.subtotalCOP,
        s.impoconsumoCOP,
        s.tipCOP,
        s.totalCOP,
        s.status || 'PAID',
        escapedReason
      ];

      lines.push(row.join(','));
    }

    return lines.join('\n');
  }
}

module.exports = SalesController;

