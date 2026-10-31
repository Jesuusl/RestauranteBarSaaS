const { getDatabase, initSchema } = require('../config/database');
const Table = require('../models/Table');
const Ingredient = require('../models/Ingredient');
const Product = require('../models/Product');

/**
 * Función para sembrar los datos iniciales de restaurantes-bar.
 * Puede ejecutarse sobre la base de datos por defecto o sobre una base de datos en memoria para testing.
 * Es totalmente idempotente con ON CONFLICT DO UPDATE.
 *
 * @param {Object} [customDb]
 * @param {Object} [options] - Opciones (ej. silent)
 */
async function seedDatabase(customDb, options = {}) {
  const db = customDb || getDatabase();
  const silent = Boolean(options.silent);
  const log = (...args) => { if (!silent) console.log(...args); };

  // Asegurar que las tablas existan
  await initSchema(db);

  // Limpiar datos existentes respetando foreign keys si se requiere o asegurar idempotencia
  await db.query(`
    DELETE FROM invoice_payments;
    DELETE FROM invoices;
    DELETE FROM order_items;
    DELETE FROM orders;
    DELETE FROM product_recipes;
    DELETE FROM products;
    DELETE FROM ingredients;
    DELETE FROM sessions;
    DELETE FROM tables;
    DELETE FROM shift_audits;
    DELETE FROM wastes;
  `);

  log('🌱 Sembrando Zonas y Mesas...');
  const tables = [
    // Salón Principal
    { id: 'tab-1', number: 1, zone: 'Salón Principal', capacity: 4, posX: 100, posY: 100, status: 'AVAILABLE' },
    { id: 'tab-2', number: 2, zone: 'Salón Principal', capacity: 2, posX: 250, posY: 100, status: 'OCCUPIED' },
    { id: 'tab-3', number: 3, zone: 'Salón Principal', capacity: 6, posX: 400, posY: 100, status: 'RESERVED' },
    // Terraza
    { id: 'tab-4', number: 4, zone: 'Terraza', capacity: 4, posX: 100, posY: 250, status: 'AVAILABLE' },
    { id: 'tab-5', number: 5, zone: 'Terraza', capacity: 4, posX: 250, posY: 250, status: 'PAYING' },
    { id: 'tab-6', number: 6, zone: 'Terraza', capacity: 2, posX: 400, posY: 250, status: 'CLEANING' },
    // Barra VIP
    { id: 'tab-7', number: 7, zone: 'Barra VIP', capacity: 2, posX: 100, posY: 400, status: 'AVAILABLE' },
    { id: 'tab-8', number: 8, zone: 'Barra VIP', capacity: 2, posX: 250, posY: 400, status: 'OCCUPIED' }
  ];

  for (const t of tables) {
    await Table.create(t, db);
  }

  log('🌱 Sembrando Insumos de Bar y Cocina...');
  const ingredients = [
    // Bar
    { id: 'ing-ron-medellin', name: 'Ron Medellín Añejo (ml)', unit: 'ML', currentStock: 3000, minStock: 750, costPerUnitCOP: 60 },
    { id: 'ing-aguardiente', name: 'Aguardiente Antioqueño (ml)', unit: 'ML', currentStock: 3750, minStock: 750, costPerUnitCOP: 50 },
    { id: 'ing-tanqueray', name: 'Ginebra Tanqueray London Dry (ml)', unit: 'ML', currentStock: 2250, minStock: 750, costPerUnitCOP: 120 },
    { id: 'ing-tonica', name: 'Agua Tónica Premium (ml)', unit: 'ML', currentStock: 6000, minStock: 1500, costPerUnitCOP: 12 },
    { id: 'ing-limon', name: 'Limón Tahití Fresco', unit: 'UNIT', currentStock: 80, minStock: 20, costPerUnitCOP: 400 },
    { id: 'ing-hielo', name: 'Hielo en Cubos Gourmet (g)', unit: 'GR', currentStock: 20000, minStock: 5000, costPerUnitCOP: 2 },
    { id: 'ing-menta', name: 'Hierbabuena / Menta Fresca (g)', unit: 'GR', currentStock: 500, minStock: 100, costPerUnitCOP: 30 },
    { id: 'ing-jarabe', name: 'Jarabe de Goma / Sirope (ml)', unit: 'ML', currentStock: 2000, minStock: 500, costPerUnitCOP: 15 },
    { id: 'ing-cerveza-club', name: 'Cerveza Club Colombia Dorada 330ml', unit: 'UNIT', currentStock: 72, minStock: 24, costPerUnitCOP: 3500 },

    // Cocina
    { id: 'ing-punta-anca', name: 'Punta de Anca Angus Seleccionada (g)', unit: 'GR', currentStock: 7000, minStock: 2000, costPerUnitCOP: 75 },
    { id: 'ing-papa-criolla', name: 'Papa Criolla Amarilla (g)', unit: 'GR', currentStock: 15000, minStock: 3000, costPerUnitCOP: 10 },
    { id: 'ing-pechuga', name: 'Pechuga de Pollo Limpia (g)', unit: 'GR', currentStock: 8000, minStock: 2000, costPerUnitCOP: 25 },
    { id: 'ing-arepas', name: 'Arepas de Maíz Paisa', unit: 'UNIT', currentStock: 100, minStock: 25, costPerUnitCOP: 600 },
    { id: 'ing-queso', name: 'Queso Campesino Fresco (g)', unit: 'GR', currentStock: 4000, minStock: 1000, costPerUnitCOP: 30 },
    { id: 'ing-alitas', name: 'Alitas de Pollo Frescas (g)', unit: 'GR', currentStock: 6000, minStock: 1500, costPerUnitCOP: 22 },
    { id: 'ing-salsa-bbq', name: 'Salsa BBQ Ahumada Artesanal (g)', unit: 'GR', currentStock: 3000, minStock: 600, costPerUnitCOP: 20 }
  ];

  for (const ing of ingredients) {
    await Ingredient.create(ing, db);
  }

  log('🌱 Sembrando Productos y Recetas (Escandallo)...');
  const products = [
    // PRODUCTOS DE BAR
    {
      id: 'prod-mojito',
      name: 'Cóctel Mojito Clásico',
      category: 'Cócteles',
      station: 'BAR',
      salePriceCOP: 32000,
      isAvailable: true,
      recipe: [
        { ingredientId: 'ing-ron-medellin', quantity: 60 },
        { ingredientId: 'ing-jarabe', quantity: 30 },
        { ingredientId: 'ing-menta', quantity: 10 },
        { ingredientId: 'ing-limon', quantity: 1 },
        { ingredientId: 'ing-hielo', quantity: 150 },
        { ingredientId: 'ing-tonica', quantity: 90 }
      ]
    },
    {
      id: 'prod-gin-tonic',
      name: 'Gin Tonic Tanqueray',
      category: 'Cócteles',
      station: 'BAR',
      salePriceCOP: 38000,
      isAvailable: true,
      recipe: [
        { ingredientId: 'ing-tanqueray', quantity: 60 },
        { ingredientId: 'ing-tonica', quantity: 200 },
        { ingredientId: 'ing-limon', quantity: 1 },
        { ingredientId: 'ing-hielo', quantity: 180 }
      ]
    },
    {
      id: 'prod-shot-guaro',
      name: 'Shot de Aguardiente Antioqueño',
      category: 'Licores',
      station: 'BAR',
      salePriceCOP: 8000,
      isAvailable: true,
      recipe: [
        { ingredientId: 'ing-aguardiente', quantity: 45 }
      ]
    },
    {
      id: 'prod-cerveza-club',
      name: 'Cerveza Club Colombia Dorada',
      category: 'Cervezas',
      station: 'BAR',
      salePriceCOP: 10000,
      isAvailable: true,
      recipe: [
        { ingredientId: 'ing-cerveza-club', quantity: 1 }
      ]
    },

    // PRODUCTOS DE COCINA
    {
      id: 'prod-punta-anca',
      name: 'Punta de Anca 350g',
      category: 'Carnes',
      station: 'KITCHEN',
      salePriceCOP: 54000,
      isAvailable: true,
      recipe: [
        { ingredientId: 'ing-punta-anca', quantity: 350 },
        { ingredientId: 'ing-papa-criolla', quantity: 150 },
        { ingredientId: 'ing-arepas', quantity: 1 }
      ]
    },
    {
      id: 'prod-picada-criolla',
      name: 'Picada Criolla Tradicional (2 personas)',
      category: 'Para Compartir',
      station: 'KITCHEN',
      salePriceCOP: 68000,
      isAvailable: true,
      recipe: [
        { ingredientId: 'ing-punta-anca', quantity: 200 },
        { ingredientId: 'ing-pechuga', quantity: 200 },
        { ingredientId: 'ing-papa-criolla', quantity: 250 },
        { ingredientId: 'ing-arepas', quantity: 2 },
        { ingredientId: 'ing-queso', quantity: 150 }
      ]
    },
    {
      id: 'prod-alitas-bbq',
      name: 'Alitas BBQ Glaseadas (8 piezas)',
      category: 'Entradas',
      station: 'KITCHEN',
      salePriceCOP: 34000,
      isAvailable: true,
      recipe: [
        { ingredientId: 'ing-alitas', quantity: 400 },
        { ingredientId: 'ing-salsa-bbq', quantity: 80 },
        { ingredientId: 'ing-papa-criolla', quantity: 120 }
      ]
    }
  ];

  for (const prod of products) {
    await Product.create(prod, db);
  }

  log(`✅ Siembra completada: ${tables.length} mesas, ${ingredients.length} insumos, ${products.length} productos con recetas escandalladas.`);
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error en seedDatabase:', err);
      process.exit(1);
    });
}

module.exports = { seedDatabase };
