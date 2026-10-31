const { getDatabase } = require('../config/database');
const Product = require('../models/Product');
const Ingredient = require('../models/Ingredient');
const Waste = require('../models/Waste');

/**
 * Servicio de Inventario, Escandallo y Mermas.
 */

/**
 * Deduce el stock de insumos según el escandallo/receta de los ítems de una comanda.
 * Valida disponibilidad y genera alertas tempranas si el stock entra en el umbral mínimo.
 *
 * @param {Array<{productId: string, quantity: number, productName?: string}>} orderItems
 * @param {Object} [customDb]
 * @returns {Promise<Object>} Resumen de deducciones y alertas de stock bajo
 */
async function deductRecipeStock(orderItems, customDb) {
  const db = customDb || getDatabase();
  const deductions = [];
  const lowStockAlerts = [];

  // 1. Agrupar la demanda total por ingrediente
  const requiredIngredients = new Map();

  for (const item of orderItems) {
    const product = await Product.findById(item.productId, db);
    if (!product) {
      throw new Error(`Producto no encontrado en inventario: ${item.productId}`);
    }

    if (!product.recipe || product.recipe.length === 0) {
      continue;
    }

    const orderQty = Number(item.quantity) || 1;

    for (const recipeItem of product.recipe) {
      const ingId = recipeItem.ingredientId;
      const amountNeeded = recipeItem.quantity * orderQty;

      if (!requiredIngredients.has(ingId)) {
        requiredIngredients.set(ingId, {
          ingredientId: ingId,
          ingredientName: recipeItem.ingredientName,
          unit: recipeItem.unit,
          costPerUnitCOP: recipeItem.costPerUnitCOP,
          totalQuantity: 0
        });
      }

      requiredIngredients.get(ingId).totalQuantity += amountNeeded;
    }
  }

  // 2. Realizar la deducción de cada ingrediente
  for (const [ingId, req] of requiredIngredients.entries()) {
    const ingredient = await Ingredient.findById(ingId, db);
    if (!ingredient) {
      throw new Error(`Insumo no encontrado para deducción: ${ingId}`);
    }

    const previousStock = ingredient.currentStock;
    const result = await Ingredient.deductStock(ingId, req.totalQuantity, db);

    deductions.push({
      ingredientId: ingId,
      ingredientName: ingredient.name,
      unit: ingredient.unit,
      deducted: req.totalQuantity,
      previousStock: previousStock,
      newStock: result.currentStock,
      minStock: ingredient.minStock
    });

    if (result.isLowStock) {
      lowStockAlerts.push({
        ingredientId: ingId,
        ingredientName: ingredient.name,
        currentStock: result.currentStock,
        minStock: ingredient.minStock,
        unit: ingredient.unit,
        message: `⚠️ ALERTA DE STOCK: "${ingredient.name}" ha alcanzado nivel crítico (${result.currentStock} ${ingredient.unit} restantes / Mínimo: ${ingredient.minStock} ${ingredient.unit})`
      });
    }
  }

  return {
    success: true,
    deductions,
    lowStockAlerts
  };
}

/**
 * Registra una merma, rotura, cortesía o comida de personal.
 * Descuenta el stock y calcula el costo contable absorbido en COP.
 *
 * @param {Object} wasteData
 * @param {string} [wasteData.productId]
 * @param {string} [wasteData.ingredientId]
 * @param {number} wasteData.quantity
 * @param {string} wasteData.unit - ML, GR, UNIT
 * @param {string} wasteData.type - WASTE | COURTESY | STAFF_MEAL
 * @param {string} wasteData.reason
 * @param {string} wasteData.authorizedBy
 * @param {Object} [customDb]
 * @returns {Promise<Waste>}
 */
async function registerWaste(wasteData, customDb) {
  const db = customDb || getDatabase();
  const id = wasteData.id || `waste-${Date.now()}`;
  let totalCostCOP = 0;

  if (wasteData.ingredientId) {
    const ingredient = await Ingredient.findById(wasteData.ingredientId, db);
    if (!ingredient) {
      throw new Error(`Insumo no encontrado: ${wasteData.ingredientId}`);
    }
    totalCostCOP = Math.round(wasteData.quantity * ingredient.costPerUnitCOP);
    await Ingredient.deductStock(wasteData.ingredientId, wasteData.quantity, db);
  } else if (wasteData.productId) {
    const product = await Product.findById(wasteData.productId, db);
    if (!product) {
      throw new Error(`Producto no encontrado: ${wasteData.productId}`);
    }

    // Descontar insumos por receta y sumar costo
    for (const rec of product.recipe) {
      const ingNeeded = rec.quantity * wasteData.quantity;
      totalCostCOP += Math.round(ingNeeded * (rec.costPerUnitCOP || 0));
      await Ingredient.deductStock(rec.ingredientId, ingNeeded, db);
    }
  } else {
    throw new Error('Debe especificar productId o ingredientId para registrar la merma.');
  }

  const waste = await Waste.create({
    id,
    productId: wasteData.productId || null,
    ingredientId: wasteData.ingredientId || null,
    quantity: wasteData.quantity,
    unit: wasteData.unit,
    type: wasteData.type,
    reason: wasteData.reason,
    authorizedBy: wasteData.authorizedBy,
    totalCostCOP
  }, db);

  return waste;
}

module.exports = {
  deductRecipeStock,
  registerWaste
};
