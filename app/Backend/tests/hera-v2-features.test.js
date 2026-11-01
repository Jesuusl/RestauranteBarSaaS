process.env.NODE_ENV = 'test';
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { getDatabase } = require('../src/config/database');
const { seedDatabase } = require('../src/db/seed');
const Product = require('../src/models/Product');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Invoice = require('../src/models/Invoice');
const ShiftAudit = require('../src/models/ShiftAudit');
const Table = require('../src/models/Table');
const app = require('../src/index');

describe('HERA v2.0 - SUITE DE CARACTERÍSTICAS Y REGLAS DE NEGOCIO', () => {
  let server;
  let baseUrl;
  let db;
  let ceoToken;
  let heraToken;
  let expressToken;

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

    // Login CEO
    const ceoRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Admin', password: 'D5a04T9o@>_!' })
    });
    const ceoData = await ceoRes.json();
    ceoToken = ceoData.token;

    // Login Admin Hera
    const heraRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@hera.com', password: 'admin123' })
    });
    const heraData = await heraRes.json();
    heraToken = heraData.token;

    // Login Punto Express
    const expRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'caja@express.com', password: 'caja123' })
    });
    const expData = await expRes.json();
    expressToken = expData.token;
  });

  // =========================================================================
  // CARACTERÍSTICA 1: PAGOS MIXTOS Y NORMALIZACIÓN DE EFECTIVO
  // =========================================================================
  describe('1. Pagos Mixtos y Normalización de Efectivo', () => {
    test('Procesa venta mostrador con pago mixto (NEQUI + TRANSFER + EFECTIVO) y calcula cambio exacto', async () => {
      // Crear un producto express de prueba
      const prod = await Product.create({
        id: 'test-mix-prod',
        tenantId: 'tenant-default',
        name: 'Plato Especial Mixto',
        category: 'Platos',
        station: 'KITCHEN',
        salePriceCOP: 50000,
        isAvailable: true
      }, db);

      // Total con Impoconsumo (8%): subtotal 50.000 + 4.000 = 54.000 COP
      // Cliente paga: 20.000 Nequi + 14.000 Transfer + Billete de 50.000 en Efectivo
      // Efectivo neto requerido = 54.000 - 34.000 = 20.000 COP
      // Devuelta esperada = 50.000 recibido - 20.000 requerido = 30.000 COP
      const res = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          items: [{ productId: prod.id, quantity: 1, unitPriceCOP: 50000 }],
          payments: [
            { method: 'NEQUI', amountCOP: 20000, reference: 'NEQ-991' },
            { method: 'TRANSFER', amountCOP: 14000, reference: 'TRF-332' },
            { method: 'CASH', amountCOP: 50000 }
          ],
          customerNote: 'Pago mixto cliente VIP'
        })
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.invoice.totalCOP, 54000);
      assert.equal(data.changeCOP, 30000, 'Devuelta debe ser 30.000 COP');

      // Verificar que en invoice_payments las filas sumen EXACTAMENTE el total (54.000)
      const payRows = data.invoice.payments;
      const sumAmounts = payRows.reduce((acc, p) => acc + p.amountCOP, 0);
      assert.equal(sumAmounts, 54000, 'La suma de pagos almacenados debe ser igual al total de la factura');

      const cashRow = payRows.find(p => p.method === 'CASH');
      assert.ok(cashRow);
      assert.equal(cashRow.amountCOP, 20000, 'El monto en efectivo registrado debe ser el neto requerido ($20.000), no el billete entregado');
    });

    test('Rechaza pago cuando el monto digital supera el total de la cuenta', async () => {
      const res = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          items: [{ productId: 'prod-shot-guaro', quantity: 1, unitPriceCOP: 8000 }],
          payments: [
            { method: 'NEQUI', amountCOP: 20000 } // Total de 1 shot + tax es menor a 20.000
          ]
        })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /superar el total/i);
    });

    test('Rechaza pago cuando el total recibido es insuficiente para cubrir la cuenta', async () => {
      const res = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          items: [{ productId: 'prod-shot-guaro', quantity: 2, unitPriceCOP: 8000 }], // 16.000 + 8% = 17.280
          payments: [
            { method: 'CASH', amountCOP: 10000 }
          ]
        })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /insuficiente/i);
    });

    test('Rechaza método de pago no reconocido con código 400', async () => {
      const res = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          items: [{ productId: 'prod-shot-guaro', quantity: 1 }],
          payments: [
            { method: 'BITCOIN', amountCOP: 8640 }
          ]
        })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /inválido/i);
    });
  });

  // =========================================================================
  // CARACTERÍSTICA 2: MODELO DE SUSCRIPCIONES CEO PRO
  // =========================================================================
  describe('2. Modelo de Suscripciones CEO Pro', () => {
    test('CEO visualiza planName, monthlyFeeCOP, días restantes y estado de suscripción de los tenants', async () => {
      const res = await fetch(`${baseUrl}/api/ceo/tenants`, {
        headers: { 'Authorization': `Bearer ${ceoToken}` }
      });

      assert.equal(res.status, 200);
      const tenants = await res.json();
      assert.ok(Array.isArray(tenants));

      const hera = tenants.find(t => t.id === 'tenant-default');
      assert.ok(hera);
      assert.equal(hera.planName, 'PRO');
      assert.equal(hera.monthlyFeeCOP, 150000);
      assert.ok(hera.subscriptionEndsAt);
      assert.ok(typeof hera.daysRemaining === 'number');
      assert.equal(hera.subscriptionStatus, 'ACTIVE');
      assert.ok(typeof hera.totalRevenueCOP === 'number');
    });

    test('CEO renueva suscripción de un restaurante vía POST /api/ceo/tenants/:id/renew', async () => {
      const tenantBefore = await Tenant.findById('tenant-default', db);
      const prevEndsAt = new Date(tenantBefore.subscriptionEndsAt || Date.now()).getTime();

      const res = await fetch(`${baseUrl}/api/ceo/tenants/tenant-default/renew`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ceoToken}`
        },
        body: JSON.stringify({ months: 2 })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.tenant.subscriptionStatus, 'ACTIVE');

      const newEndsAt = new Date(data.tenant.subscriptionEndsAt).getTime();
      assert.ok(newEndsAt > prevEndsAt + 50 * 86400000, 'La nueva fecha debe extenderse aproximadamente 60 días');
    });

    test('Bloquea acceso con 403 SUBSCRIPTION_EXPIRED cuando la fecha de suscripción ha vencido', async () => {
      // Expirar la suscripción de tenant-express a ayer
      const pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      await db.query('UPDATE tenants SET subscriptionEndsAt = $1 WHERE id = $2', [pastDate, 'tenant-express']);

      // 1. Intento de login del restaurante expirado
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'caja@express.com', password: 'caja123' })
      });

      assert.equal(loginRes.status, 403);
      const loginData = await loginRes.json();
      assert.equal(loginData.code, 'SUBSCRIPTION_EXPIRED');

      // 2. Token existente también es bloqueado por middleware
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${expressToken}` }
      });
      assert.equal(meRes.status, 403);
      const meData = await meRes.json();
      assert.equal(meData.code, 'SUBSCRIPTION_EXPIRED');

      // 3. Super Admin global NO es bloqueado
      const ceoMeRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${ceoToken}` }
      });
      assert.equal(ceoMeRes.status, 200);
    });
  });

  // =========================================================================
  // CARACTERÍSTICA 3: ANULACIÓN DE FACTURAS DE VENTA
  // =========================================================================
  describe('3. Anulación de Facturas de Venta', () => {
    test('Anula factura pagada, restaura stock simple, emite evento y excluye venta de ingresos pagados', async () => {
      // 1. Crear producto con stock simple
      const prod = await Product.create({
        id: 'prod-anular-test',
        tenantId: 'tenant-default',
        name: 'Botella Licor Premium',
        category: 'Licores',
        station: 'BAR',
        salePriceCOP: 120000,
        trackStock: true,
        stockUnits: 10,
        minStockUnits: 2,
        isAvailable: true
      }, db);

      // 2. Ejecutar venta mostrador (1 unidad)
      const saleRes = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          items: [{ productId: prod.id, quantity: 1, unitPriceCOP: 120000 }],
          paymentMethod: 'CASH',
          cashReceivedCOP: 150000
        })
      });
      assert.equal(saleRes.status, 201);
      const saleData = await saleRes.json();
      const invoiceId = saleData.invoice.id;

      // El stock debió bajar a 9
      const prodAfterSale = await Product.findById(prod.id, db);
      assert.equal(prodAfterSale.stockUnits, 9);

      // 3. Validar resumen de ventas antes de anulación
      const sumBeforeRes = await fetch(`${baseUrl}/api/sales/summary`, {
        headers: { 'Authorization': `Bearer ${heraToken}` }
      });
      const sumBefore = await sumBeforeRes.json();
      const revenueBefore = sumBefore.totalRevenueCOP;

      // 4. Anular factura vía POST /api/sales/:id/cancel
      const cancelRes = await fetch(`${baseUrl}/api/sales/${invoiceId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({ reason: 'Error en pedido comanda duplicada por mesero' })
      });

      assert.equal(cancelRes.status, 200);
      const cancelData = await cancelRes.json();
      assert.equal(cancelData.success, true);
      assert.equal(cancelData.invoice.status, 'CANCELLED');
      assert.equal(cancelData.invoice.cancelReason, 'Error en pedido comanda duplicada por mesero');

      // 5. Verificar que el stock simple se restauró a 10
      const prodAfterCancel = await Product.findById(prod.id, db);
      assert.equal(prodAfterCancel.stockUnits, 10, 'El stock debió restaurarse automáticamente a 10 unidades');

      // 6. Verificar que la venta anulada se restó de totalRevenueCOP en resumen de ventas
      const sumAfterRes = await fetch(`${baseUrl}/api/sales/summary`, {
        headers: { 'Authorization': `Bearer ${heraToken}` }
      });
      const sumAfter = await sumAfterRes.json();
      assert.equal(sumAfter.totalRevenueCOP, revenueBefore - saleData.invoice.totalCOP, 'El ingreso pagado debió excluir la factura anulada');
      assert.equal(sumAfter.cancelledCount, 1);
      assert.equal(sumAfter.cancelledTotalCOP, saleData.invoice.totalCOP);

      // 7. Intentar anularla nuevamente retorna conflicto 409
      const reCancelRes = await fetch(`${baseUrl}/api/sales/${invoiceId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({ reason: 'Intento repetido' })
      });
      assert.equal(reCancelRes.status, 409);
    });

    test('Rechaza anulación si el motivo tiene menos de 3 caracteres', async () => {
      const res = await fetch(`${baseUrl}/api/sales/inv-exp-seed-1/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expressToken}`
        },
        body: JSON.stringify({ reason: 'No' })
      });

      assert.equal(res.status, 400);
    });

    test('CSV export incluye columnas Estado y Motivo_Anulacion', async () => {
      // Anular una venta de prueba en punto express
      await fetch(`${baseUrl}/api/sales/inv-exp-seed-2/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expressToken}`
        },
        body: JSON.stringify({ reason: 'Cliente devolvió producto dañado' })
      });

      const res = await fetch(`${baseUrl}/api/sales/export.csv`, {
        headers: { 'Authorization': `Bearer ${expressToken}` }
      });
      assert.equal(res.status, 200);
      const csvText = await res.text();

      // Verificar cabecera
      assert.ok(csvText.includes('ID_Venta,Fecha,Hora,Modalidad,Productos,Cantidad_Productos,Metodo_Pago,Cajero,Subtotal_COP,Impoconsumo_COP,Propina_COP,Valor_Total_COP,Estado,Motivo_Anulacion'));
      // Verificar presencia del estado CANCELLED y motivo
      assert.ok(csvText.includes('CANCELLED'));
      assert.ok(csvText.includes('Cliente devolvió producto dañado'));
    });
  });

  // =========================================================================
  // CARACTERÍSTICA 4: BASE INICIAL EN EFECTIVO (SHIFT AUDIT OPENING CASH)
  // =========================================================================
  describe('4. Base Inicial en Efectivo de Turnos', () => {
    test('Apertura de turno guarda initialCashCOP y lo suma en systemCashCOP en cierre ciego', async () => {
      // 1. Abrir turno con base de 200.000 COP
      const openRes = await fetch(`${baseUrl}/api/shifts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          shiftNumber: 1,
          cashierName: 'Cajero Principal',
          initialCashCOP: 200000,
          notes: 'Base inicial entregada en billetes de 50k y 20k'
        })
      });

      assert.equal(openRes.status, 201);
      const shift = await openRes.json();
      assert.equal(shift.initialCashCOP, 200000);

      // 2. Realizar venta en efectivo por $54.000 COP
      const saleRes = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          items: [{ productId: 'prod-shot-guaro', quantity: 2, unitPriceCOP: 25000 }],
          paymentMethod: 'CASH',
          cashReceivedCOP: 60000
        })
      });
      assert.equal(saleRes.status, 201);
      const saleData = await saleRes.json();
      const cashSaleTotal = saleData.invoice.totalCOP; // 50.000 + 8% = 54.000

      // 3. Ejecutar cierre ciego declarando 254.000 COP en efectivo
      const closeRes = await fetch(`${baseUrl}/api/shifts/active/blind-close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          declaredCashCOP: 254000,
          declaredCardCOP: 0,
          declaredTransfersCOP: 0
        })
      });

      assert.equal(closeRes.status, 200);
      const closed = await closeRes.json();

      // El efectivo en sistema debe ser: 200.000 (base) + 54.000 (ventas efectivo) = 254.000
      assert.equal(closed.initialCashCOP, 200000);
      assert.equal(closed.systemCashCOP, 200000 + cashSaleTotal);
      assert.equal(closed.discrepancyCashCOP, 0, 'La discrepancia de efectivo debe ser cero');
    });

    test('Rechaza apertura de turno con base inicial negativa', async () => {
      const res = await fetch(`${baseUrl}/api/shifts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          initialCashCOP: -50000
        })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /mayor o igual a 0/i);
    });
  });

  // =========================================================================
  // CARACTERÍSTICA 5: MÓDULO 9 INVENTORY (CONTROL DE STOCK SIMPLE)
  // =========================================================================
  describe('5. Módulo 9 Inventory (Control de Stock Simple)', () => {
    test('Ajusta stock simple vía PATCH /api/products/:id/stock por delta y valor absoluto', async () => {
      const prod = await Product.create({
        id: 'prod-stock-patch',
        tenantId: 'tenant-default',
        name: 'Gaseosa Postobón 400ml',
        category: 'Bebidas',
        station: 'BAR',
        salePriceCOP: 5000,
        trackStock: true,
        stockUnits: 20,
        minStockUnits: 5,
        isAvailable: true
      }, db);

      // 1. Ajuste por delta (-5)
      const res1 = await fetch(`${baseUrl}/api/products/${prod.id}/stock`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({ delta: -5 })
      });
      assert.equal(res1.status, 200);
      const data1 = await res1.json();
      assert.equal(data1.stockUnits, 15);

      // 2. Ajuste absoluto (fijar en 3 unidades -> stock bajo alerta)
      const res2 = await fetch(`${baseUrl}/api/products/${prod.id}/stock`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({ stockUnits: 3 })
      });
      assert.equal(res2.status, 200);
      const data2 = await res2.json();
      assert.equal(data2.stockUnits, 3);
    });

    test('Rechaza orden de comanda cuando el stock es insuficiente (código 400)', async () => {
      const prod = await Product.create({
        id: 'prod-stock-insuf',
        tenantId: 'tenant-default',
        name: 'Cerveza Artesanal Edición Limitada',
        category: 'Cervezas',
        station: 'BAR',
        salePriceCOP: 15000,
        trackStock: true,
        stockUnits: 2,
        minStockUnits: 1,
        isAvailable: true
      }, db);

      // Mesa disponible tab-1
      const res = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          tableId: 'tab-1',
          items: [
            { productId: prod.id, quantity: 5 } // Se piden 5 habiendo 2
          ]
        })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /Stock insuficiente/i);

      // Comprobar que el stock no fue modificado
      const prodAfter = await Product.findById(prod.id, db);
      assert.equal(prodAfter.stockUnits, 2);
    });

    test('Restaura stock simple cuando una comanda es cancelada en cocina/bar', async () => {
      const prod = await Product.create({
        id: 'prod-cancel-order',
        tenantId: 'tenant-default',
        name: 'Porción Torta Chocolate',
        category: 'Postres',
        station: 'KITCHEN',
        salePriceCOP: 12000,
        trackStock: true,
        stockUnits: 10,
        minStockUnits: 2,
        isAvailable: true
      }, db);

      // Crear comanda (descuenta a 8)
      const orderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({
          tableId: 'tab-1',
          items: [{ productId: prod.id, quantity: 2 }]
        })
      });
      assert.equal(orderRes.status, 201);
      const orderData = await orderRes.json();
      const order = orderData.orders[0];

      const prodMid = await Product.findById(prod.id, db);
      assert.equal(prodMid.stockUnits, 8);

      // Cancelar la comanda
      const cancelRes = await fetch(`${baseUrl}/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${heraToken}`
        },
        body: JSON.stringify({ status: 'CANCELLED' })
      });
      assert.equal(cancelRes.status, 200);

      // Verificar stock restaurado a 10
      const prodFinal = await Product.findById(prod.id, db);
      assert.equal(prodFinal.stockUnits, 10, 'El stock debió restaurarse tras cancelar la orden');
    });

    test('Si el tenant tiene el módulo inventory desactivado, NO bloquea por stock', async () => {
      // tenant-express tiene inventory: false
      const prod = await Product.create({
        id: 'prod-no-inv-check',
        tenantId: 'tenant-express',
        name: 'Arepa de Queso Express',
        category: 'Panadería',
        station: 'KITCHEN',
        salePriceCOP: 4000,
        trackStock: true,
        stockUnits: 0, // Stock en cero
        minStockUnits: 5,
        isAvailable: true
      }, db);

      const res = await fetch(`${baseUrl}/api/billing/express-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expressToken}`
        },
        body: JSON.stringify({
          items: [{ productId: prod.id, quantity: 3, unitPriceCOP: 4000 }],
          paymentMethod: 'CASH',
          cashReceivedCOP: 20000
        })
      });

      // Debe completarse con 201 porque el módulo inventory no está habilitado para este tenant
      assert.equal(res.status, 201);
    });
  });
});
