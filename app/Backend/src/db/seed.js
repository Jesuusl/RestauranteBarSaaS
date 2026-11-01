const { getDatabase, initSchema } = require('../config/database');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Table = require('../models/Table');
const Ingredient = require('../models/Ingredient');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');
const Session = require('../models/Session');

/**
 * Función para sembrar los datos iniciales del sistema SaaS Multi-Tenant.
 * Puede ejecutarse sobre la base de datos por defecto o sobre una base de datos en memoria para testing.
 * Idempotente y compatible con SQLite y PostgreSQL.
 *
 * @param {Object} [customDb]
 * @param {Object} [options] - Opciones (ej. silent)
 */
async function seedDatabase(customDb, options = {}) {
  let db = customDb || getDatabase();
  const silent = Boolean(options.silent);
  const log = (...args) => { if (!silent) console.log(...args); };

  // Asegurar que las tablas existan
  await initSchema(db);

  // Si se activó fallback a SQLite durante initSchema, refrescar conexión
  if (!customDb) {
    db = getDatabase();
  }

  // Limpiar datos existentes en orden de dependencias
  const tablesToClear = [
    'invoice_items',
    'invoice_payments',
    'invoices',
    'order_items',
    'orders',
    'product_recipes',
    'products',
    'ingredients',
    'sessions',
    'tables',
    'shift_audits',
    'wastes',
    'users',
    'tenants'
  ];
  for (const tbl of tablesToClear) {
    await db.query(`DELETE FROM ${tbl}`);
  }

  log('🌱 Sembrando Tenants (Restaurantes SaaS)...');
  // 1. Tenant Principal: Hera Resto-Bar
  const tenantDefault = await Tenant.create({
    id: 'tenant-default',
    name: 'Hera Resto-Bar',
    slug: 'hera-restobar',
    nit: '901.834.521-4',
    address: 'Montería, Córdoba',
    businessType: 'RESTAURANT',
    isActive: true,
    enabledModules: {
      express_pos: true,
      sales: true,
      catalog: true,
      tables: true,
      pos: true,
      kds: true,
      billing: true,
      shifts: true
    },
    taxConfig: {
      applyImpoconsumo: true,
      impoconsumoRate: 0.08,
      applyTip: true,
      tipRate: 0.10
    }
  }, db);

  // 2. Tenant Secundario: Punto Express Mostrador (Venta Rápida sin mesas)
  const tenantExpress = await Tenant.create({
    id: 'tenant-express',
    name: 'Punto Express Mostrador',
    slug: 'punto-express',
    nit: '901.442.110-8',
    address: 'Local 104 - Mostrador Principal',
    businessType: 'EXPRESS_COUNTER',
    isActive: true,
    enabledModules: {
      express_pos: true,
      sales: true,
      catalog: true,
      tables: false,
      pos: false,
      kds: false,
      billing: false,
      shifts: false
    },
    taxConfig: {
      applyImpoconsumo: false,
      impoconsumoRate: 0.08,
      applyTip: false,
      tipRate: 0.10
    }
  }, db);

  log('🌱 Sembrando Usuarios del Sistema...');
  // Usuario CEO SaaS (Super Admin Global)
  await User.create({
    id: 'usr-ceo',
    tenantId: null,
    email: 'Admin',
    password: 'D5a04T9o@>_!',
    role: 'SUPER_ADMIN',
    name: 'CEO HERA'
  }, db);

  // Admin Hera Resto-Bar
  await User.create({
    id: 'usr-admin-hera',
    tenantId: tenantDefault.id,
    email: 'admin@hera.com',
    password: 'admin123',
    role: 'RESTAURANT_ADMIN',
    name: 'Admin Hera'
  }, db);

  // Cajero/Admin Punto Express
  await User.create({
    id: 'usr-caja-express',
    tenantId: tenantExpress.id,
    email: 'caja@express.com',
    password: 'caja123',
    role: 'RESTAURANT_ADMIN',
    name: 'Caja Punto Express'
  }, db);

  log('🌱 Sembrando Zonas y Mesas de tenant-default...');
  const tables = [
    // Salón Principal
    { id: 'tab-1', tenantId: 'tenant-default', number: 1, zone: 'Salón Principal', capacity: 4, posX: 100, posY: 100, status: 'AVAILABLE' },
    { id: 'tab-2', tenantId: 'tenant-default', number: 2, zone: 'Salón Principal', capacity: 2, posX: 250, posY: 100, status: 'OCCUPIED' },
    { id: 'tab-3', tenantId: 'tenant-default', number: 3, zone: 'Salón Principal', capacity: 6, posX: 400, posY: 100, status: 'RESERVED' },
    // Terraza
    { id: 'tab-4', tenantId: 'tenant-default', number: 4, zone: 'Terraza', capacity: 4, posX: 100, posY: 250, status: 'AVAILABLE' },
    { id: 'tab-5', tenantId: 'tenant-default', number: 5, zone: 'Terraza', capacity: 4, posX: 250, posY: 250, status: 'PAYING' },
    { id: 'tab-6', tenantId: 'tenant-default', number: 6, zone: 'Terraza', capacity: 2, posX: 400, posY: 250, status: 'CLEANING' },
    // Barra VIP
    { id: 'tab-7', tenantId: 'tenant-default', number: 7, zone: 'Barra VIP', capacity: 2, posX: 100, posY: 400, status: 'AVAILABLE' },
    { id: 'tab-8', tenantId: 'tenant-default', number: 8, zone: 'Barra VIP', capacity: 2, posX: 250, posY: 400, status: 'OCCUPIED' }
  ];

  for (const t of tables) {
    await Table.create(t, db);
  }

  // Sesiones abiertas para mesas ocupadas y en cobro
  const seedSessions = [
    { id: 'sess-seed-2', tableId: 'tab-2', status: 'OCCUPIED' },
    { id: 'sess-seed-5', tableId: 'tab-5', status: 'PAYING' },
    { id: 'sess-seed-8', tableId: 'tab-8', status: 'OCCUPIED' }
  ];

  for (const s of seedSessions) {
    await Session.create({
      id: s.id,
      tenantId: 'tenant-default',
      tableId: s.tableId,
      waiterId: 'usr-admin-hera',
      waiterName: 'Admin Hera',
      dinerCount: 2
    }, db);
    await Table.updateStatus(s.tableId, s.status, s.id, db);
  }

  log('🌱 Sembrando Insumos de Bar y Cocina de tenant-default...');
  const ingredients = [
    // Bar
    { id: 'ing-ron-medellin', tenantId: 'tenant-default', name: 'Ron Medellín Añejo (ml)', unit: 'ML', currentStock: 3000, minStock: 750, costPerUnitCOP: 60 },
    { id: 'ing-aguardiente', tenantId: 'tenant-default', name: 'Aguardiente Antioqueño (ml)', unit: 'ML', currentStock: 3750, minStock: 750, costPerUnitCOP: 50 },
    { id: 'ing-tanqueray', tenantId: 'tenant-default', name: 'Ginebra Tanqueray London Dry (ml)', unit: 'ML', currentStock: 2250, minStock: 750, costPerUnitCOP: 120 },
    { id: 'ing-tonica', tenantId: 'tenant-default', name: 'Agua Tónica Premium (ml)', unit: 'ML', currentStock: 6000, minStock: 1500, costPerUnitCOP: 12 },
    { id: 'ing-limon', tenantId: 'tenant-default', name: 'Limón Tahití Fresco', unit: 'UNIT', currentStock: 80, minStock: 20, costPerUnitCOP: 400 },
    { id: 'ing-hielo', tenantId: 'tenant-default', name: 'Hielo en Cubos Gourmet (g)', unit: 'GR', currentStock: 20000, minStock: 5000, costPerUnitCOP: 2 },
    { id: 'ing-menta', tenantId: 'tenant-default', name: 'Hierbabuena / Menta Fresca (g)', unit: 'GR', currentStock: 500, minStock: 100, costPerUnitCOP: 30 },
    { id: 'ing-jarabe', tenantId: 'tenant-default', name: 'Jarabe de Goma / Sirope (ml)', unit: 'ML', currentStock: 2000, minStock: 500, costPerUnitCOP: 15 },
    { id: 'ing-cerveza-club', tenantId: 'tenant-default', name: 'Cerveza Club Colombia Dorada 330ml', unit: 'UNIT', currentStock: 72, minStock: 24, costPerUnitCOP: 3500 },

    // Cocina
    { id: 'ing-punta-anca', tenantId: 'tenant-default', name: 'Punta de Anca Angus Seleccionada (g)', unit: 'GR', currentStock: 7000, minStock: 2000, costPerUnitCOP: 75 },
    { id: 'ing-papa-criolla', tenantId: 'tenant-default', name: 'Papa Criolla Amarilla (g)', unit: 'GR', currentStock: 15000, minStock: 3000, costPerUnitCOP: 10 },
    { id: 'ing-pechuga', tenantId: 'tenant-default', name: 'Pechuga de Pollo Limpia (g)', unit: 'GR', currentStock: 8000, minStock: 2000, costPerUnitCOP: 25 },
    { id: 'ing-arepas', tenantId: 'tenant-default', name: 'Arepas de Maíz Paisa', unit: 'UNIT', currentStock: 100, minStock: 25, costPerUnitCOP: 600 },
    { id: 'ing-queso', tenantId: 'tenant-default', name: 'Queso Campesino Fresco (g)', unit: 'GR', currentStock: 4000, minStock: 1000, costPerUnitCOP: 30 },
    { id: 'ing-alitas', tenantId: 'tenant-default', name: 'Alitas de Pollo Frescas (g)', unit: 'GR', currentStock: 6000, minStock: 1500, costPerUnitCOP: 22 },
    { id: 'ing-salsa-bbq', tenantId: 'tenant-default', name: 'Salsa BBQ Ahumada Artesanal (g)', unit: 'GR', currentStock: 3000, minStock: 600, costPerUnitCOP: 20 }
  ];

  for (const ing of ingredients) {
    await Ingredient.create(ing, db);
  }

  log('🌱 Sembrando Productos y Recetas (tenant-default)...');
  const products = [
    // PRODUCTOS DE BAR
    {
      id: 'prod-mojito',
      tenantId: 'tenant-default',
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
      tenantId: 'tenant-default',
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
      tenantId: 'tenant-default',
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
      tenantId: 'tenant-default',
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
      tenantId: 'tenant-default',
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
      tenantId: 'tenant-default',
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
      tenantId: 'tenant-default',
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

  log('🌱 Sembrando Catálogo y Ventas de tenant-express (Punto Express Mostrador)...');
  const expressProducts = [
    { id: 'exp-empanada', tenantId: 'tenant-express', name: 'Empanada Gourmet Carne', category: 'Panadería', station: 'KITCHEN', salePriceCOP: 4500, isAvailable: true },
    { id: 'exp-cafe-latte', tenantId: 'tenant-express', name: 'Café Latte Artesanal', category: 'Cafetería', station: 'BAR', salePriceCOP: 7500, isAvailable: true },
    { id: 'exp-sandwich', tenantId: 'tenant-express', name: 'Sándwich Cubano Express', category: 'Comidas Rápidas', station: 'KITCHEN', salePriceCOP: 16000, isAvailable: true },
    { id: 'exp-jugo', tenantId: 'tenant-express', name: 'Jugo Natural Mandarina', category: 'Bebidas', station: 'BAR', salePriceCOP: 6500, isAvailable: true },
    { id: 'exp-croissant', tenantId: 'tenant-express', name: 'Croissant Mantequilla & Queso', category: 'Panadería', station: 'KITCHEN', salePriceCOP: 6000, isAvailable: true },
    { id: 'exp-combo', tenantId: 'tenant-express', name: 'Combo Express (Sándwich + Jugo)', category: 'Combos', station: 'KITCHEN', salePriceCOP: 20000, isAvailable: true },
    { id: 'exp-brownie', tenantId: 'tenant-express', name: 'Brownie con Chocolate', category: 'Postres', station: 'KITCHEN', salePriceCOP: 7000, isAvailable: true }
  ];

  for (const ep of expressProducts) {
    await Product.create(ep, db);
  }

  // Sembrar 3 ventas reales de ejemplo para tenant-express (mostrador)
  // Venta 1: 2 Empanadas + 1 Café Latte en efectivo ($16.500)
  const now = Date.now();
  const dateSale1 = new Date(now - 45 * 60000).toISOString(); // Hace 45 min
  const dateSale2 = new Date(now - 30 * 60000).toISOString(); // Hace 30 min
  const dateSale3 = new Date(now - 15 * 60000).toISOString(); // Hace 15 min

  await Invoice.create({
    id: 'inv-exp-seed-1',
    tenantId: 'tenant-express',
    sessionId: null,
    tableId: null,
    saleType: 'EXPRESS',
    cashierName: 'Caja Punto Express',
    customerNote: 'Mesa exterior / para llevar',
    subtotalCOP: 16500,
    impoconsumoRate: 0.00,
    impoconsumoCOP: 0,
    ivaRate: 0.00,
    ivaCOP: 0,
    tipRate: 0.00,
    tipCOP: 0,
    totalCOP: 16500,
    splitType: 'SINGLE',
    status: 'PAID',
    createdAt: dateSale1,
    items: [
      { id: 'item-exp-1-1', productId: 'exp-empanada', productName: 'Empanada Gourmet Carne', category: 'Panadería', quantity: 2, unitPriceCOP: 4500, subtotalCOP: 9000 },
      { id: 'item-exp-1-2', productId: 'exp-cafe-latte', productName: 'Café Latte Artesanal', category: 'Cafetería', quantity: 1, unitPriceCOP: 7500, subtotalCOP: 7500 }
    ],
    payments: [
      { id: 'pay-exp-1', method: 'CASH', amountCOP: 16500, reference: 'Efectivo mostrador', createdAt: dateSale1 }
    ]
  }, db);

  // Venta 2: 1 Combo Express + 1 Brownie vía Nequi ($27.000)
  await Invoice.create({
    id: 'inv-exp-seed-2',
    tenantId: 'tenant-express',
    sessionId: null,
    tableId: null,
    saleType: 'EXPRESS',
    cashierName: 'Caja Punto Express',
    customerNote: 'Transferencia Nequi',
    subtotalCOP: 27000,
    impoconsumoRate: 0.00,
    impoconsumoCOP: 0,
    ivaRate: 0.00,
    ivaCOP: 0,
    tipRate: 0.00,
    tipCOP: 0,
    totalCOP: 27000,
    splitType: 'SINGLE',
    status: 'PAID',
    createdAt: dateSale2,
    items: [
      { id: 'item-exp-2-1', productId: 'exp-combo', productName: 'Combo Express (Sándwich + Jugo)', category: 'Combos', quantity: 1, unitPriceCOP: 20000, subtotalCOP: 20000 },
      { id: 'item-exp-2-2', productId: 'exp-brownie', productName: 'Brownie con Chocolate', category: 'Postres', quantity: 1, unitPriceCOP: 7000, subtotalCOP: 7000 }
    ],
    payments: [
      { id: 'pay-exp-2', method: 'NEQUI', amountCOP: 27000, reference: 'TRX-NEQUI-8812', createdAt: dateSale2 }
    ]
  }, db);

  // Venta 3: 2 Croissant + 2 Café Latte con Tarjeta ($27.000)
  await Invoice.create({
    id: 'inv-exp-seed-3',
    tenantId: 'tenant-express',
    sessionId: null,
    tableId: null,
    saleType: 'EXPRESS',
    cashierName: 'Caja Punto Express',
    customerNote: 'Datáfono Redeban',
    subtotalCOP: 27000,
    impoconsumoRate: 0.00,
    impoconsumoCOP: 0,
    ivaRate: 0.00,
    ivaCOP: 0,
    tipRate: 0.00,
    tipCOP: 0,
    totalCOP: 27000,
    splitType: 'SINGLE',
    status: 'PAID',
    createdAt: dateSale3,
    items: [
      { id: 'item-exp-3-1', productId: 'exp-croissant', productName: 'Croissant Mantequilla & Queso', category: 'Panadería', quantity: 2, unitPriceCOP: 6000, subtotalCOP: 12000 },
      { id: 'item-exp-3-2', productId: 'exp-cafe-latte', productName: 'Café Latte Artesanal', category: 'Cafetería', quantity: 2, unitPriceCOP: 7500, subtotalCOP: 15000 }
    ],
    payments: [
      { id: 'pay-exp-3', method: 'CARD', amountCOP: 27000, reference: 'AUTH-V-4991', createdAt: dateSale3 }
    ]
  }, db);

  log(`✅ Siembra completada: 2 tenants, 3 usuarios, ${tables.length} mesas, ${ingredients.length} insumos, ${products.length + expressProducts.length} productos y 3 ventas de mostrador.`);
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
