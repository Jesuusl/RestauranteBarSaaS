const Invoice = require('../models/Invoice');
const Order = require('../models/Order');
const Session = require('../models/Session');
const Table = require('../models/Table');
const Product = require('../models/Product');
const { calculateCOPInvoice, splitBillEqual, splitBillByItems } = require('../services/billingService');
const { deductRecipeStock } = require('../services/inventoryService');
const { withTransaction, getDatabase } = require('../config/database');
const eventService = require('../services/eventService');
const { EVENT_TYPES } = eventService;

class BillingController {
  /**
   * Previsualiza o calcula la factura total de una sesión activa.
   */
  static async getSessionInvoicePreview(req, res) {
    try {
      const { sessionId } = req.params;
      const includeTip = req.query.includeTip !== 'false';
      const db = req.db || getDatabase();
      const taxConfig = req.tenant?.taxConfig || {};

      const orders = await Order.findBySession(sessionId, db);
      const allItems = orders.flatMap(o => o.items);

      const invoiceCalc = calculateCOPInvoice(allItems, includeTip, 0.00, taxConfig);

      return res.json({
        sessionId,
        ...invoiceCalc,
        items: allItems
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Divide la cuenta de manera equitativa entre N comensales.
   */
  static async splitEqual(req, res) {
    try {
      let { totalCOP, parts, sessionId, dinersCount, includeTip } = req.body;
      const db = req.db || getDatabase();
      const taxConfig = req.tenant?.taxConfig || {};

      if (totalCOP === undefined && sessionId) {
        const orders = await Order.findBySession(sessionId, db);
        const allItems = orders.flatMap(o => o.items);
        const invoiceCalc = calculateCOPInvoice(allItems, includeTip !== false, 0.00, taxConfig);
        totalCOP = invoiceCalc.totalCOP;
      }

      const resolvedParts = parts ?? dinersCount;
      const splits = splitBillEqual(totalCOP, resolvedParts);
      return res.json({
        totalCOP,
        parts: resolvedParts,
        splits,
        amountPerDinerCOP: splits[0]?.amountCOP || 0
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Divide la cuenta asignando ítems específicos a subcuentas.
   */
  static async splitByItems(req, res) {
    try {
      let { subAccounts, masterOrderItems, sessionId, dinersCount, assignments, includeTip } = req.body;
      const db = req.db || getDatabase();
      const taxConfig = req.tenant?.taxConfig || {};

      if (!subAccounts && sessionId && assignments) {
        const orders = await Order.findBySession(sessionId, db);
        const allItems = orders.flatMap(o => o.items);
        masterOrderItems = allItems;
        const dCount = Number(dinersCount) || 2;
        const grouped = {};
        for (let d = 1; d <= dCount; d++) grouped[d] = [];
        allItems.forEach((it, idx) => {
          const dNum = assignments[idx] || 1;
          if (!grouped[dNum]) grouped[dNum] = [];
          grouped[dNum].push({
            productId: it.productId,
            productName: it.productName,
            quantity: it.quantity,
            unitPriceCOP: it.unitPriceCOP
          });
        });
        subAccounts = Object.entries(grouped).map(([dNum, items]) => ({
          name: `Comensal ${dNum}`,
          items
        }));
      }

      const result = splitBillByItems(subAccounts, masterOrderItems, includeTip !== false, taxConfig);
      const subInvoices = (result.subAccountInvoices || []).map((s, i) => ({
        dinerNumber: i + 1,
        ...s,
        taxCOP: s.impoconsumoCOP
      }));
      return res.json({
        ...result,
        subInvoices
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }


  /**
   * Helper para normalizar pagos mixtos, calcular devuelta y validar montos recibidos.
   * @private
   */
  static _normalizePayments({ payments, paymentMethod, cashReceivedCOP, amountPaidCOP, customerNote, totalCOP }) {
    const VALID_PAYMENT_METHODS = ['CASH', 'CARD', 'NEQUI', 'DAVIPLATA', 'TRANSFER'];
    const resolvedCashReceived = cashReceivedCOP !== undefined
      ? Number(cashReceivedCOP)
      : (amountPaidCOP !== undefined ? Number(amountPaidCOP) : undefined);

    let rawPayments = [];
    if (Array.isArray(payments) && payments.length > 0) {
      rawPayments = payments.map(p => ({
        method: String(p.method || '').toUpperCase().trim(),
        amountCOP: Math.round(Number(p.amountCOP ?? 0)),
        reference: p.reference || customerNote || null
      }));
    } else {
      const method = String(paymentMethod || 'CASH').toUpperCase().trim();
      rawPayments = [{
        method,
        amountCOP: totalCOP,
        reference: customerNote || null
      }];
    }

    // Validar métodos y montos individuales
    for (const p of rawPayments) {
      if (!VALID_PAYMENT_METHODS.includes(p.method)) {
        const err = new Error(`Método de pago inválido: ${p.method}. Permitidos: ${VALID_PAYMENT_METHODS.join(', ')}`);
        err.statusCode = 400;
        throw err;
      }
      if (p.amountCOP < 0) {
        const err = new Error('El monto de pago no puede ser negativo.');
        err.statusCode = 400;
        throw err;
      }
    }

    const nonCashPayments = rawPayments.filter(p => p.method !== 'CASH');
    const cashPayments = rawPayments.filter(p => p.method === 'CASH');
    const nonCashSum = nonCashPayments.reduce((acc, p) => acc + p.amountCOP, 0);

    // Los pagos electrónicos no pueden superar el total adeudado
    if (nonCashSum > totalCOP) {
      const err = new Error('El monto pagado con métodos digitales/electrónicos no puede superar el total de la cuenta.');
      err.statusCode = 400;
      throw err;
    }

    const netCashRequired = Math.max(0, totalCOP - nonCashSum);

    // Determinar efectivo entregado (cashTendered)
    let cashTendered = 0;
    if (resolvedCashReceived !== undefined) {
      cashTendered = resolvedCashReceived;
    } else if (cashPayments.length > 0) {
      cashTendered = cashPayments.reduce((acc, p) => acc + p.amountCOP, 0);
    } else if (netCashRequired === 0) {
      cashTendered = 0;
    }

    const totalTendered = nonCashSum + cashTendered;
    if (totalTendered < totalCOP) {
      const err = new Error(`El monto total recibido ($${totalTendered.toLocaleString('es-CO')}) es insuficiente para cubrir la cuenta ($${totalCOP.toLocaleString('es-CO')}).`);
      err.statusCode = 400;
      throw err;
    }

    const changeCOP = cashTendered > 0 ? Math.max(0, cashTendered - netCashRequired) : 0;

    const normalizedPayments = [...nonCashPayments];
    if (netCashRequired > 0) {
      const cashRef = cashPayments[0]?.reference || customerNote || null;
      normalizedPayments.push({
        method: 'CASH',
        amountCOP: netCashRequired,
        reference: cashRef
      });
    }

    return {
      normalizedPayments,
      changeCOP,
      cashReceivedCOP: cashTendered
    };
  }

  /**
   * Registra y emite la factura final de una mesa con sus pagos en COP bajo transacción ACID.
   */
  static async checkout(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';
      const { sessionId, tableId, includeTip, splitType, customerNote, paymentMethod, cashReceivedCOP, amountPaidCOP } = req.body;
      let { items, payments } = req.body;
      const taxConfig = req.tenant?.taxConfig || {};

      // Si items no viene o viene vacío y existe sessionId, recuperar órdenes de la sesión
      if ((!items || items.length === 0) && sessionId) {
        const orders = await Order.findBySession(sessionId, db);
        items = orders.flatMap(o => o.items);
      }

      // Resolver tableId si no viene
      let resolvedTableId = tableId || null;
      if (!resolvedTableId && sessionId) {
        const sess = await Session.findById(sessionId, db);
        resolvedTableId = sess?.tableId || null;
      }

      const calc = calculateCOPInvoice(items || [], includeTip !== false, 0.00, taxConfig);

      const paymentResult = BillingController._normalizePayments({
        payments,
        paymentMethod,
        cashReceivedCOP,
        amountPaidCOP,
        customerNote,
        totalCOP: calc.totalCOP
      });

      const isInventoryActive = !req.tenant || !req.tenant.enabledModules || req.tenant.enabledModules.inventory !== false;

      const invoice = await withTransaction(db, async (txDb) => {
        // Si no proviene de órdenes de sesión previa, descontar stock simple si aplica
        if (!sessionId && items && items.length > 0 && isInventoryActive) {
          for (const it of items) {
            if (it.productId) {
              const prod = await Product.findById(it.productId, txDb);
              if (prod && prod.trackStock) {
                await Product.deductStock(it.productId, Number(it.quantity) || 1, txDb);
              }
            }
          }
        }

        const createdInvoice = await Invoice.create({
          id: `inv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          tenantId,
          sessionId: sessionId || null,
          tableId: resolvedTableId,
          saleType: 'TABLE',
          customerNote: customerNote || null,
          cashierName: req.user?.name || req.body.cashierName || 'Cajero',
          subtotalCOP: calc.subtotalCOP,
          impoconsumoRate: calc.impoconsumoRate,
          impoconsumoCOP: calc.impoconsumoCOP,
          ivaRate: calc.ivaRate,
          ivaCOP: calc.ivaCOP,
          tipRate: calc.tipRate,
          tipCOP: calc.tipCOP,
          totalCOP: calc.totalCOP,
          splitType: splitType || 'SINGLE',
          status: 'PAID',
          payments: paymentResult.normalizedPayments,
          items: items || []
        }, txDb);

        // Cerrar sesión de mesa y despachar comandas activas
        if (sessionId) {
          await Session.close(sessionId, txDb);
          const sessionOrders = await Order.findBySession(sessionId, txDb);
          for (const ord of sessionOrders) {
            if (ord.status !== 'CANCELLED' && ord.status !== 'SERVED') {
              await Order.updateStatus(ord.id, 'SERVED', txDb);
            }
          }
        }

        // Liberar mesa en BD si existe resolvedTableId
        if (resolvedTableId) {
          await Table.updateStatus(resolvedTableId, 'AVAILABLE', null, txDb);
        }

        return createdInvoice;
      });

      eventService.broadcast(EVENT_TYPES.SALE_COMPLETED, invoice);

      return res.status(201).json({
        ...invoice,
        invoice,
        changeCOP: paymentResult.changeCOP,
        cashReceivedCOP: paymentResult.cashReceivedCOP
      });
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message });
    }
  }

  /**
   * Cobro Rápido de Mostrador (Express Checkout).
   * Venta directa al paso: soporta pagos únicos o mixtos, descuenta inventario simple y recetas,
   * y calcula devuelta exacta en COP sin inflar las filas de pagos.
   */
  static async expressCheckout(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';
      const { items, paymentMethod, payments, cashReceivedCOP, amountPaidCOP, customerNote, includeTip } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'La venta de mostrador requiere al menos un ítem.' });
      }

      // Enriquecer y validar items desde catálogo si existen
      const enrichedItems = [];
      for (const item of items) {
        const qty = Number(item.quantity) || 1;
        let unitPrice = item.unitPriceCOP !== undefined
          ? item.unitPriceCOP
          : (item.unitpricecop !== undefined ? item.unitpricecop : undefined);
        let productName = item.productName || item.name;
        let category = item.category || 'General';

        if (item.productId) {
          const product = await Product.findById(item.productId, db);
          if (product) {
            productName = productName || product.name;
            category = category !== 'General' ? category : product.category;
            if (unitPrice === undefined || unitPrice === null) {
              unitPrice = product.salePriceCOP;
            }
          }
        }

        unitPrice = Number(unitPrice ?? 0);

        if (qty <= 0 || unitPrice < 0) {
          return res.status(400).json({ error: `Valores inválidos en el ítem: ${JSON.stringify(item)}` });
        }

        enrichedItems.push({
          productId: item.productId || null,
          productName: productName || 'Producto Mostrador',
          category,
          quantity: qty,
          unitPriceCOP: unitPrice,
          subtotalCOP: Math.round(qty * unitPrice)
        });
      }

      const taxConfig = req.tenant?.taxConfig || {};
      const calc = calculateCOPInvoice(enrichedItems, Boolean(includeTip), 0.00, taxConfig);

      const paymentResult = BillingController._normalizePayments({
        payments,
        paymentMethod,
        cashReceivedCOP,
        amountPaidCOP,
        customerNote,
        totalCOP: calc.totalCOP
      });

      const isInventoryActive = !req.tenant || !req.tenant.enabledModules || req.tenant.enabledModules.inventory !== false;

      const { invoice, lowStockAlerts } = await withTransaction(db, async (txDb) => {
        const alerts = [];

        // 1. Control de stock simple (Módulo 9) si está activo
        if (isInventoryActive) {
          for (const it of enrichedItems) {
            if (it.productId) {
              const prod = await Product.findById(it.productId, txDb);
              if (prod && prod.trackStock) {
                const updated = await Product.deductStock(it.productId, it.quantity, txDb);
                if (updated.stockUnits <= updated.minStockUnits) {
                  alerts.push({
                    productId: updated.id,
                    productName: updated.name,
                    stockUnits: updated.stockUnits,
                    minStockUnits: updated.minStockUnits,
                    message: `Alerta: Stock bajo para "${updated.name}" (${updated.stockUnits} unidades restantes)`
                  });
                }
              }
            }
          }
        }

        // 2. Control de escandallo por receta si los productos tienen receta asociada
        const itemsWithRecipe = [];
        for (const it of enrichedItems) {
          if (it.productId) {
            const prod = await Product.findById(it.productId, txDb);
            if (prod && prod.recipe && prod.recipe.length > 0) {
              itemsWithRecipe.push(it);
            }
          }
        }

        if (itemsWithRecipe.length > 0) {
          const stockResult = await deductRecipeStock(itemsWithRecipe, txDb);
          if (stockResult?.lowStockAlerts) {
            alerts.push(...stockResult.lowStockAlerts);
          }
        }

        const invoiceId = `inv-exp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const created = await Invoice.create({
          id: invoiceId,
          tenantId,
          sessionId: null,
          tableId: null,
          saleType: 'EXPRESS',
          customerNote: customerNote || null,
          cashierName: req.user?.name || req.body.cashierName || 'Cajero Mostrador',
          subtotalCOP: calc.subtotalCOP,
          impoconsumoRate: calc.impoconsumoRate,
          impoconsumoCOP: calc.impoconsumoCOP,
          ivaRate: calc.ivaRate,
          ivaCOP: calc.ivaCOP,
          tipRate: calc.tipRate,
          tipCOP: calc.tipCOP,
          totalCOP: calc.totalCOP,
          splitType: 'SINGLE',
          status: 'PAID',
          items: enrichedItems,
          payments: paymentResult.normalizedPayments
        }, txDb);

        return { invoice: created, lowStockAlerts: alerts };
      });

      // Emisión de eventos en tiempo real SSE
      eventService.broadcast(EVENT_TYPES.SALE_COMPLETED, invoice);
      for (const alert of lowStockAlerts) {
        eventService.broadcast(EVENT_TYPES.STOCK_ALERT, alert);
      }

      return res.status(201).json({
        success: true,
        invoice,
        changeCOP: paymentResult.changeCOP,
        cashReceivedCOP: paymentResult.cashReceivedCOP,
        lowStockAlerts
      });
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        error: status === 400 ? err.message : 'Error en cobro rápido de mostrador: ' + err.message
      });
    }
  }
}

module.exports = BillingController;
