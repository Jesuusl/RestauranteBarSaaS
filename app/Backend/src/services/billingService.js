/**
 * Servicio de Facturación y División de Cuentas (Normativa Colombiana COP).
 *
 * En Colombia:
 * - El Impuesto Nacional al Consumo (Impoconsumo) para el expendio de comidas
 *   y bebidas en restaurantes y bares es del 8% sobre la base gravable (subtotal).
 * - En régimen de Impoconsumo, el IVA es 0%.
 * - La propina es voluntaria y sugerida del 10% calculada sobre el subtotal.
 * - Los valores en pesos colombianos se redondean a enteros sin centavos.
 */

/**
 * Calcula la factura en pesos colombianos (COP).
 *
 * @param {Array<{productId?: string, productName?: string, quantity: number, unitPriceCOP: number}>} items
 * @param {boolean} [includeTip=true] - Si el cliente acepta la propina voluntaria sugerida (10%)
 * @param {number} [customIvaRate=0.00] - Tasa de IVA opcional (por defecto 0% en régimen común de impoconsumo)
 * @returns {Object} Desglose completo de factura
 */
function calculateCOPInvoice(items, includeTip = true, customIvaRate = 0.00) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      subtotalCOP: 0,
      impoconsumoRate: 0.08,
      impoconsumoCOP: 0,
      ivaRate: customIvaRate,
      ivaCOP: 0,
      tipRate: includeTip ? 0.10 : 0.00,
      tipCOP: 0,
      totalCOP: 0,
      itemsCount: 0
    };
  }

  // 1. Base gravable (Subtotal neto)
  const subtotalCOP = items.reduce((accum, item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPriceCOP) || 0;
    if (qty < 0 || price < 0) {
      throw new Error(`Ítem con valores inválidos: ${JSON.stringify(item)}`);
    }
    return accum + Math.round(qty * price);
  }, 0);

  // 2. Impoconsumo 8% (Ley colombiana restaurantes/bares)
  const IMPOCONSUMO_RATE = 0.08;
  const impoconsumoCOP = Math.round(subtotalCOP * IMPOCONSUMO_RATE);

  // 3. IVA (Configurable, normalmente 0% para restaurantes con Impoconsumo)
  const ivaRate = customIvaRate;
  const ivaCOP = Math.round(subtotalCOP * ivaRate);

  // 4. Propina sugerida 10%
  const TIP_RATE = 0.10;
  const tipCOP = includeTip ? Math.round(subtotalCOP * TIP_RATE) : 0;

  // 5. Total a pagar en COP (redondeo comercial entero)
  const totalCOP = subtotalCOP + impoconsumoCOP + ivaCOP + tipCOP;

  const totalItemsCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  return {
    subtotalCOP,
    impoconsumoRate: IMPOCONSUMO_RATE,
    impoconsumoCOP,
    ivaRate,
    ivaCOP,
    tipRate: includeTip ? TIP_RATE : 0.00,
    tipCOP,
    totalCOP,
    itemsCount: totalItemsCount
  };
}

/**
 * Divide una cuenta en partes iguales con exactitud matemática de COP (sin pérdida de un solo peso).
 * Distribuye los pesos residuales de forma equitativa entre los primeros comensales.
 *
 * @param {number} totalCOP - Total a dividir
 * @param {number} parts - Número de comensales/partes
 * @returns {Array<{partNumber: number, amountCOP: number}>}
 */
function splitBillEqual(totalCOP, parts) {
  const total = Math.round(Number(totalCOP));
  const count = Math.floor(Number(parts));

  if (!Number.isFinite(total) || total < 0) {
    throw new Error('El total a dividir debe ser un número positivo.');
  }

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('El número de partes a dividir debe ser un entero mayor a 0.');
  }

  const basePart = Math.floor(total / count);
  const remainder = total % count;

  const splits = [];
  let sumCheck = 0;

  for (let i = 1; i <= count; i++) {
    // Si hay residuo, se distribuye 1 peso a los primeros 'remainder' comensales
    const amount = i <= remainder ? basePart + 1 : basePart;
    splits.push({
      partNumber: i,
      amountCOP: amount
    });
    sumCheck += amount;
  }

  // Verificación estricta de integridad
  if (sumCheck !== total) {
    throw new Error(`Inconsistencia matemática en división: total ${total} vs suma calculada ${sumCheck}`);
  }

  return splits;
}

/**
 * Valida y calcula la división de una comanda por ítems específicos entre subcuentas.
 * Verifica que todos los ítems asignados coincidan con la orden global sin excedentes ni faltantes.
 *
 * @param {Array<{subAccountId: string, dinerName?: string, items: Array}>} subAccounts
 * @param {Array<{productId: string, quantity: number, unitPriceCOP?: number}>} [masterOrderItems] - Ítems originales de la comanda para validación cruzada estricta
 * @param {boolean} [includeTip=true]
 * @returns {Object} Desglose por subcuenta y totales acumulados
 */
function splitBillByItems(subAccounts, masterOrderItems = null, includeTip = true) {
  if (!Array.isArray(subAccounts) || subAccounts.length === 0) {
    throw new Error('Se requiere al menos una subcuenta para la división por ítems.');
  }

  // Si se proveen los ítems maestros de la orden, validar que las cantidades coincidan exactamente
  if (masterOrderItems) {
    const masterQuantities = {};
    for (const item of masterOrderItems) {
      masterQuantities[item.productId] = (masterQuantities[item.productId] || 0) + Number(item.quantity);
    }

    const assignedQuantities = {};
    for (const sub of subAccounts) {
      for (const item of sub.items) {
        assignedQuantities[item.productId] = (assignedQuantities[item.productId] || 0) + Number(item.quantity);
      }
    }

    // Comprobar que no falten ni sobren ítems
    const allProductIds = new Set([...Object.keys(masterQuantities), ...Object.keys(assignedQuantities)]);
    for (const prodId of allProductIds) {
      const masterQty = masterQuantities[prodId] || 0;
      const assignedQty = assignedQuantities[prodId] || 0;
      if (masterQty !== assignedQty) {
        throw new Error(
          `Discrepancia en división por ítems para producto [${prodId}]: comanda requiere ${masterQty}, pero se asignaron ${assignedQty}.`
        );
      }
    }
  }

  const subAccountInvoices = subAccounts.map(sub => {
    const invoice = calculateCOPInvoice(sub.items, includeTip);
    return {
      subAccountId: sub.subAccountId,
      dinerName: sub.dinerName || `Comensal ${sub.subAccountId}`,
      items: sub.items,
      ...invoice
    };
  });

  const totalSubtotalCOP = subAccountInvoices.reduce((sum, inv) => sum + inv.subtotalCOP, 0);
  const totalImpoconsumoCOP = subAccountInvoices.reduce((sum, inv) => sum + inv.impoconsumoCOP, 0);
  const totalTipCOP = subAccountInvoices.reduce((sum, inv) => sum + inv.tipCOP, 0);
  const totalCOP = subAccountInvoices.reduce((sum, inv) => sum + inv.totalCOP, 0);

  return {
    subAccountInvoices,
    summary: {
      subtotalCOP: totalSubtotalCOP,
      impoconsumoCOP: totalImpoconsumoCOP,
      tipCOP: totalTipCOP,
      totalCOP: totalCOP
    }
  };
}

module.exports = {
  calculateCOPInvoice,
  splitBillEqual,
  splitBillByItems
};
