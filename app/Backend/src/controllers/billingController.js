const Invoice = require('../models/Invoice');
const Order = require('../models/Order');
const Session = require('../models/Session');
const { calculateCOPInvoice, splitBillEqual, splitBillByItems } = require('../services/billingService');

class BillingController {
  /**
   * Previsualiza o calcula la factura total de una sesión activa.
   */
  static async getSessionInvoicePreview(req, res) {
    try {
      const { sessionId } = req.params;
      const includeTip = req.query.includeTip !== 'false';

      const orders = await Order.findBySession(sessionId);
      const allItems = orders.flatMap(o => o.items);

      const invoiceCalc = calculateCOPInvoice(allItems, includeTip);

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
  static splitEqual(req, res) {
    try {
      const { totalCOP, parts } = req.body;
      const splits = splitBillEqual(totalCOP, parts);
      return res.json({
        totalCOP,
        parts,
        splits
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Divide la cuenta asignando ítems específicos a subcuentas.
   */
  static splitByItems(req, res) {
    try {
      const { subAccounts, masterOrderItems, includeTip } = req.body;
      const result = splitBillByItems(subAccounts, masterOrderItems, includeTip !== false);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Registra y emite la factura final con sus pagos en COP.
   */
  static async checkout(req, res) {
    try {
      const { sessionId, tableId, items, payments, includeTip, splitType } = req.body;
      const calc = calculateCOPInvoice(items, includeTip !== false);

      const invoice = await Invoice.create({
        id: `inv-${Date.now()}`,
        sessionId,
        tableId,
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
        payments: payments || []
      });

      // Cerrar sesión de mesa
      await Session.close(sessionId);

      return res.status(201).json(invoice);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = BillingController;
