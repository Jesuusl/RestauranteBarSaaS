# DIRECTIVA DE TRABAJO - FASE 1.5: SERVIDOR API REST Y TIEMPO REAL

**Para:** Agente Backend (`backend`)
**De:** Orquestador Principal
**Objetivo:** Exponer la lógica implementada mediante un servidor HTTP/REST (Express) y eventos en tiempo real (SSE o WebSockets/polling) para que el Frontend y KDS puedan operar.

---

## 🎯 Entregables Obligatorios:

1. **Instalar dependencias necesarias:**
   - En `backend`: `npm install express cors` (y cualquier middleware requerido).

2. **Crear Servidor y Rutas (`backend/src/server.js` y `backend/src/routes/`):**
   - **Mesas:**
     - `GET /api/tables`: Lista de mesas con estado (`AVAILABLE`, `OCCUPIED`, `PAYING`, etc.), zona y comanda activa si la tiene.
     - `PATCH /api/tables/:id/status`: Actualizar estado de la mesa.
     - `POST /api/tables/merge`: Fusionar mesas.
   - **Productos & Menú:**
     - `GET /api/products`: Lista de productos con categoría, estación (`KITCHEN` o `BAR`), precio en COP y receta.
     - `GET /api/categories`: Categorías.
   - **Comandas & KDS:**
     - `POST /api/orders`: Crear nueva comanda (descuenta inventario atómicamente por recetas y enruta a KITCHEN o BAR).
     - `GET /api/orders/active`: Comandas activas globales.
     - `GET /api/kds/:station`: Cola de preparación filtrada para `KITCHEN` o `BAR`.
     - `PATCH /api/kds/items/:id/status`: Actualizar estado de preparación del ítem (`PENDING`, `IN_PREP`, `READY`, `SERVED`).
   - **Facturación & División de Cuentas (COP):**
     - `GET /api/billing/preview/:orderId`: Previsualización de factura con Subtotal, Impoconsumo 8% y Propina voluntaria 10%.
     - `POST /api/billing/split`: Cálculo de división equitativa (`splitBillEqual`) o por puestos/ítems (`splitBillByItems`).
     - `POST /api/billing/checkout`: Procesar pago (Efectivo, Datáfono, Nequi, Daviplata), emitir factura y liberar mesa.
   - **Inventario, Mermas & Auditoría:**
     - `GET /api/inventory`: Insumos, stock actual en ML/GR, alertas de stock mínimo.
     - `POST /api/inventory/waste`: Registrar merma con justificación.
     - `POST /api/inventory/courtesy`: Registrar cortesía autorizada.
     - `GET /api/reports/profitability`: Margen de contribución por producto (`Precio Venta - Costo Escandallo`).
     - `POST /api/cash-register/blind-close`: Cierre de caja ciego (compara montos declarados por el cajero vs auditoría del sistema).
   - **Sincronización en Tiempo Real / Notificaciones:**
     - Implementar un endpoint SSE (`GET /api/events`) o WebSocket ligero para emitir eventos de nuevas comandas, cambios de estado en KDS y alertas de stock bajo.
   - **Healthcheck & Puerto:**
     - Correr en el puerto `3001` (o configurable vía `PORT=3001`).
     - Incluir `npm start` en `package.json` para ejecutar `node src/server.js`.

3. **Validación:**
   - Asegurar que al inicializar el servidor (`node src/seed.js` seguido de `node src/server.js`) responda con éxito a las peticiones HTTP y maneje errores con códigos HTTP adecuados.

---
**Restricción del Agente Backend:** Concéntrate estrictamente en las rutas HTTP, middlewares, controladores y serialización JSON. No toques CSS ni maquetación visual.
