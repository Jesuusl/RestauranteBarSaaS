# Backend - Sistema de Comandas SaaS (Restaurante-Bar)

Backend modular desarrollado en **Node.js (v26)** con persistencia nativa **SQLite** (`node:sqlite`) y lógica de negocio especializada en la normativa comercial y tributaria de Colombia (COP, Impoconsumo 8%, IVA 0%, Propina sugerida 10%).

---

## 🏗️ Arquitectura del Módulo Backend

```
app/Backend/
├── comanda.sqlite            # Base de datos SQLite
├── package.json              # Configuración y scripts npm
├── seed.js                   # Script directo de siembra
├── test-business-logic.js    # Runner directo de suite de pruebas
├── src/
│   ├── index.js              # Servidor Express y APIs REST
│   ├── config/
│   │   └── database.js       # Conector SQLite desacoplado (admite :memory: y disco)
│   ├── db/
│   │   ├── schema.sql        # Esquema DDL SQLite con restricciones e índices
│   │   ├── init.js           # Inicializador de DDL
│   │   └── seed.js           # Semillas con recetas e insumos
│   ├── models/               # Modelos y acceso a datos
│   │   ├── Table.js          # Mesas, Zonas y Estados
│   │   ├── Session.js        # Sesiones de comensales y subcuentas
│   │   ├── Ingredient.js     # Insumos (Stock ML, GR, UNIT)
│   │   ├── Product.js        # Catálogo y Escandallo (Recetas)
│   │   ├── Order.js          # Comandas e ítems
│   │   ├── Invoice.js        # Facturación COP y Desglose de Pagos
│   │   ├── ShiftAudit.js     # Cierre Ciego y Auditoría de Turno
│   │   └── Waste.js          # Mermas, Roturas y Cortesías
│   ├── services/             # Controladores puros de negocio
│   │   ├── billingService.js    # Factura COP, Split Equal, Split by Items
│   │   ├── inventoryService.js  # Deducción de escandallo, alertas de stock, mermas
│   │   └── routingService.js    # Enrutamiento automático Cocina / Bar
│   └── controllers/          # Coordinadores HTTP REST
│       ├── orderController.js
│       ├── billingController.js
│       ├── inventoryController.js
│       └── shiftController.js
└── tests/
    └── test-business-logic.test.js # 15 pruebas unitarias automatizadas
```

---

## ⚖️ Normativa de Negocio Colombiana (COP)

1. **Impuesto Nacional al Consumo (Impoconsumo 8%)**:
   - Aplica al servicio de comidas y bebidas en restaurantes y bares sobre la base gravable (subtotal).
   - En régimen de Impoconsumo, el IVA es 0%.
2. **Propina Voluntaria Sugerida (10%)**:
   - Calculada sobre el subtotal neto de la comanda (configurable/opcional si el cliente no la acepta).
3. **División de Cuentas Equitativa (Split Equal)**:
   - Distribución matemática con absorción de residuos enteros en pesos COP. **Cero pérdida de pesos.**
4. **División por Ítems (Split by Items)**:
   - Validación cruzada estricta para garantizar que la suma de subcuentas equivalga exactamente a los ítems de la orden.
5. **Cierre Ciego**:
   - El cajero declara valores de Efectivo, Datáfono y Transferencias (Nequi/Daviplata) sin conocer los totales del sistema. El sistema calcula automáticamente faltantes y sobrantes.

---

## 🚀 Comandos de Ejecución

- **Instalar dependencias**:
  ```bash
  npm install
  ```
- **Inicializar base de datos**:
  ```bash
  npm run db:init
  ```
- **Poblar datos semilla**:
  ```bash
  npm run db:seed
  # o también:
  node seed.js
  ```
- **Ejecutar pruebas automatizadas**:
  ```bash
  npm test
  # o también:
  node test-business-logic.js
  ```
- **Iniciar servidor REST**:
  ```bash
  npm start
  ```
