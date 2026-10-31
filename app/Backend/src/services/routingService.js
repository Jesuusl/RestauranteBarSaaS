const Product = require('../models/Product');
const { getDatabase } = require('../config/database');

/**
 * Servicio de Enrutamiento de Comandas hacia Estaciones de Preparación (Cocina / Bar).
 */

/**
 * Separa y enruta automáticamente los ítems de una orden hacia las estaciones 'KITCHEN' o 'BAR'.
 *
 * @param {Array<{productId: string, productName?: string, quantity: number, seatNumber?: number, modifiers?: Array, notes?: string, unitPriceCOP?: number, station?: string}>} items
 * @param {Object} [customDb]
 * @returns {Promise<{ kitchen: Array, bar: Array }>}
 */
async function routeOrderItems(items, customDb) {
  if (!Array.isArray(items)) {
    return { kitchen: [], bar: [] };
  }

  const db = customDb || getDatabase();
  const kitchen = [];
  const bar = [];

  for (const item of items) {
    let station = item.station;
    let productName = item.productName;
    let unitPriceCOP = item.unitPriceCOP;

    // Si el ítem no trae estación, nombre o precio, consultar el catálogo de productos
    if (item.productId && (!station || !productName || unitPriceCOP === undefined)) {
      const product = await Product.findById(item.productId, db);
      if (product) {
        station = station || product.station;
        productName = productName || product.name;
        if (unitPriceCOP === undefined) unitPriceCOP = product.salePriceCOP;
      }
    }

    // Normalizar a mayúsculas
    station = (station || 'KITCHEN').toUpperCase();

    const normalizedItem = {
      ...item,
      productName: productName || item.productId,
      unitPriceCOP: Number(unitPriceCOP ?? 0),
      station
    };

    if (station === 'BAR') {
      bar.push(normalizedItem);
    } else {
      kitchen.push(normalizedItem);
    }
  }

  return {
    kitchen,
    bar
  };
}

module.exports = {
  routeOrderItems
};
