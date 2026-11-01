-- ============================================================
-- COMANDA SAAS - ESQUEMA DE BASE DE DATOS (POSTGRESQL / SUPABASE & SQLITE)
-- ============================================================

-- 0.1 TENANTS (RESTAURANTES / FRANQUICIAS SAAS)
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  nit VARCHAR(50),
  address TEXT,
  businessType VARCHAR(30) NOT NULL DEFAULT 'RESTAURANT',
  planName VARCHAR(60) NOT NULL DEFAULT 'PRO',
  monthlyFeeCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  subscriptionEndsAt TIMESTAMPTZ,
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  enabledModules JSONB NOT NULL,
  taxConfig JSONB NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

-- 0.2 USUARIOS (SUPER_ADMIN, RESTAURANT_ADMIN, CASHIER, WAITER)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenantId TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(150) NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(30) NOT NULL CHECK(role IN ('SUPER_ADMIN', 'RESTAURANT_ADMIN', 'CASHIER', 'WAITER')),
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt TIMESTAMPTZ NOT NULL
);

-- 1. MESAS & ZONAS (Aisladas por tenantId)
CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  number INTEGER NOT NULL,
  zone VARCHAR(100) NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity > 0),
  posX DOUBLE PRECISION NOT NULL DEFAULT 0,
  posY DOUBLE PRECISION NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL CHECK(status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'PAYING', 'CLEANING')) DEFAULT 'AVAILABLE',
  currentSessionId TEXT,
  lastOrderAt TIMESTAMPTZ,
  UNIQUE(tenantId, number)
);

-- 2. SESIONES & CUENTAS
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  tableId TEXT NOT NULL REFERENCES tables(id),
  waiterId TEXT NOT NULL,
  waiterName VARCHAR(150) NOT NULL,
  dinerCount INTEGER NOT NULL DEFAULT 1 CHECK(dinerCount > 0),
  openedAt TIMESTAMPTZ NOT NULL,
  closedAt TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL CHECK(status IN ('OPEN', 'SPLITTING', 'CLOSED')) DEFAULT 'OPEN',
  subAccounts JSONB -- JSONB con desglose de subcuentas (si se dividió)
);

-- 3. INSUMOS / INGREDIENTES (STOCK)
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  name VARCHAR(150) NOT NULL,
  unit VARCHAR(10) NOT NULL CHECK(unit IN ('ML', 'GR', 'UNIT')),
  currentStock DOUBLE PRECISION NOT NULL DEFAULT 0,
  minStock DOUBLE PRECISION NOT NULL DEFAULT 0,
  costPerUnitCOP NUMERIC(14, 2) NOT NULL DEFAULT 0
);

-- 4. PRODUCTOS & MENÚ
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  name VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL,
  station VARCHAR(10) NOT NULL CHECK(station IN ('KITCHEN', 'BAR')),
  salePriceCOP NUMERIC(14, 2) NOT NULL CHECK(salePriceCOP >= 0),
  isAvailable BOOLEAN NOT NULL DEFAULT TRUE,
  trackStock BOOLEAN NOT NULL DEFAULT FALSE,
  stockUnits INTEGER NOT NULL DEFAULT 0,
  minStockUnits INTEGER NOT NULL DEFAULT 5
);

-- 4.1 RECETAS / ESCANDALLO DE PRODUCTOS
CREATE TABLE IF NOT EXISTS product_recipes (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredientId TEXT NOT NULL REFERENCES ingredients(id),
  quantity DOUBLE PRECISION NOT NULL CHECK(quantity > 0)
);

-- 5. COMANDAS (ÓRDENES)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  tableId TEXT NOT NULL REFERENCES tables(id),
  waiterId TEXT NOT NULL,
  station VARCHAR(10) NOT NULL CHECK(station IN ('KITCHEN', 'BAR')),
  status VARCHAR(20) NOT NULL CHECK(status IN ('PENDING', 'IN_PREP', 'READY', 'SERVED', 'CANCELLED')) DEFAULT 'PENDING',
  createdAt TIMESTAMPTZ NOT NULL
);

-- 5.1 ÍTEMS DE COMANDA
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  productId TEXT NOT NULL REFERENCES products(id),
  productName VARCHAR(150) NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  seatNumber INTEGER DEFAULT 1,
  modifiers JSONB, -- JSONB array de modificaciones (ej. ["Término 3/4", "Sin sal"])
  notes TEXT,
  unitPriceCOP NUMERIC(14, 2) NOT NULL CHECK(unitPriceCOP >= 0)
);

-- 6. FACTURACIÓN (Soporta mesas y venta rápida de mostrador / Express)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  sessionId TEXT REFERENCES sessions(id),
  tableId TEXT REFERENCES tables(id),
  saleType VARCHAR(20) NOT NULL DEFAULT 'TABLE',
  customerNote TEXT,
  cashierName VARCHAR(150),
  subtotalCOP NUMERIC(14, 2) NOT NULL,
  impoconsumoRate DOUBLE PRECISION NOT NULL DEFAULT 0.08,
  impoconsumoCOP NUMERIC(14, 2) NOT NULL,
  ivaRate DOUBLE PRECISION NOT NULL DEFAULT 0.00,
  ivaCOP NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  tipRate DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  tipCOP NUMERIC(14, 2) NOT NULL,
  totalCOP NUMERIC(14, 2) NOT NULL,
  splitType VARCHAR(20) NOT NULL CHECK(splitType IN ('SINGLE', 'EQUAL', 'ITEMS')) DEFAULT 'SINGLE',
  status VARCHAR(20) NOT NULL CHECK(status IN ('DRAFT', 'PAID', 'CANCELLED')) DEFAULT 'PAID',
  cancelReason TEXT,
  cancelledAt TIMESTAMPTZ,
  cancelledBy VARCHAR(150),
  createdAt TIMESTAMPTZ NOT NULL
);

-- 6.1 PAGOS Y MEDIOS DE PAGO
CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY,
  invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  subAccountId TEXT,
  method VARCHAR(20) NOT NULL CHECK(method IN ('CASH', 'CARD', 'NEQUI', 'DAVIPLATA', 'TRANSFER')),
  amountCOP NUMERIC(14, 2) NOT NULL CHECK(amountCOP > 0),
  reference TEXT,
  createdAt TIMESTAMPTZ NOT NULL
);

-- 6.2 ÍTEMS DE FACTURA (DETALLE EXACTO PARA ANALÍTICA Y EXPORTACIÓN)
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  productId TEXT,
  productName VARCHAR(150) NOT NULL,
  category VARCHAR(100),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unitPriceCOP NUMERIC(14, 2) NOT NULL CHECK(unitPriceCOP >= 0),
  subtotalCOP NUMERIC(14, 2) NOT NULL CHECK(subtotalCOP >= 0),
  createdAt TIMESTAMPTZ NOT NULL
);

-- 7. CIERRE CIEGO & AUDITORÍA DE TURNO
CREATE TABLE IF NOT EXISTS shift_audits (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  shiftNumber INTEGER NOT NULL,
  cashierId TEXT NOT NULL,
  cashierName VARCHAR(150) NOT NULL,
  openedAt TIMESTAMPTZ NOT NULL,
  closedAt TIMESTAMPTZ,
  initialCashCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  declaredCashCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  declaredCardCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  declaredTransfersCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  systemCashCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  systemCardCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  systemTransfersCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discrepancyCashCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discrepancyCardCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discrepancyTransfersCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  totalDiscrepancyCOP NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL CHECK(status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
  notes TEXT
);

-- 8. MERMAS, ROTURAS Y CORTESÍAS
CREATE TABLE IF NOT EXISTS wastes (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL DEFAULT 'tenant-default',
  productId TEXT REFERENCES products(id),
  ingredientId TEXT REFERENCES ingredients(id),
  quantity DOUBLE PRECISION NOT NULL CHECK(quantity > 0),
  unit VARCHAR(10) NOT NULL CHECK(unit IN ('ML', 'GR', 'UNIT')),
  type VARCHAR(20) NOT NULL CHECK(type IN ('WASTE', 'COURTESY', 'STAFF_MEAL')),
  reason TEXT NOT NULL,
  authorizedBy VARCHAR(150) NOT NULL,
  totalCostCOP NUMERIC(14, 2) NOT NULL CHECK(totalCostCOP >= 0),
  createdAt TIMESTAMPTZ NOT NULL
);

-- ÍNDICES PARA BÚSQUEDAS EFICIENTES Y AISLAMIENTO SAAS
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenantId ON users(tenantId);
CREATE INDEX IF NOT EXISTS idx_tables_tenantId ON tables(tenantId);
CREATE INDEX IF NOT EXISTS idx_tables_status ON tables(status);
CREATE INDEX IF NOT EXISTS idx_sessions_tenantId ON sessions(tenantId);
CREATE INDEX IF NOT EXISTS idx_sessions_tableId ON sessions(tableId);
CREATE INDEX IF NOT EXISTS idx_orders_tenantId ON orders(tenantId);
CREATE INDEX IF NOT EXISTS idx_orders_sessionId ON orders(sessionId);
CREATE INDEX IF NOT EXISTS idx_orders_station ON orders(station);
CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId);
CREATE INDEX IF NOT EXISTS idx_recipes_productId ON product_recipes(productId);
CREATE INDEX IF NOT EXISTS idx_invoices_tenantId ON invoices(tenantId);
CREATE INDEX IF NOT EXISTS idx_invoices_sessionId ON invoices(sessionId);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created ON invoices(tenantId, createdAt);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoiceId ON invoice_items(invoiceId);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenantId ON invoice_items(tenantId);
CREATE INDEX IF NOT EXISTS idx_payments_invoiceId ON invoice_payments(invoiceId);
CREATE INDEX IF NOT EXISTS idx_shifts_tenantId ON shift_audits(tenantId);
CREATE INDEX IF NOT EXISTS idx_wastes_tenantId ON wastes(tenantId);
