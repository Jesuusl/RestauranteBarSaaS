const ShiftAudit = require('../models/ShiftAudit');

class ShiftController {
  static async openShift(req, res) {
    try {
      const { shiftNumber, cashierId, cashierName, notes } = req.body;
      const shift = await ShiftAudit.openShift({
        shiftNumber: shiftNumber || 1,
        cashierId,
        cashierName,
        notes
      });
      return res.status(201).json(shift);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  static async getActiveShift(req, res) {
    try {
      const shift = await ShiftAudit.findActive();
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
      const { id } = req.params;
      const { declaredCashCOP, declaredCardCOP, declaredTransfersCOP, notes } = req.body;

      const closedShift = await ShiftAudit.performBlindClose(id, {
        declaredCashCOP,
        declaredCardCOP,
        declaredTransfersCOP
      }, notes);

      return res.json(closedShift);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
}

module.exports = ShiftController;
