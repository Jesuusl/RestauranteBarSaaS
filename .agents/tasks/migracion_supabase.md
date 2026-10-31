# DIRECTIVA DE TRABAJO - MIGRACIÓN A SUPABASE (POSTGRESQL)

**Para:** Agente Backend (`backend`)  
**De:** Orquestador Principal  
**Prioridad:** Urgente  
**Objetivo:** Migrar la capa de persistencia y base de datos de SQLite (`node:sqlite`) a PostgreSQL / Supabase, preservando al 100% la integridad de los modelos, la lógica de negocio en COP y la suite de pruebas automatizadas.

---

## 🎯 Entregables Obligatorios:

### 1. Dependencias y Variables de Entorno
- En `/home/jesuuusl/Documentos/Comanda/app/Backend`:
  - Instalar `pg` (node-postgres) y `@supabase/supabase-js`.
  - Crear archivo `.env.example` y archivo `.env` con las variables:
    ```env
    PORT=3001
    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
    SUPABASE_URL=https://your-project-id.supabase.co
    SUPABASE_ANON_KEY=your-anon-key
    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
    SUPABASE_DB_URL=postgresql://postgres.your-project-id:your-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
    ```

### 2. Configuración del Pool y Conexión (`src/config/database.js`)
- Implementar un adaptador de base de datos modular con `pg.Pool` y/o `@supabase/supabase-js`.
- El conector debe:
  - Leer la cadena de conexión desde `DATABASE_URL` o `SUPABASE_DB_URL`.
  - Soportar modo SSL para conexiones seguras con Supabase (`ssl: { rejectUnauthorized: false }`).
  - Proporcionar métodos `query(text, params)` desacoplados.
  - Para pruebas unitarias locales o cuando no haya una conexión remota activa a internet/credenciales válidas de Supabase, incorporar un modo fallback o memoria que garantice que `npm test` pueda ejecutarse de forma 100% autónoma y reproducible sin fallar.

### 3. Migración del Esquema DDL a PostgreSQL (`src/db/schema.sql`)
- Traducir `src/db/schema.sql` a sintaxis PostgreSQL estándar:
  - `TEXT` o `VARCHAR` para identificadores.
  - `NUMERIC(14, 2)` o `DOUBLE PRECISION` para valores monetarios en COP (`salePriceCOP`, `costPerUnitCOP`, `subtotalCOP`, `impoconsumoCOP`, `tipCOP`, `totalCOP`).
  - `BOOLEAN` para campos booleanos como `isAvailable`.
  - `JSONB` para `subAccounts` y `modifiers`.
  - `TIMESTAMPTZ` o `TIMESTAMP WITH TIME ZONE` para fechas.
  - Claves foráneas con `ON DELETE CASCADE` donde corresponda.
  - Creación de índices con `CREATE INDEX IF NOT EXISTS`.
  - Script `init.js` adaptado para ejecutar el DDL contra PostgreSQL.

### 4. Adaptación de Modelos de Datos (`src/models/`)
- Adaptar las consultas de los modelos (`Table`, `Session`, `Ingredient`, `Product`, `Order`, `Invoice`, `ShiftAudit`, `Waste`):
  - Usar `$1, $2, $3...` como marcadores de parámetros para PostgreSQL (en lugar de `?`).
  - Métodos asíncronos (`async/await`) en todas las operaciones de acceso a datos.

### 5. Adaptación Idempotente de Semillas (`src/db/seed.js` y `seed.js`)
- Asegurar que la inserción de datos semilla sea idempotente usando `ON CONFLICT (id) DO UPDATE` o validación previa de existencia.
- Conservar todos los insumos y recetas colombianas previamente configurados (Mojito, Gin Tonic, Punta de Anca, Picada Criolla, etc.).

### 6. Validación de la Suite de Pruebas (`npm test`)
- Adaptar `tests/test-business-logic.test.js` para soportar las llamadas asíncronas de los modelos.
- Ejecutar `npm test` y verificar que las 15 pruebas pasen con 0 errores:
  - Cálculo de Factura COP con 8% Impoconsumo y 10% Propina.
  - División de cuentas equitativa sin perder un solo peso.
  - División por ítems.
  - Deducción de stock por escandallo en ML y GR.
  - Enrutamiento cocina/bar.
  - Cierre ciego de caja y discrepancias.
  - Mermas y cortesías.

---
**Restricción:** El Agente Backend se encarga de la lógica interna, base de datos, modelos y tests. No diseñar interfaces CSS.
Reporta los archivos modificados y la salida del test al finalizar.
