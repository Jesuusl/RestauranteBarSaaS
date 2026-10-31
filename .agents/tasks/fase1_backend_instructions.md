# DIRECTIVA DE TRABAJO - FASE 1: ARQUITECTURA DE DATOS, MODELOS Y LÓGICA DE NEGOCIO (COP)

**Para:** Agente Backend (`backend`)
**De:** Orquestador Principal
**Objetivo:** Diseñar e implementar la arquitectura base del backend, esquemas de datos, persistencia, lógica de negocio y semillas para el Sistema de Comandas SaaS (Restaurante-Bar).

---

## 🎯 Entregables Obligatorios para la Fase 1

### 1. Inicialización del Proyecto Backend (Node.js)
- Estructura limpia y modular en `/home/jesuuusl/Documentos/Comanda/app/Backend`.
- Configuración de `package.json` con dependencias necesarias (ej. Express, CORS, utilidades).
- Persistencia robusta y desacoplada (usar una capa de base de datos eficiente como SQLite con sqlite3/better-sqlite3 o adaptador estructurado JSON/Lowdb/Prisma para portabilidad inmediata en el workspace).

### 2. Modelos de Datos y Esquemas
Debes implementar y documentar las entidades completas:
1. **Mesas & Zonas:**
   - ID, número, zona (Salón, Terraza, Barra), capacidad, posición en plano (x, y), estado (`AVAILABLE`, `OCCUPIED`, `RESERVED`, `PAYING`, `CLEANING`), `currentSessionId`, `lastOrderAt`.
2. **Sesiones & Cuentas:**
   - ID, `tableId`, `waiterId`, `waiterName`, `dinerCount`, `openedAt`, `closedAt`, `status` (`OPEN`, `SPLITTING`, `CLOSED`), `subAccounts` (para cuentas divididas).
3. **Insumos / Ingredientes (Stock):**
   - ID, nombre, unidad (`ML`, `GR`, `UNIT`), stock actual, stock mínimo (alerta), costo unitario en COP.
4. **Productos & Menú:**
   - ID, nombre, categoría, estación (`KITCHEN` o `BAR`), precio de venta (COP), receta/escandallo (lista de insumos requeridos con sus cantidades), disponible (`boolean`).
5. **Comandas (Órdenes) & Ítems:**
   - ID, `sessionId`, `tableId`, `waiterId`, `station` (`KITCHEN` o `BAR`), `status` (`PENDING`, `IN_PREP`, `READY`, `SERVED`), `createdAt`.
   - Ítems: `productId`, `productName`, `quantity`, `seatNumber`, `modifiers` (array de strings: ej. "Término 3/4", "Sin sal"), `notes`, `unitPriceCOP`.
6. **Facturación & División de Cuentas (Norma Colombiana COP):**
   - Subtotal neto (Base gravable).
   - **Impoconsumo (8%)**: Aplica a servicio de alimentos y bebidas en restaurantes/bares.
   - **IVA**: 0% para restaurantes bajo régimen común de Impoconsumo, o configurable.
   - **Propina voluntaria sugerida (10%)**: Calculada sobre subtotal.
   - Total a pagar en COP.
   - Desglose de pagos: Efectivo, Tarjeta/Datáfono, Nequi, Daviplata.
   - Registro de divisiones (igualitaria $N$ partes o por ítems específicos).
7. **Cierre Ciego & Auditoría de Turno:**
   - Turno, cajero, fecha de apertura/cierre, montos declarados a ciegas (efectivo, datáfono, transferencias), montos reales del sistema, discrepancia (faltante/sobrante).
8. **Mermas, Roturas y Cortesías:**
   - ID, `productId`/`ingredientId`, cantidad, tipo (`WASTE`, `COURTESY`, `STAFF_MEAL`), motivo, autorizado por, costo total absorbido (gasto contable).

### 3. Servicios y Controladores de Lógica de Negocio
Implementar las funciones de negocio puras y sus pruebas:
- `calculateCOPInvoice(items, includeTip = true)`: Calcula base, 8% Impoconsumo, 10% propina, redondeo comercial en COP.
- `splitBillEqual(total, parts)`: Distribuye con exactitud matemática de centavos/pesos sin descuadre.
- `splitBillByItems(subAccounts)`: Valida que la suma de subcuentas sea exactamente igual a la comanda total.
- `deductRecipeStock(orderItems)`: Valida y descuenta automáticamente los mililitros y gramos exactos en inventario; lanza alerta si entra en umbral de stock mínimo.
- `routeOrderItems(items)`: Separa automáticamente los ítems hacia la estación `KITCHEN` o `BAR`.

### 4. Datos Semilla (Seed Data)
Crear un script de inicialización (`seed.js` o `db/seed.js`) con:
- Zonas: "Salón Principal", "Terraza", "Barra VIP".
- 8 Mesas con distintas capacidades y estados.
- Insumos de bar: Ron Medellín (750ml), Aguardiente Antioqueño (750ml), Ginebra Tanqueray, Tónica, Limones, Hielo, Menta, Jarabe de goma.
- Insumos de cocina: Punta de anca (gramos), Papa criolla, Pechuga de pollo, Arepas, Queso campesino.
- Productos de Bar (Cóctel Mojito, Gin Tonic, Shot de Aguardiente, Cerveza Club Colombia) con sus recetas exactas en ML.
- Productos de Cocina (Punta de anca 350g, Picada Criolla, Alitas BBQ) con sus recetas en gramos.

### 5. Validación
Crea un script de prueba automatizada (ej. `test-business-logic.js` o `npm test`) que ejecute:
- Comprobación de que una comanda descuenta el stock por recetas.
- Comprobación de que la factura calcula Impoconsumo al 8% y propina al 10%.
- Comprobación de que la división de cuentas no pierde ni un solo peso.

---
**Restricción del Agente Backend:** Céntrate estrictamente en la arquitectura de datos, persistencia, APIs y lógica de negocio. No diseñes estilos CSS ni maquetación visual.
Reporta al finalizar los archivos creados, modelos y resultados de la validación.
