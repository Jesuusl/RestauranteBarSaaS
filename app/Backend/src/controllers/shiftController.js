const ShiftAudit = require('../models/ShiftAudit');
const { getDatabase } = require('../config/database');

class ShiftController {
  static async openShift(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';
      const { shiftNumber, notes } = req.body;

      const rawInitial = req.body.initialCashCOP ?? req.body.cashInitialCOP;
      const initialCashCOP = rawInitial !== undefined ? Number(rawInitial) : 0;
      if (isNaN(initialCashCOP) || initialCashCOP < 0) {
        return res.status(400).json({ error: 'La base inicial en efectivo debe ser un número mayor o igual a 0.' });
      }

      const cashierId = req.body.cashierId || req.user?.id || 'usr-cajero';
      const cashierName = req.body.cashierName || req.user?.name || 'Cajero Principal';

      const shift = await ShiftAudit.openShift({
        tenantId,
        shiftNumber: shiftNumber || 1,
        cashierId,
        cashierName,
        initialCashCOP,
        notes
      }, db);
      return res.status(201).json(shift);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async getActiveShift(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.query.tenantId || 'tenant-default';

      const shift = await ShiftAudit.findActive(db, tenantId);
      if (!shift) {
        return res.status(404).json({ message: 'No hay turno abierto actualmente.' });
      }
      return res.json(shift);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async blindClose(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenantId = req.tenantId || req.tenant?.id || req.body.tenantId || 'tenant-default';
      let { id } = req.params;

      const declaredCash = req.body.declaredCashCOP ?? req.body.cashDeclaredCOP ?? 0;
      const declaredCard = req.body.declaredCardCOP ?? req.body.cardDeclaredCOP ?? 0;
      const declaredTransfers = req.body.declaredTransfersCOP ?? req.body.transferDeclaredCOP ?? 0;
      const notes = req.body.notes || '';

      if (id === 'active') {
        const activeShift = await ShiftAudit.findActive(db, tenantId);
        if (!activeShift) {
          return res.status(400).json({ error: 'Debes abrir un turno de caja antes de ejecutar el cierre ciego' });
        }
        id = activeShift.id;
      }

      const closedShift = await ShiftAudit.performBlindClose(id, {
        declaredCashCOP: declaredCash,
        declaredCardCOP: declaredCard,
        declaredTransfersCOP: declaredTransfers
      }, notes, db);

      return res.json(closedShift);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
}

module.exports = ShiftController;
