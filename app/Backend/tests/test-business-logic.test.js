process.env.NODE_ENV = 'test';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { getDatabase } = require('../src/config/database');
const { seedDatabase } = require('../src/db/seed');
const Product = require('../src/models/Product');
const Ingredient = require('../src/models/Ingredient');
const Table = require('../src/models/Table');
const Session = require('../src/models/Session');
const Order = require('../src/models/Order');
const ShiftAudit = require('../src/models/ShiftAudit');
const Waste = require('../src/models/Waste');

const {
  calculateCOPInvoice,
  splitBillEqual,
  splitBillByItems
} = require('../src/services/billingService');

const {
  deductRecipeStock,
  registerWaste
} = require('../src/services/inventoryService');

const http = require('node:http');
const { routeOrderItems } = require('../src/services/routingService');
const eventService = require('../src/services/eventService');
const OrderController = require('../src/controllers/orderController');
const InventoryController = require('../src/controllers/inventoryController');
const app = require('../src/index');

describe('SISTEMA DE COMANDAS SAAS - SUITE DE PRUEBAS DE LÓGICA DE NEGOCIO Y PERSISTENCIA', () => {
  let db;

  beforeEach(async () => {
    // Usar base de datos en memoria para aislamiento estricto por prueba
    db = getDatabase(':memory:');
    await seedDatabase(db, { silent: true });
    eventService.clearClients();
  });

  // =========================================================================
  // 1. FACTURACIÓN Y NORMAS FISCALES COLOMBIANAS (IMPOCONSUMO 8% Y PROPINA 10%)
  // =========================================================================
  describe('1. Facturación COP, Impoconsumo 8% y Propina 10%', () => {
    test('Calcula subtotal, 8% Impoconsumo y 10% propina con redondeo exacto en COP', () => {
      const items = [
        { productId: 'prod-punta-anca', productName: 'Punta de Anca 350g', quantity: 2, unitPriceCOP: 54000 },
        { productId: 'prod-mojito', productName: 'Cóctel Mojito Clásico', quantity: 2, unitPriceCOP: 32000 }
      ];

      // Subtotal = (54000 * 2) + (32000 * 2) = 108000 + 64000 = 172000 COP
      const invoice = calculateCOPInvoice(items, true);

      assert.equal(invoice.subtotalCOP, 172000, 'El subtotal debe ser $172.000 COP');
      assert.equal(invoice.impoconsumoRate, 0.08, 'Impoconsumo debe ser 8%');
      assert.equal(invoice.impoconsumoCOP, 13760, 'Impoconsumo (8% de 172.000) debe ser $13.760 COP');
      assert.equal(invoice.ivaRate, 0.0, 'IVA debe ser 0%');
      assert.equal(invoice.ivaCOP, 0, 'IVA en COP debe ser $0');
      assert.equal(invoice.tipRate, 0.10, 'Propina debe ser 10%');
      assert.equal(invoice.tipCOP, 17200, 'Propina (10% de 172.000) debe ser $17.200 COP');

      // Total = 172000 + 13760 + 17200 = 202960 COP
      assert.equal(invoice.totalCOP, 202960, 'Total a pagar debe ser $202.960 COP');
      assert.equal(invoice.itemsCount, 4, 'Total de ítems debe ser 4');
    });

    test('Calcula factura correctamente cuando el cliente declina la propina voluntaria', () => {
      const items = [
        { productId: 'prod-picada-criolla', productName: 'Picada Criolla', quantity: 1, unitPriceCOP: 68000 }
      ];

      const invoice = calculateCOPInvoice(items, false);

      assert.equal(invoice.subtotalCOP, 68000);
      assert.equal(invoice.impoconsumoCOP, 5440); // 8% de 68.000
      assert.equal(invoice.tipRate, 0.0);
      assert.equal(invoice.tipCOP, 0);
      assert.equal(invoice.totalCOP, 73440); // 68000 + 5440
    });

    test('Maneja listas vacías de ítems devolviendo valores en cero', () => {
      const invoice = calculateCOPInvoice([]);
      assert.equal(invoice.subtotalCOP, 0);
      assert.equal(invoice.totalCOP, 0);
      assert.equal(invoice.itemsCount, 0);
    });
  });

  // =========================================================================
  // 2. DIVISIÓN DE CUENTAS EQUITATIVA (SPLIT EQUAL SIN PÉRDIDA DE PESOS)
  // =========================================================================
  describe('2. División de Cuentas Equitativa (Exactitud Matemática Cero Pérdida)', () => {
    test('Divide $100.000 COP entre 3 partes sin perder un solo peso', () => {
      const total = 100000;
      const parts = 3;
      const splits = splitBillEqual(total, parts);

      assert.equal(splits.length, 3);
      assert.equal(splits[0].amountCOP, 33334, 'Parte 1 absorbe el peso residual');
      assert.equal(splits[1].amountCOP, 33333);
      assert.equal(splits[2].amountCOP, 33333);

      const sum = splits.reduce((acc, curr) => acc + curr.amountCOP, 0);
      assert.equal(sum, total, 'La suma de las partes debe ser idéntica al total ($100.000 COP)');
    });

    test('Divide $77.777 COP entre 7 partes exactamente', () => {
      const total = 77777;
      const parts = 7;
      const splits = splitBillEqual(total, parts);

      assert.equal(splits.length, 7);
      const sum = splits.reduce((acc, curr) => acc + curr.amountCOP, 0);
      assert.equal(sum, total, 'La suma debe ser exactamente 77.777 COP');
    });

    test('Divide $250.555 COP entre 4 partes con ajuste de residuo', () => {
      const total = 250555;
      const parts = 4;
      const splits = splitBillEqual(total, parts);

      assert.equal(splits.length, 4);
      const sum = splits.reduce((acc, curr) => acc + curr.amountCOP, 0);
      assert.equal(sum, total);
    });

    test('Lanza error si el número de partes es inválido', () => {
      assert.throws(() => splitBillEqual(10000, 0), /mayor a 0/);
      assert.throws(() => splitBillEqual(10000, -2), /mayor a 0/);
      assert.throws(() => splitBillEqual(-500, 2), /número positivo/);
    });
  });

  // =========================================================================
  // 3. DIVISIÓN DE CUENTAS POR ÍTEMS
  // =========================================================================
  describe('3. División de Cuentas por Ítems', () => {
    test('Calcula subcuentas individuales y valida integridad respecto a comanda maestra', () => {
      const masterItems = [
        { productId: 'prod-punta-anca', productName: 'Punta de Anca', quantity: 1, unitPriceCOP: 54000 },
        { productId: 'prod-mojito', productName: 'Mojito', quantity: 1, unitPriceCOP: 32000 },
        { productId: 'prod-gin-tonic', productName: 'Gin Tonic', quantity: 1, unitPriceCOP: 38000 }
      ];

      const subAccounts = [
        {
          subAccountId: 'sub-1',
          dinerName: 'Comensal A',
          items: [
            { productId: 'prod-punta-anca', productName: 'Punta de Anca', quantity: 1, unitPriceCOP: 54000 },
            { productId: 'prod-mojito', productName: 'Mojito', quantity: 1, unitPriceCOP: 32000 }
          ]
        },
        {
          subAccountId: 'sub-2',
          dinerName: 'Comensal B',
          items: [
            { productId: 'prod-gin-tonic', productName: 'Gin Tonic', quantity: 1, unitPriceCOP: 38000 }
          ]
        }
      ];

      const result = splitBillByItems(subAccounts, masterItems, true);

      assert.equal(result.subAccountInvoices.length, 2);

      // Subcuenta 1: 54000 + 32000 = 86000 subtotal
      const sub1 = result.subAccountInvoices[0];
      assert.equal(sub1.subtotalCOP, 86000);
      assert.equal(sub1.impoconsumoCOP, 6880); // 8%
      assert.equal(sub1.tipCOP, 8600); // 10%
      assert.equal(sub1.totalCOP, 101480);

      // Subcuenta 2: 38000 subtotal
      const sub2 = result.subAccountInvoices[1];
      assert.equal(sub2.subtotalCOP, 38000);
      assert.equal(sub2.impoconsumoCOP, 3040); // 8%
      assert.equal(sub2.tipCOP, 3800); // 10%
      assert.equal(sub2.totalCOP, 44840);

      // Resumen acumulado
      assert.equal(result.summary.subtotalCOP, 124000);
      assert.equal(result.summary.impoconsumoCOP, 9920);
      assert.equal(result.summary.tipCOP, 12400);
      assert.equal(result.summary.totalCOP, 146320);
    });

    test('Lanza error si los ítems asignados no coinciden con la orden maestra', () => {
      const masterItems = [
        { productId: 'prod-punta-anca', quantity: 2, unitPriceCOP: 54000 }
      ];

      const subAccounts = [
        {
          subAccountId: 'sub-1',
          items: [
            { productId: 'prod-punta-anca', quantity: 1, unitPriceCOP: 54000 }
            // Falta 1 unidad asignada
          ]
        }
      ];

      assert.throws(
        () => splitBillByItems(subAccounts, masterItems, true),
        /Discrepancia en división por ítems/
      );
    });
  });

  // =========================================================================
  // 4. DEDUCCIÓN DE STOCK POR ESCANDALLO Y ALERTAS DE STOCK MÍNIMO
  // =========================================================================
  describe('4. Deducción de Stock por Escandallo/Receta y Alertas', () => {
    test('Descuenta mililitros y gramos exactos al pedir Cóctel Mojito y Punta de Anca', async () => {
      // Insumo Ron Medellín inicial: 3000 ml
      // Insumo Jarabe de goma inicial: 2000 ml
      // Insumo Punta de anca inicial: 7000 g
      // Insumo Arepas inicial: 100 unidades

      const orderItems = [
        { productId: 'prod-mojito', quantity: 2 }, // 2 Mojitos: 120ml ron, 60ml jarabe, 20g menta, 2 limones, 300g hielo, 180ml tónica
        { productId: 'prod-punta-anca', quantity: 2 } // 2 Punta de anca: 700g carne, 300g papa criolla, 2 arepas
      ];

      const result = await deductRecipeStock(orderItems, db);

      assert.equal(result.success, true);
      assert(result.deductions.length > 0);

      // Validar Ron Medellín
      const ron = await Ingredient.findById('ing-ron-medellin', db);
      assert.equal(ron.currentStock, 3000 - 120, 'Ron Medellín debe quedar en 2880 ml');

      // Validar Jarabe
      const jarabe = await Ingredient.findById('ing-jarabe', db);
      assert.equal(jarabe.currentStock, 2000 - 60, 'Jarabe debe quedar en 1940 ml');

      // Validar Carne
      const carne = await Ingredient.findById('ing-punta-anca', db);
      assert.equal(carne.currentStock, 7000 - 700, 'Punta de anca debe quedar en 6300 g');

      // Validar Arepas
      const arepas = await Ingredient.findById('ing-arepas', db);
      assert.equal(arepas.currentStock, 100 - 2, 'Arepas deben quedar en 98 unidades');
    });

    test('Dispara alerta de stock mínimo cuando un insumo cae en o bajo el umbral crítico', async () => {
      // Stock inicial Limón Tahití: 80 unidades, minStock: 20
      // Reducimos el stock inicial de limón a 22 para probar la alerta
      await Ingredient.updateStock('ing-limon', 22, db);

      // Un mojito usa 1 limón, un gin tonic usa 1 limón. Total pedido: 4 mojitos (4 limones)
      // Stock nuevo: 22 - 4 = 18 <= minStock (20) -> Debe disparar alerta
      const orderItems = [
        { productId: 'prod-mojito', quantity: 4 }
      ];

      const result = await deductRecipeStock(orderItems, db);
      const limonAlert = result.lowStockAlerts.find(a => a.ingredientId === 'ing-limon');

      assert(limonAlert !== undefined, 'Debe generarse una alerta para el limón');
      assert.equal(limonAlert.currentStock, 18);
      assert.equal(limonAlert.minStock, 20);
      assert(limonAlert.message.includes('ALERTA DE STOCK'));
    });
  });

  // =========================================================================
  // 5. ENRUTAMIENTO DE COMANDAS (COCINA VS BAR)
  // =========================================================================
  describe('5. Enrutamiento Automático de Ítems (Cocina vs Bar)', () => {
    test('Separa automáticamente productos de Bar y Cocina según catálogo', async () => {
      const orderItems = [
        { productId: 'prod-mojito', productName: 'Mojito', quantity: 2 },
        { productId: 'prod-punta-anca', productName: 'Punta de Anca', quantity: 1 },
        { productId: 'prod-cerveza-club', productName: 'Club Colombia', quantity: 3 },
        { productId: 'prod-alitas-bbq', productName: 'Alitas BBQ', quantity: 1 }
      ];

      const { kitchen, bar } = await routeOrderItems(orderItems, db);

      assert.equal(kitchen.length, 2, 'Cocina debe recibir 2 ítems');
      assert.equal(bar.length, 2, 'Bar debe recibir 2 ítems');

      const kitchenProductIds = kitchen.map(k => k.productId);
      const barProductIds = bar.map(b => b.productId);

      assert(kitchenProductIds.includes('prod-punta-anca'));
      assert(kitchenProductIds.includes('prod-alitas-bbq'));
      assert(barProductIds.includes('prod-mojito'));
      assert(barProductIds.includes('prod-cerveza-club'));
    });
  });

  // =========================================================================
  // 6. CIERRE CIEGO Y AUDITORÍA DE TURNO
  // =========================================================================
  describe('6. Cierre Ciego y Conciliación de Medios de Pago', () => {
    test('Calcula discrepancias reales vs declaradas a ciegas (efectivo, datáfono, transferencias)', async () => {
      const shift = await ShiftAudit.openShift({
        id: 'shift-test-1',
        shiftNumber: 1,
        cashierId: 'caj-01',
        cashierName: 'Carlos Gómez'
      }, db);

      assert.equal(shift.status, 'OPEN');

      // Crear sesión y factura pagada durante el turno
      await Session.create({
        id: 'sess-shift-1',
        tableId: 'tab-1',
        waiterId: 'waiter-1',
        waiterName: 'Juan Pérez'
      }, db);

      const dbInstance = db;
      // Registrar pagos en base de datos con sintaxis $1, $2...
      await dbInstance.query(`
        INSERT INTO invoices (
          id, sessionId, tableId, subtotalCOP, impoconsumoRate, impoconsumoCOP,
          ivaRate, ivaCOP, tipRate, tipCOP, totalCOP, splitType, status, createdAt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, ['inv-1', 'sess-shift-1', 'tab-1', 100000, 0.08, 8000, 0, 0, 0.10, 10000, 118000, 'SINGLE', 'PAID', new Date().toISOString()]);

      await dbInstance.query(`
        INSERT INTO invoice_payments (id, invoiceId, method, amountCOP, createdAt)
        VALUES
          ($1, $2, $3, $4, $5),
          ($6, $7, $8, $9, $10),
          ($11, $12, $13, $14, $15)
      `, [
        'p-1', 'inv-1', 'CASH', 50000, new Date().toISOString(),
        'p-2', 'inv-1', 'CARD', 48000, new Date().toISOString(),
        'p-3', 'inv-1', 'NEQUI', 20000, new Date().toISOString()
      ]);

      // Cajero declara a ciegas:
      // Efectivo: 50.000 (exacto)
      // Datáfono: 50.000 ($2.000 sobrante)
      // Nequi/Transfers: 18.000 ($2.000 faltante)
      const closedShift = await ShiftAudit.performBlindClose(shift.id, {
        declaredCashCOP: 50000,
        declaredCardCOP: 50000,
        declaredTransfersCOP: 18000
      }, 'Cierre turno noche', db);

      assert.equal(closedShift.status, 'CLOSED');
      assert.equal(closedShift.systemCashCOP, 50000);
      assert.equal(closedShift.systemCardCOP, 48000);
      assert.equal(closedShift.systemTransfersCOP, 20000);

      // Discrepancias
      assert.equal(closedShift.discrepancyCashCOP, 0, 'Efectivo cuadrado');
      assert.equal(closedShift.discrepancyCardCOP, 2000, 'Datáfono con $2.000 sobrante');
      assert.equal(closedShift.discrepancyTransfersCOP, -2000, 'Transferencia con $2.000 faltante');
      assert.equal(closedShift.totalDiscrepancyCOP, 0, 'Total neto equilibrado');
    });
  });

  // =========================================================================
  // 7. MERMAS, ROTURAS Y CORTESÍAS
  // =========================================================================
  describe('7. Registro de Mermas y Absorción de Costos', () => {
    test('Registra merma de insumo y deduce stock calculando costo contable', async () => {
      // Tanqueray costo unitario = $120 COP por ml. Stock inicial = 2250 ml.
      // Se derrama media botella (375 ml)
      const initialStock = (await Ingredient.findById('ing-tanqueray', db)).currentStock;

      const waste = await registerWaste({
        ingredientId: 'ing-tanqueray',
        quantity: 375,
        unit: 'ML',
        type: 'WASTE',
        reason: 'Botella rota accidentalmente en barra',
        authorizedBy: 'Admin Barra'
      }, db);

      assert.equal(waste.totalCostCOP, 375 * 120, 'Costo absorbido: $45.000 COP');

      const updatedStock = (await Ingredient.findById('ing-tanqueray', db)).currentStock;
      assert.equal(updatedStock, initialStock - 375);
    });

    test('Registra cortesía de producto terminando y deduciendo insumos por escandallo', async () => {
      // Cortesía de 1 Cóctel Mojito
      const initialRon = (await Ingredient.findById('ing-ron-medellin', db)).currentStock;

      const waste = await registerWaste({
        productId: 'prod-mojito',
        quantity: 1,
        unit: 'UNIT',
        type: 'COURTESY',
        reason: 'Cortesía de fidelización cliente VIP',
        authorizedBy: 'Gerente'
      }, db);

      assert(waste.totalCostCOP > 0, 'Debe computar el costo de la receta');
      const updatedRon = (await Ingredient.findById('ing-ron-medellin', db)).currentStock;
      assert.equal(updatedRon, initialRon - 60, 'Debe descontar los 60ml de ron de la receta');
    });
  });

  // =========================================================================
  // 8. SERVICIO DE EVENTOS EN TIEMPO REAL (SSE - SERVER-SENT EVENTS)
  // =========================================================================
  describe('8. Eventos en Tiempo Real (SSE) y Notificaciones de Estado', () => {
    test('Registra cliente SSE, emite tramas con formato estándar y desuscribe al cerrar conexión', () => {
      const { EventEmitter } = require('events');
      const mockRes = new EventEmitter();
      const chunks = [];
      mockRes.write = (data) => chunks.push(data);

      const clientId = eventService.addClient(mockRes);
      assert.equal(typeof clientId, 'string');
      assert.equal(eventService.getClientCount(), 1);
      assert(chunks[0].includes(': connected'));

      // Emitir evento
      eventService.broadcast('ORDER_CREATED', { orderId: 'ord-test-1', station: 'KITCHEN' });
      assert(chunks.length >= 2);
      const ssePayload = chunks[chunks.length - 1];
      assert(ssePayload.includes('event: ORDER_CREATED\n'));
      assert(ssePayload.includes('data: {"orderId":"ord-test-1","station":"KITCHEN"}\n\n'));

      // Desconexión del cliente
      mockRes.emit('close');
      assert.equal(eventService.getClientCount(), 0);
    });

    test('Table.updateStatus emite TABLE_STATUS_CHANGED vía eventService', async () => {
      let receivedEvent = null;
      const handler = (data) => {
        receivedEvent = data;
      };
      eventService.on('TABLE_STATUS_CHANGED', handler);

      const updated = await Table.updateStatus('tab-1', 'OCCUPIED', 'sess-xyz', db);

      assert.equal(updated.status, 'OCCUPIED');
      assert.equal(updated.currentSessionId, 'sess-xyz');
      assert(receivedEvent !== null, 'Debe emitirse TABLE_STATUS_CHANGED');
      assert.equal(receivedEvent.id, 'tab-1');
      assert.equal(receivedEvent.status, 'OCCUPIED');

      eventService.off('TABLE_STATUS_CHANGED', handler);
    });

    test('OrderController.createOrder emite ORDER_CREATED y STOCK_ALERT cuando corresponde', async () => {
      // Crear sesión previa para cumplir la restricción de clave foránea
      await Session.create({
        id: 'sess-realtime',
        tableId: 'tab-1',
        waiterId: 'waiter-1',
        waiterName: 'Carlos',
        dinerCount: 2
      }, db);

      // Disminuir limón para forzar STOCK_ALERT
      await Ingredient.updateStock('ing-limon', 21, db);

      const createdEvents = [];
      const stockAlertEvents = [];

      const orderCreatedHandler = (order) => createdEvents.push(order);
      const stockAlertHandler = (alert) => stockAlertEvents.push(alert);

      eventService.on('ORDER_CREATED', orderCreatedHandler);
      eventService.on('STOCK_ALERT', stockAlertHandler);

      const req = {
        db,
        body: {
          sessionId: 'sess-realtime',
          tableId: 'tab-1',
          waiterId: 'waiter-1',
          items: [
            { productId: 'prod-mojito', quantity: 2, unitPriceCOP: 32000 },
            { productId: 'prod-punta-anca', quantity: 1, unitPriceCOP: 54000 }
          ]
        }
      };

      let responseStatus = 200;
      let responseBody = null;
      const res = {
        status(code) {
          responseStatus = code;
          return this;
        },
        json(data) {
          responseBody = data;
          return this;
        }
      };

      await OrderController.createOrder(req, res);

      assert.equal(responseStatus, 201);
      assert.equal(responseBody.success, true);
      assert(createdEvents.length > 0, 'Debe emitir ORDER_CREATED para las comandas');

      // Limón cayó de 21 - 2 = 19 <= 20 (minStock)
      assert(stockAlertEvents.length > 0, 'Debe emitir STOCK_ALERT para insumo crítico');
      assert.equal(stockAlertEvents[0].ingredientId, 'ing-limon');

      eventService.off('ORDER_CREATED', orderCreatedHandler);
      eventService.off('STOCK_ALERT', stockAlertHandler);
    });

    test('OrderController.updateStatus emite ORDER_STATUS_CHANGED', async () => {
      // Crear sesión previa para la orden
      const session = await Session.create({
        id: 'sess-status',
        tableId: 'tab-1',
        waiterId: 'waiter-1',
        waiterName: 'Carlos',
        dinerCount: 2
      }, db);

      // Crear orden base en la db
      const order = await Order.create({
        id: `ord-status-test-${Date.now()}`,
        sessionId: session.id,
        tableId: 'tab-1',
        waiterId: 'waiter-1',
        station: 'KITCHEN',
        status: 'PENDING',
        items: []
      }, db);

      let statusChangedEvent = null;
      const handler = (data) => {
        statusChangedEvent = data;
      };
      eventService.on('ORDER_STATUS_CHANGED', handler);

      const req = {
        db,
        params: { id: order.id },
        body: { status: 'READY' }
      };

      let responseBody = null;
      const res = {
        status(code) { return this; },
        json(data) {
          responseBody = data;
          return this;
        }
      };

      await OrderController.updateStatus(req, res);

      assert(responseBody !== null);
      assert.equal(responseBody.status, 'READY');
      assert(statusChangedEvent !== null, 'Debe emitir ORDER_STATUS_CHANGED');
      assert.equal(statusChangedEvent.id, order.id);
      assert.equal(statusChangedEvent.status, 'READY');

      eventService.off('ORDER_STATUS_CHANGED', handler);
    });

    test('Endpoint GET /api/events responde con cabeceras SSE (text/event-stream, no-cache, keep-alive)', async () => {
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/events`, (res) => {
          assert.equal(res.statusCode, 200);
          assert.equal(res.headers['content-type'], 'text/event-stream');
          assert.equal(res.headers['cache-control'], 'no-cache');
          assert.equal(res.headers['connection'], 'keep-alive');

          res.on('data', (chunk) => {
            const str = chunk.toString();
            if (str.includes(': connected')) {
              req.destroy();
              server.close(() => resolve());
            }
          });
        });

        req.on('error', (err) => {
          server.close(() => reject(err));
        });
      });
    });
  });

  // =========================================================================
  // 9. COLA KDS Y FILTRADO POR ESTACIÓN/ESTADO (BUG-005)
  // =========================================================================
  describe('9. Cola KDS y Filtrado por Estación y Estado (BUG-005)', () => {
    test('Order.findByStationAndStatus con station="ALL" y sin status devuelve toda la cola activa (PENDING, IN_PREP, READY) de ambas estaciones', async () => {
      // Crear sesión base
      await Session.create({
        id: 'sess-kds-test',
        tableId: 'tab-1',
        waiterId: 'waiter-1',
        waiterName: 'Laura'
      }, db);

      // Crear órdenes en diferentes estaciones y estados
      await Order.create({ id: 'ord-k1', sessionId: 'sess-kds-test', tableId: 'tab-1', waiterId: 'waiter-1', station: 'KITCHEN', status: 'PENDING', items: [] }, db);
      await Order.create({ id: 'ord-k2', sessionId: 'sess-kds-test', tableId: 'tab-1', waiterId: 'waiter-1', station: 'KITCHEN', status: 'IN_PREP', items: [] }, db);
      await Order.create({ id: 'ord-b1', sessionId: 'sess-kds-test', tableId: 'tab-1', waiterId: 'waiter-1', station: 'BAR', status: 'READY', items: [] }, db);
      await Order.create({ id: 'ord-b2', sessionId: 'sess-kds-test', tableId: 'tab-1', waiterId: 'waiter-1', station: 'BAR', status: 'SERVED', items: [] }, db);

      // station === 'ALL', status no especificado
      const activeAll = await Order.findByStationAndStatus('ALL', undefined, db);
      const activeIds = activeAll.map(o => o.id);

      assert.equal(activeAll.length, 3, 'Debe devolver las 3 órdenes activas (PENDING, IN_PREP, READY)');
      assert(activeIds.includes('ord-k1'), 'Debe incluir KITCHEN PENDING');
      assert(activeIds.includes('ord-k2'), 'Debe incluir KITCHEN IN_PREP');
      assert(activeIds.includes('ord-b1'), 'Debe incluir BAR READY');
      assert(!activeIds.includes('ord-b2'), 'No debe incluir BAR SERVED');
    });

    test('Order.findByStationAndStatus sin station y con status="ACTIVE" devuelve cola activa KITCHEN y BAR', async () => {
      await Session.create({
        id: 'sess-kds-test-2',
        tableId: 'tab-1',
        waiterId: 'waiter-1',
        waiterName: 'Laura'
      }, db);

      await Order.create({ id: 'ord-k3', sessionId: 'sess-kds-test-2', tableId: 'tab-1', waiterId: 'waiter-1', station: 'KITCHEN', status: 'PENDING', items: [] }, db);
      await Order.create({ id: 'ord-b3', sessionId: 'sess-kds-test-2', tableId: 'tab-1', waiterId: 'waiter-1', station: 'BAR', status: 'IN_PREP', items: [] }, db);
      await Order.create({ id: 'ord-b4', sessionId: 'sess-kds-test-2', tableId: 'tab-1', waiterId: 'waiter-1', station: 'BAR', status: 'SERVED', items: [] }, db);

      const activeOrders = await Order.findByStationAndStatus(undefined, 'ACTIVE', db);
      const ids = activeOrders.map(o => o.id);

      assert.equal(activeOrders.length, 2);
      assert(ids.includes('ord-k3'));
      assert(ids.includes('ord-b3'));
      assert(!ids.includes('ord-b4'));
    });

    test('Order.findByStationAndStatus con estación específica filtra correctamente', async () => {
      await Session.create({
        id: 'sess-kds-test-3',
        tableId: 'tab-1',
        waiterId: 'waiter-1',
        waiterName: 'Laura'
      }, db);

      await Order.create({ id: 'ord-k4', sessionId: 'sess-kds-test-3', tableId: 'tab-1', waiterId: 'waiter-1', station: 'KITCHEN', status: 'PENDING', items: [] }, db);
      await Order.create({ id: 'ord-b5', sessionId: 'sess-kds-test-3', tableId: 'tab-1', waiterId: 'waiter-1', station: 'BAR', status: 'PENDING', items: [] }, db);

      const kitchenOnly = await Order.findByStationAndStatus('KITCHEN', 'ACTIVE', db);
      assert.equal(kitchenOnly.length, 1);
      assert.equal(kitchenOnly[0].id, 'ord-k4');

      const barPending = await Order.findByStationAndStatus('BAR', 'PENDING', db);
      assert.equal(barPending.length, 1);
      assert.equal(barPending[0].id, 'ord-b5');
    });

    test('OrderController.getStationOrders maneja station="ALL" y sin status devolviendo cola activa', async () => {
      await Session.create({
        id: 'sess-kds-ctrl',
        tableId: 'tab-2',
        waiterId: 'waiter-1',
        waiterName: 'Laura'
      }, db);

      await Order.create({ id: 'ord-ctrl-1', sessionId: 'sess-kds-ctrl', tableId: 'tab-2', waiterId: 'waiter-1', station: 'KITCHEN', status: 'PENDING', items: [] }, db);
      await Order.create({ id: 'ord-ctrl-2', sessionId: 'sess-kds-ctrl', tableId: 'tab-2', waiterId: 'waiter-1', station: 'BAR', status: 'IN_PREP', items: [] }, db);
      await Order.create({ id: 'ord-ctrl-3', sessionId: 'sess-kds-ctrl', tableId: 'tab-2', waiterId: 'waiter-1', station: 'KITCHEN', status: 'SERVED', items: [] }, db);

      // Simular req/res con station = 'ALL' y sin status
      const reqAll = { db, query: { station: 'ALL' } };
      let jsonResult = null;
      const res = {
        json(data) {
          jsonResult = data;
          return this;
        }
      };

      await OrderController.getStationOrders(reqAll, res);
      assert(Array.isArray(jsonResult));
      assert.equal(jsonResult.length, 2);
      const ids = jsonResult.map(o => o.id);
      assert(ids.includes('ord-ctrl-1'));
      assert(ids.includes('ord-ctrl-2'));
      assert(!ids.includes('ord-ctrl-3'));

      // Simular req/res sin parámetros de query (query vacía {})
      const reqEmpty = { db, query: {} };
      let jsonResultEmpty = null;
      const resEmpty = {
        json(data) {
          jsonResultEmpty = data;
          return this;
        }
      };

      await OrderController.getStationOrders(reqEmpty, resEmpty);
      assert(Array.isArray(jsonResultEmpty));
      assert.equal(jsonResultEmpty.length, 2);
    });
  });

  // =========================================================================
  // 10. GESTIÓN DE MESAS Y VALIDACIÓN DE ELIMINACIÓN (deleteTable)
  // =========================================================================
  describe('10. Gestión de Mesas y Validación de Eliminación (deleteTable)', () => {
    const createMockRes = () => {
      const mock = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        }
      };
      return mock;
    };

    test('Retorna 404 si la mesa a eliminar no existe', async () => {
      const req = { db, params: { id: 'mesa-inexistente' } };
      const res = createMockRes();

      await InventoryController.deleteTable(req, res);

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Mesa no encontrada');
    });

    test('Retorna 409 y mensaje de error si la mesa está en estado OCCUPIED', async () => {
      await Table.create({
        id: 'tab-test-occupied',
        number: 901,
        zone: 'TERRAZA',
        capacity: 4,
        status: 'OCCUPIED'
      }, db);

      const req = { db, params: { id: 'tab-test-occupied' } };
      const res = createMockRes();

      await InventoryController.deleteTable(req, res);

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.message, 'No se puede eliminar una mesa ocupada o en proceso de pago');
      assert.equal(res.body.error, 'No se puede eliminar una mesa ocupada o en proceso de pago');

      // Verificar que la mesa NO haya sido eliminada
      const tableStillExists = await Table.findById('tab-test-occupied', db);
      assert(tableStillExists !== null);
    });

    test('Retorna 409 y mensaje de error si la mesa está en estado PAYING', async () => {
      await Table.create({
        id: 'tab-test-paying',
        number: 902,
        zone: 'SALON',
        capacity: 4,
        status: 'PAYING'
      }, db);

      const req = { db, params: { id: 'tab-test-paying' } };
      const res = createMockRes();

      await InventoryController.deleteTable(req, res);

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.message, 'No se puede eliminar una mesa ocupada o en proceso de pago');
      assert.equal(res.body.error, 'No se puede eliminar una mesa ocupada o en proceso de pago');

      // Verificar que la mesa NO haya sido eliminada
      const tableStillExists = await Table.findById('tab-test-paying', db);
      assert(tableStillExists !== null);
    });

    test('Elimina correctamente la mesa si su estado es AVAILABLE y responde 200', async () => {
      await Table.create({
        id: 'tab-test-available',
        number: 903,
        zone: 'VIP',
        capacity: 6,
        status: 'AVAILABLE'
      }, db);

      const req = { db, params: { id: 'tab-test-available' } };
      const res = createMockRes();

      await InventoryController.deleteTable(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.message, 'Mesa eliminada correctamente');
      assert.equal(res.body.id, 'tab-test-available');

      // Verificar que la mesa fue eliminada
      const deletedTable = await Table.findById('tab-test-available', db);
      assert.equal(deletedTable, null);
    });
  });

  // =========================================================================
  // 11. COMPATIBILIDAD CON COLUMNAS EN MINÚSCULAS DE POSTGRESQL / SUPABASE
  // =========================================================================
  describe('11. Mapeo de Columnas en Minúsculas desde PostgreSQL / Supabase', () => {
    test('Product preserva salePriceCOP e isAvailable cuando PostgreSQL devuelve columnas en minúsculas', () => {
      // PostgreSQL (node-postgres) devuelve NUMERIC como string y nombres de columnas sin comillas en minúsculas
      const pgAvailableRow = {
        id: 'prod-pg-1',
        name: 'Hamburguesa Artesanal',
        category: 'Carnes',
        station: 'KITCHEN',
        salepricecop: '35000.00',
        isavailable: true
      };
      const prod1 = new Product(pgAvailableRow);
      assert.equal(prod1.salePriceCOP, 35000);
      assert.equal(prod1.isAvailable, true);

      const pgUnavailableRow = {
        id: 'prod-pg-2',
        name: 'Limonada de Coco',
        category: 'Bebidas',
        station: 'BAR',
        salepricecop: '14000.00',
        isavailable: false
      };
      const prod2 = new Product(pgUnavailableRow);
      assert.equal(prod2.salePriceCOP, 14000);
      assert.equal(prod2.isAvailable, false);
    });

    test('Ingredient y Table preservan valores cuando PostgreSQL devuelve columnas en minúsculas', () => {
      const ing = new Ingredient({
        id: 'ing-pg-1',
        name: 'Ron Añejo',
        unit: 'ML',
        currentstock: 1500,
        minstock: 300,
        costperunitcop: '65.00'
      });
      assert.equal(ing.currentStock, 1500);
      assert.equal(ing.minStock, 300);
      assert.equal(ing.costPerUnitCOP, 65);

      const table = new Table({
        id: 'tab-pg-1',
        number: 12,
        zone: 'Terraza',
        capacity: 4,
        posx: 120,
        posy: 240,
        status: 'OCCUPIED',
        currentsessionid: 'sess-pg-12',
        lastorderat: '2026-10-31T19:00:00.000Z'
      });
      assert.equal(table.posX, 120);
      assert.equal(table.posY, 240);
      assert.equal(table.currentSessionId, 'sess-pg-12');
      assert.equal(table.lastOrderAt, '2026-10-31T19:00:00.000Z');
    });
  });
});
