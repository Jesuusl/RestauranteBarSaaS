process.env.NODE_ENV = 'test';
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { getDatabase, withTransaction } = require('../src/config/database');
const { seedDatabase } = require('../src/db/seed');
const Product = require('../src/models/Product');
const Ingredient = require('../src/models/Ingredient');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Invoice = require('../src/models/Invoice');
const Table = require('../src/models/Table');
const app = require('../src/index');

describe('SUITE SAAS MULTI-TENANT, TRANSACCIONES ACID, FEATURE FLAGS Y ANALÍTICA', () => {
  let server;
  let baseUrl;
  let db;

  before(async () => {
    db = getDatabase();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(async () => {
    await seedDatabase(db, { silent: true });
  });

  // =========================================================================
  // 1. TRANSACCIONES ACID Y ROLLBACK ATÓMICO (withTransaction)
  // =========================================================================
  describe('1. Transacciones ACID y Rollback Atómico (withTransaction)', () => {
    test('Revierte deducción de stock y cambios en BD si una operación posterior lanza error (ROLLBACK)', async () => {
      const initialIng = await Ingredient.findById('ing-ron-medellin', db);
      assert.equal(initialIng.currentStock, 3000, 'Stock inicial debe ser 3000 ml');

      let errorThrown = false;
      try {
        await withTransaction(db, async (txDb) => {
          // 1. Deducir stock temporalmente
          await Ingredient.deductStock('ing-ron-medellin', 1000, txDb);

          const midStock = await Ingredient.findById('ing-ron-medellin', txDb);
          assert.equal(midStock.currentStock, 2000, 'Dentro de la tx el stock se redujo a 2000 ml');

          // 2. Simular fallo inesperado (ej. error de red, fallo de validación o excepción de pago)
          throw new Error('Fallo simulado para forzar ROLLBACK atómico');
        });
      } catch (err) {
        errorThrown = true;
        assert.match(err.message, /Fallo simulado/);
      }

      assert.equal(errorThrown, true, 'El callback de transacción debió lanzar el error');

      // Verificar que el stock fue revertido exactamente a su estado original
      const rolledBackIng = await Ingredient.findById('ing-ron-medellin', db);
      assert.equal(rolledBackIng.currentStock, 3000, 'El stock debió restaurarse a 3000 ml tras el ROLLBACK');
    });

    test('Confirma y persiste los cambios en BD si no ocurren errores (COMMIT)', async () => {
      const initialIng = await Ingredient.findById('ing-ron-medellin', db);
      assert.equal(initialIng.currentStock, 3000);

      await withTransaction(db, async (txDb) => {
        await Ingredient.deductStock('ing-ron-medellin', 500, txDb);
      });

      const updatedIng = await Ingredient.findById('ing-ron-medellin', db);
      assert.equal(updatedIng.currentStock, 2500, 'El stock debió confirmarse en 2500 ml');
    });

    test('No anida transacciones si db.isTransaction ya es true', async () => {
      let innerRan = false;
      await withTransaction(db, async (txDb) => {
        assert.equal(txDb.isTransaction, true);

        // Llamada anidada
        const result = await withTransaction(txDb, async (nestedTxDb) => {
          assert.equal(nestedTxDb.isTransaction, true);
          innerRan = true;
          return 'ok-nested';
        });

        assert.equal(result, 'ok-nested');
      });

      assert.equal(innerRan, true);
    });
  });

  // =========================================================================
  // 2. LOGIN UNIFICADO Y SEGURIDAD JWT (CEO + RESTAURANTES)
  // =========================================================================
  describe('2. Login Unificado y Seguridad JWT (CEO + Restaurantes)', () => {
    test('CEO SaaS inicia sesión exitosamente y obtiene token con rol SUPER_ADMIN', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'Admin', password: 'D5a04T9o@>_!' })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.token, 'Debe devolver un JWT');
      assert.equal(data.user.role, 'SUPER_ADMIN');
      assert.equal(data.user.email.toLowerCase(), 'admin');
      assert.equal(data.user.passwordHash, undefined, 'Nunca debe exponer passwordHash');
      assert.equal(data.tenant, null, 'CEO no está atado a un único tenant');
    });

    test('Administrador de Restaurante (Hera) inicia sesión con su tenant asignado', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@hera.com', password: 'admin123' })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.token);
      assert.equal(data.user.role, 'RESTAURANT_ADMIN');
      assert.equal(data.tenant.id, 'tenant-default');
      assert.equal(data.tenant.name, 'Hera Resto-Bar');
    });

    test('Cajero de Mostrador (Punto Express) inicia sesión con tenant express', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'caja@express.com', password: 'caja123' })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.token);
      assert.equal(data.user.role, 'RESTAURANT_ADMIN');
      assert.equal(data.tenant.id, 'tenant-express');
      assert.equal(data.tenant.businessType, 'EXPRESS_COUNTER');
    });

    test('Rechaza login con contraseña errónea respondiendo 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@hera.com', password: 'password-equivocada' })
      });

      assert.equal(res.status, 401);
      const data = await res.json();
      assert.match(data.error, /Credenciales inválidas/);
    });

    test('Rechaza login con 403 si el restaurante ha sido suspendido (isActive: false)', async () => {
      // Suspender restaurante tenant-express
      await Tenant.update('tenant-express', { isActive: false }, db);

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'caja@express.com', password: 'caja123' })
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /suspendida o inactiva/i);

      // Reactivar para siguientes pruebas
      await Tenant.update('tenant-express', { isActive: true }, db);
    });
  });

  // =========================================================================
  // 3. PANEL CEO SAAS Y FEATURE FLAGS (MÓDULOS ACTIVABLES)
  // =========================================================================
  describe('3. Panel CEO SaaS y Control Modular de Módulos (Feature Flags)', () => {
    let ceoToken;

    beforeEach(async () => {
      await seedDatabase(db, { silent: true });
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'Admin', password: 'D5a04T9o@>_!' })
      });
      const data = await res.json();
      ceoToken = data.token;
    });

    test('CEO crea un nuevo restaurante y su administrador vía POST /api/ceo/tenants', async () => {
      const res = await fetch(`${baseUrl}/api/ceo/tenants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ceoToken}`
        },
        body: JSON.stringify({
          name: 'Pizzería Napolitana Gourmet',
          slug: 'pizzeria-napolitana',
          nit: '900.555.123-1',
          address: 'Cra 5 # 12-45',
          businessType: 'RESTAURANT',
          adminEmail: 'admin@pizzeria.com',
          adminPassword: 'pizza-secret-123',
          adminName: 'Mario Rossi',
          enabledModules: {
            express_pos: false,
            sales: true,
            catalog: true,
            tables: true,
            pos: true,
            kds: true,
            billing: true,
            shifts: true
          }
        })
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.tenant.name, 'Pizzería Napolitana Gourmet');
      assert.equal(data.tenant.slug, 'pizzeria-napolitana');
      assert.equal(data.adminUser.email, 'admin@pizzeria.com');
      assert.equal(data.adminUser.role, 'RESTAURANT_ADMIN');
    });

    test('Endpoint bloquea con 403 si el restaurante intenta usar un módulo desactivado', async () => {
      // 1. Iniciar sesión como cajero de Punto Express (que tiene express_pos: true pero tables: false)
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'caja@express.com', password: 'caja123' })
      });
      const { token } = await loginRes.json();

      // 2. Desactivar el módulo 'sales' para tenant-express mediante el CEO
      await fetch(`${baseUrl}/api/ceo/tenants/tenant-express/modules`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ceoToken}`
        },
        body: JSON.stringify({
          enabledModules: { sales: false }
        })
      });

      // 3. Intentar consultar ventas protegidas por requireModule('sales')
      const salesRes = await fetch(`${baseUrl}/api/sales/summary`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      assert.equal(salesRes.status, 403);
      const errorData = await salesRes.json();
      assert.match(errorData.error, /módulo no está habilitado/);

      // 4. CEO reactiva el módulo 'sales'
      const reactivateRes = await fetch(`${baseUrl}/api/ceo/tenants/tenant-express/modules`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ceoToken}`
        },
        body: JSON.stringify({
          enabledModules: { sales: true }
        })
      });
      assert.equal(reactivateRes.status, 200);

      // 5. Ahora sí puede acceder a sales
      const allowedRes = await fetch(`${baseUrl}/api/sales/summary`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      assert.equal(allowedRes.status, 200);
    });

    test('CEO actualiza credenciales del administrador vía PATCH /api/ceo/tenants/:id/credentials', async () => {
      const res = await fetch(`${baseUrl}/api/ceo/tenants/tenant-express/credentials`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ceoToken}`
        },
        body: JSON.stringify({
          adminName: 'Nuevo Administrador Express',
          adminPassword: 'nuevaPassword123'
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.user.name, 'Nuevo Administrador Express');

      // Comprobar que puede loguearse con la nueva contraseña
      const loginCheck = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'caja@express.com', password: 'nuevaPassword123' })
      });
      assert.equal(loginCheck.status, 200);
    });

    test('CEO elimina un restaurante con borrado en cascada ACID vía DELETE /api/ceo/tenants/:id', async () => {
      // 1. Crear tenant de prueba con productos y usuario
      const createRes = await fetch(`${baseUrl}/api/ceo/tenants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ceoToken}`
        },
        body: JSON.stringify({
          id: 'tenant-to-delete',
          name: 'Restaurante Efímero',
          slug: 'restaurante-efimero',
          adminEmail: 'efimero@test.com',
          adminPassword: 'password123',
          includeSampleProducts: true
        })
      });
      assert.equal(createRes.status, 201);

      // Verificar que existe en BD
      const tenantBefore = await Tenant.findById('tenant-to-delete', db);
      assert.ok(tenantBefore);

      // 2. Ejecutar DELETE
      const deleteRes = await fetch(`${baseUrl}/api/ceo/tenants/tenant-to-delete`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ceoToken}` }
      });
      assert.equal(deleteRes.status, 200);
      const deleteData = await deleteRes.json();
      assert.equal(deleteData.success, true);

      // 3. Verificar que ya no existe en BD
      const tenantAfter = await Tenant.findById('tenant-to-delete', db);
      assert.equal(tenantAfter, null);
      const userAfter = await User.findByEmail('efimero@test.com', db);
      assert.equal(userAfter, null);
    });
  });

  // =========================================================================
  // 4. AISLAMIENTO MULTI-TENANT ESTRICTO
  // =========================================================================
  describe('4. Aislamiento Multi-Tenant Estricto entre Restaurantes', () => {
    test('Cajero de tenant-express solo visualiza productos de tenant-express, nunca los de tenant-default', async () => {
      // Productos de tenant-express
      const expressProds = await Product.findAll(db, 'tenant-express');
      assert.equal(expressProds.length, 7, 'Punto Express debe tener 7 productos de mostrador');

      for (const p of expressProds) {
        assert.equal(p.tenantId, 'tenant-express');
        assert.ok(p.id.startsWith('exp-'));
      }

      // Productos de tenant-default
      const defaultProds = await Product.findAll(db, 'tenant-default');
      assert.equal(defaultProds.length, 7, 'Hera Resto-Bar debe tener 7 productos de bar/cocina');

      for (const p of defaultProds) {
        assert.equal(p.tenantId, 'tenant-default');
        assert.ok(p.id.startsWith('prod-'));
      }
    });

    test('Aislamiento de ventas: Punto Express no mezcla sus facturas con las de otros restaurantes', async () => {
      const expressSales = await Invoice.findAll(db, 'tenant-express');
      assert.equal(expressSales.length, 3, 'Punto Express debe tener exactamente sus 3 ventas sembradas');

      for (const s of expressSales) {
        assert.equal(s.tenantId, 'tenant-express');
      }

      const defaultSales = await Invoice.findAll(db, 'tenant-default');
      assert.equal(defaultSales.length, 0, 'tenant-default no debe tener facturas iniciales que alteren el arqueo');
    });

    test('Diferentes restaurantes pueden tener su propia Mesa 1 sin conflicto de unicidad', async () => {
      // Mesa 1 ya existe en tenant-default
      const table1Default = await Table.findByNumber(1, db, 'tenant-default');
      assert.ok(table1Default);
      assert.equal(table1Default.number, 1);

      // Crear Mesa 1 en tenant-express
      const table1Express = await Table.create({
        id: 'tab-exp-1',
        tenantId: 'tenant-express',
        number: 1,
        zone: 'Barra Mostrador',
        capacity: 2
      }, db);

      assert.equal(table1Express.number, 1);
      assert.equal(table1Express.tenantId, 'tenant-express');

      // Consultar Mesa 1 en tenant-default sigue siendo la original
      const checkDefault = await Table.findByNumber(1, db, 'tenant-default');
      assert.equal(checkDefault.id, 'tab-1');
      assert.equal(checkDefault.zone, 'Salón Principal');

      // Consultar Mesa 1 en tenant-express devuelve la de express
      const checkExpress = await Table.findByNumber(1, db, 'tenant-express');
      assert.equal(checkExpress.id, 'tab-exp-1');
      assert.equal(checkExpress.zone, 'Barra Mostrador');
    });
  });

  // =========================================================================
  // 5. COBRO RÁPIDO DE MOSTRADOR (EXPRESS CHECKOUT)
  // =========================================================================
  describe('5. Cobro Rápido de Mostrador (Express Checkout)', () => {
    let expressToken;

    beforeEach(async () => {
      await seedDatabase(db, { silent: true });
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'caja@express.com', password: 'caja123' })
      });
      const data = await res.json();
      expressToken = data.token;
    });

    test('Ejecuta venta directa de mostrador sin mesa, sin Impoconsumo, calcula cambio e inserta invoice_items', async () => {
      const res = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expressToken}`
        },
        body: JSON.stringify({
          items: [
            { productId: 'exp-empanada', quantity: 2 }, // 2 x 4.500 = 9.000
            { productId: 'exp-cafe-latte', quantity: 1 } // 1 x 7.500 = 7.500
          ],
          paymentMethod: 'CASH',
          cashReceivedCOP: 50000,
          customerNote: 'Cliente express para llevar'
        })
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.success, true);

      // Verificación de cálculos fiscales y totales (Impoconsumo desactivado para este tenant)
      const inv = data.invoice;
      assert.equal(inv.subtotalCOP, 16500);
      assert.equal(inv.impoconsumoRate, 0);
      assert.equal(inv.impoconsumoCOP, 0);
      assert.equal(inv.tipRate, 0);
      assert.equal(inv.tipCOP, 0);
      assert.equal(inv.totalCOP, 16500);

      // Verificación de devuelta en efectivo: 50.000 recibido - 16.500 total = 33.500 cambio
      assert.equal(data.changeCOP, 33500, 'El cambio devuelto al cliente debe ser $33.500 COP');

      // Verificación de modalidad de venta
      assert.equal(inv.saleType, 'EXPRESS');
      assert.equal(inv.sessionId, null);
      assert.equal(inv.tableId, null);
      assert.equal(inv.status, 'PAID');

      // Verificación de inserción en invoice_items
      assert.equal(inv.items.length, 2);
      const empItem = inv.items.find(i => i.productId === 'exp-empanada');
      assert.equal(empItem.quantity, 2);
      assert.equal(empItem.unitPriceCOP, 4500);
      assert.equal(empItem.subtotalCOP, 9000);
    });

    test('Soporta venta rápida con métodos digitales (NEQUI / DAVIPLATA / CARD)', async () => {
      const res = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expressToken}`
        },
        body: JSON.stringify({
          items: [
            { productId: 'exp-combo', quantity: 1 } // 20.000
          ],
          paymentMethod: 'NEQUI',
          customerNote: 'Transferencia comprobante #7741'
        })
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.invoice.totalCOP, 20000);
      assert.equal(data.invoice.payments[0].method, 'NEQUI');
      assert.equal(data.changeCOP, 0, 'No hay devuelta para pagos electrónicos');
    });
  });

  // =========================================================================
  // 6. ANALÍTICA DE VENTAS Y EXPORTACIÓN CSV
  // =========================================================================
  describe('6. Analítica de Ventas y Exportación CSV (/api/sales)', () => {
    let expressToken;

    beforeEach(async () => {
      await seedDatabase(db, { silent: true });
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'caja@express.com', password: 'caja123' })
      });
      const data = await res.json();
      expressToken = data.token;
    });

    test('GET /api/sales/summary calcula con exactitud totalProductsSold, topProduct y ranking', async () => {
      const res = await fetch(`${baseUrl}/api/sales/summary`, {
        headers: { 'Authorization': `Bearer ${expressToken}` }
      });

      assert.equal(res.status, 200);
      const summary = await res.json();

      // Las 3 ventas sembradas tienen:
      // Venta 1: 2 Empanadas + 1 Café Latte
      // Venta 2: 1 Combo Express + 1 Brownie
      // Venta 3: 2 Croissant + 2 Café Latte
      // Total productos vendidos = 3 + 2 + 4 = 9 productos
      assert.equal(summary.totalProductsSold, 9);
      assert.equal(summary.totalSalesCount, 3);

      // Ingresos totales = 16.500 + 27.000 + 27.000 = 70.500 COP
      assert.equal(summary.totalRevenueCOP, 70500);

      // Ticket promedio = 70.500 / 3 = 23.500 COP
      assert.equal(summary.averageTicketCOP, 23500);

      // Producto más vendido debe ser Café Latte Artesanal (3 unidades vendidas)
      assert.ok(summary.topProduct);
      assert.equal(summary.topProduct.productName, 'Café Latte Artesanal');
      assert.equal(summary.topProduct.quantitySold, 3);
      assert.equal(summary.topProduct.revenueCOP, 22500);

      // Ranking de productos ordenado descendentemente
      assert.ok(Array.isArray(summary.productRanking));
      assert.equal(summary.productRanking[0].productName, 'Café Latte Artesanal');
      assert.equal(summary.productRanking[0].rank, 1);

      // Desglose de medios de pago
      assert.equal(summary.paymentBreakdown.CASH, 16500);
      assert.equal(summary.paymentBreakdown.NEQUI, 27000);
      assert.equal(summary.paymentBreakdown.CARD, 27000);
    });

    test('GET /api/sales/export.csv genera archivo compatible con Excel en Colombia', async () => {
      const res = await fetch(`${baseUrl}/api/sales/export.csv`, {
        headers: { 'Authorization': `Bearer ${expressToken}` }
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/csv'));
      assert.ok(res.headers.get('content-disposition').includes('attachment; filename="ventas_punto-express.csv"'));

      const buffer = Buffer.from(await res.arrayBuffer());

      // Verificar que comience con BOM UTF-8 (\uFEFF -> 0xEF, 0xBB, 0xBF)
      assert.equal(buffer[0], 0xef, 'BOM byte 1 debe ser 0xEF');
      assert.equal(buffer[1], 0xbb, 'BOM byte 2 debe ser 0xBB');
      assert.equal(buffer[2], 0xbf, 'BOM byte 3 debe ser 0xBF');

      const csvText = buffer.toString('utf-8');

      // Verificar cabeceras exactas
      assert.ok(csvText.includes('ID_Venta,Fecha,Hora,Modalidad,Productos,Cantidad_Productos,Metodo_Pago,Cajero,Subtotal_COP,Impoconsumo_COP,Propina_COP,Valor_Total_COP'));

      // Verificar filas y contenido
      assert.ok(csvText.includes('EXPRESS'));
      assert.ok(csvText.includes('Café Latte Artesanal'));
      assert.ok(csvText.includes('Caja Punto Express'));
      assert.ok(csvText.includes('70500') || csvText.includes('16500'));
    });
  });
});
