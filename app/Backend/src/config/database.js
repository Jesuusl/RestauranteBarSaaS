const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Inicialización de cliente Supabase si las credenciales están presentes
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
let supabase = null;

if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (err) {
    console.warn('⚠️ No se pudo inicializar el cliente de Supabase:', err.message);
  }
}

/**
 * Traduce consultas con sintaxis PostgreSQL ($1, $2, etc.) a SQLite (?)
 * y sanitiza los parámetros correspondientes serializando objetos a JSON.
 */
function translatePostgresToSqlite(sql, params = []) {
  if (!params || params.length === 0) {
    return { sql, params: [] };
  }

  const reorderedParams = [];
  const translatedSql = sql.replace(/\$(\d+)/g, (_, idx) => {
    const paramIndex = parseInt(idx, 10) - 1;
    reorderedParams.push(params[paramIndex]);
    return '?';
  });

  const sanitizedParams = reorderedParams.map(p => {
    if (p === undefined) return null;
    if (p !== null && typeof p === 'object' && !(p instanceof Date) && !Buffer.isBuffer(p)) {
      return JSON.stringify(p);
    }
    return p;
  });

  return { sql: translatedSql, params: sanitizedParams };
}

/**
 * Crea un adaptador basado en SQLite (en memoria o persistente en archivo)
 * que emula la API asíncrona de PostgreSQL / pg.Pool.
 *
 * @param {string} [filePath=':memory:']
 */
function createSqliteAdapter(filePath = ':memory:') {
  const sqliteDb = new DatabaseSync(filePath);
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  const isMemory = filePath === ':memory:';

  const adapter = {
    isMemory,
    isSqlite: true,
    sqliteDb,
    async query(text, params = []) {
      const { sql, params: sanitizedParams } = translatePostgresToSqlite(text, params);
      const isSelectOrReturning = /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

      const stmt = sqliteDb.prepare(sql);
      if (isSelectOrReturning) {
        const rows = stmt.all(...sanitizedParams);
        return { rows, rowCount: rows.length };
      } else {
        const info = stmt.run(...sanitizedParams);
        return { rows: [], rowCount: info.changes };
      }
    },
    async exec(sql) {
      sqliteDb.exec(sql);
    },
    prepare(sql) {
      return {
        run: (...params) => {
          const { sql: s, params: p } = translatePostgresToSqlite(sql, params);
          return sqliteDb.prepare(s).run(...p);
        },
        all: (...params) => {
          const { sql: s, params: p } = translatePostgresToSqlite(sql, params);
          return sqliteDb.prepare(s).all(...p);
        },
        get: (...params) => {
          const { sql: s, params: p } = translatePostgresToSqlite(sql, params);
          return sqliteDb.prepare(s).get(...p);
        }
      };
    },
    async close() {
      try {
        sqliteDb.close();
      } catch (_) {}
    }
  };

  return adapter;
}

let activePool = null;
let defaultMemoryAdapter = null;

/**
 * Obtiene la conexión de base de datos activa o crea un adaptador adecuado.
 * - Si customTarget === ':memory:', retorna un adaptador aislado en memoria.
 * - Si NODE_ENV === 'test', usa adaptador en memoria para pruebas.
 * - Si hay conexión configurada a PostgreSQL / Supabase, retorna el Pool con wrapper unificado.
 * - De lo contrario en local, usa SQLite persistente en comanda.sqlite.
 *
 * @param {string} [customTarget]
 * @returns {Object} Adaptador con método query(text, params)
 */
function getDatabase(customTarget) {
  if (customTarget === ':memory:') {
    return createSqliteAdapter(':memory:');
  }

  // Si ya tenemos un pool o adaptador por defecto
  if (activePool) return activePool;
  if (defaultMemoryAdapter) return defaultMemoryAdapter;

  if (process.env.NODE_ENV === 'test') {
    defaultMemoryAdapter = createSqliteAdapter(':memory:');
    return defaultMemoryAdapter;
  }

  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const isPostgresConfigured = connectionString &&
    !connectionString.includes('your-project-id') &&
    !connectionString.includes('your-password');

  if (!isPostgresConfigured) {
    const sqlitePath = path.join(__dirname, '..', '..', 'comanda.sqlite');
    defaultMemoryAdapter = createSqliteAdapter(sqlitePath);
    return defaultMemoryAdapter;
  }

  try {
    const isSupabaseHost = connectionString.includes('supabase.com') || connectionString.includes('supabase.co');
    const poolConfig = {
      connectionString,
      ssl: isSupabaseHost || process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    };

    const pool = new Pool(poolConfig);
    activePool = {
      isPool: true,
      pool,
      async query(text, params = []) {
        if (defaultMemoryAdapter && (!activePool || pool.ended || pool._ended)) {
          return await defaultMemoryAdapter.query(text, params);
        }
        try {
          return await pool.query(text, params);
        } catch (err) {
          if (err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
            if (defaultMemoryAdapter) {
              return await defaultMemoryAdapter.query(text, params);
            }
          }
          throw err;
        }
      },
      async exec(sql) {
        return await this.query(sql);
      },
      async close() {
        await pool.end();
        activePool = null;
      }
    };

    return activePool;
  } catch (err) {
    console.warn('⚠️ Error al configurar Pool de PostgreSQL, activando modo SQLite persistente:', err.message);
    const sqlitePath = path.join(__dirname, '..', '..', 'comanda.sqlite');
    defaultMemoryAdapter = createSqliteAdapter(sqlitePath);
    return defaultMemoryAdapter;
  }
}

/**
 * Ejecuta una consulta sobre la base de datos por defecto.
 * @param {string} text
 * @param {Array} [params]
 * @returns {Promise<{rows: Array, rowCount: number}>}
 */
async function query(text, params = []) {
  const db = getDatabase();
  return await db.query(text, params);
}

/**
 * Ejecuta un bloque de operaciones dentro de una transacción ACID garantizada.
 * Soporta tanto PostgreSQL (BEGIN / COMMIT / ROLLBACK sobre pg.Pool client)
 * como SQLite (BEGIN TRANSACTION / COMMIT / ROLLBACK sobre DatabaseSync).
 * Previene transacciones anidadas si db.isTransaction ya es true.
 *
 * @param {Object|Function} customDb - Conexión de base de datos o callback
 * @param {Function} [callback] - Función asíncrona a ejecutar con txDb
 * @returns {Promise<any>}
 */
async function withTransaction(customDb, callback) {
  let db = customDb;
  let fn = callback;

  if (typeof customDb === 'function') {
    fn = customDb;
    db = getDatabase();
  } else if (!db) {
    db = getDatabase();
  }

  if (!fn || typeof fn !== 'function') {
    throw new Error('withTransaction requiere un callback de ejecución.');
  }

  // Si ya estamos dentro de una transacción, no anidar BEGIN
  if (db.isTransaction) {
    return await fn(db);
  }

  // Manejo de pg.Pool (PostgreSQL)
  if (db.isPool && db.pool) {
    let client;
    try {
      client = await db.pool.connect();
    } catch (err) {
      if (err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        console.warn('⚠️ Fallback a SQLite persistente en transacción por indisponibilidad de PostgreSQL.');
        activePool = null;
        const sqlitePath = path.join(__dirname, '..', '..', 'comanda.sqlite');
        const sqliteAdapter = createSqliteAdapter(sqlitePath);
        defaultMemoryAdapter = sqliteAdapter;
        return await withTransaction(sqliteAdapter, fn);
      }
      throw err;
    }

    try {
      await client.query('BEGIN');
      const txDb = {
        isPool: true,
        isTransaction: true,
        query: (text, params = []) => client.query(text, params),
        exec: (sql) => client.query(sql)
      };
      const result = await fn(txDb);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  // Manejo de SQLite (en memoria o persistente)
  if (db.sqliteDb) {
    db.sqliteDb.exec('BEGIN TRANSACTION;');
    const txDb = { ...db, isTransaction: true };
    try {
      const result = await fn(txDb);
      db.sqliteDb.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        db.sqliteDb.exec('ROLLBACK;');
      } catch (_) {}
      throw err;
    }
  }

  // Fallback si la instancia no reconoce adaptadores
  return await fn(db);
}

/**
 * Inicializa el esquema DDL ejecutando schema.sql sobre la base de datos indicada.
 * @param {Object} [db]
 */
async function initSchema(db) {
  const targetDb = db || getDatabase();
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Si es SQLite (memoria o archivo)
  if (targetDb.isMemory || targetDb.isSqlite || targetDb.sqliteDb) {
    // Migraciones previas seguras en caso de base de datos SQLite preexistente en disco
    const sqliteColumns = [
      "ALTER TABLE tables ADD COLUMN tenantId TEXT NOT NULL DEFAULT 'tenant-default'",
      "ALTER TABLE sessions ADD COLUMN tenantId TEXT NOT NULL DEFAULT 'tenant-default'",
      "ALTER TABLE ingredients ADD COLUMN tenantId TEXT NOT NULL DEFAULT 'tenant-default'",
      "ALTER TABLE products ADD COLUMN tenantId TEXT NOT NULL DEFAULT 'tenant-default'",
      "ALTER TABLE orders ADD COLUMN tenantId TEXT NOT NULL DEFAULT 'tenant-default'",
      "ALTER TABLE shift_audits ADD COLUMN tenantId TEXT NOT NULL DEFAULT 'tenant-default'",
      "ALTER TABLE wastes ADD COLUMN tenantId TEXT NOT NULL DEFAULT 'tenant-default'",
      "ALTER TABLE invoices ADD COLUMN tenantId TEXT NOT NULL DEFAULT 'tenant-default'",
      "ALTER TABLE invoices ADD COLUMN saleType VARCHAR(20) NOT NULL DEFAULT 'TABLE'",
      "ALTER TABLE invoices ADD COLUMN customerNote TEXT",
      "ALTER TABLE invoices ADD COLUMN cashierName VARCHAR(150)",
      // HERA v2.0 migraciones SQLite
      "ALTER TABLE tenants ADD COLUMN planName VARCHAR(60) NOT NULL DEFAULT 'PRO'",
      "ALTER TABLE tenants ADD COLUMN monthlyFeeCOP NUMERIC(14, 2) NOT NULL DEFAULT 0",
      "ALTER TABLE tenants ADD COLUMN subscriptionEndsAt TIMESTAMPTZ",
      "ALTER TABLE products ADD COLUMN trackStock BOOLEAN NOT NULL DEFAULT 0",
      "ALTER TABLE products ADD COLUMN stockUnits INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE products ADD COLUMN minStockUnits INTEGER NOT NULL DEFAULT 5",
      "ALTER TABLE invoices ADD COLUMN cancelReason TEXT",
      "ALTER TABLE invoices ADD COLUMN cancelledAt TIMESTAMPTZ",
      "ALTER TABLE invoices ADD COLUMN cancelledBy VARCHAR(150)",
      "ALTER TABLE shift_audits ADD COLUMN initialCashCOP NUMERIC(14, 2) NOT NULL DEFAULT 0"
    ];
    for (const alterSql of sqliteColumns) {
      try {
        await targetDb.exec(alterSql);
      } catch (_) {}
    }

    // Migración CHECK de invoice_payments en SQLite si ya existía sin TRANSFER
    try {
      const res = await targetDb.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoice_payments'");
      const tblSql = res.rows[0]?.sql || '';
      if (tblSql && !tblSql.includes('TRANSFER')) {
        await targetDb.exec(`
          PRAGMA foreign_keys = OFF;
          CREATE TABLE invoice_payments_new (
            id TEXT PRIMARY KEY,
            invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            subAccountId TEXT,
            method VARCHAR(20) NOT NULL CHECK(method IN ('CASH', 'CARD', 'NEQUI', 'DAVIPLATA', 'TRANSFER')),
            amountCOP NUMERIC(14, 2) NOT NULL CHECK(amountCOP > 0),
            reference TEXT,
            createdAt TIMESTAMPTZ NOT NULL
          );
          INSERT INTO invoice_payments_new SELECT id, invoiceId, subAccountId, method, amountCOP, reference, createdAt FROM invoice_payments;
          DROP TABLE invoice_payments;
          ALTER TABLE invoice_payments_new RENAME TO invoice_payments;
          PRAGMA foreign_keys = ON;
        `);
      }
    } catch (_) {}

    await targetDb.exec('PRAGMA foreign_keys = ON;\n' + sql);
    return;
  }

  // Si es PostgreSQL / Supabase
  try {
    // 1. Migraciones seguras previas sobre tablas existentes (antes de crear índices que referencien columnas nuevas)
    const alterQueries = [
      `ALTER TABLE tables ADD COLUMN IF NOT EXISTS tenantId TEXT NOT NULL DEFAULT 'tenant-default'`,
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tenantId TEXT NOT NULL DEFAULT 'tenant-default'`,
      `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS tenantId TEXT NOT NULL DEFAULT 'tenant-default'`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS tenantId TEXT NOT NULL DEFAULT 'tenant-default'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenantId TEXT NOT NULL DEFAULT 'tenant-default'`,
      `ALTER TABLE shift_audits ADD COLUMN IF NOT EXISTS tenantId TEXT NOT NULL DEFAULT 'tenant-default'`,
      `ALTER TABLE wastes ADD COLUMN IF NOT EXISTS tenantId TEXT NOT NULL DEFAULT 'tenant-default'`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tenantId TEXT NOT NULL DEFAULT 'tenant-default'`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS saleType VARCHAR(20) NOT NULL DEFAULT 'TABLE'`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customerNote TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cashierName VARCHAR(150)`,
      // HERA v2.0 migraciones PostgreSQL
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS planName VARCHAR(60) NOT NULL DEFAULT 'PRO'`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS monthlyFeeCOP NUMERIC(14, 2) NOT NULL DEFAULT 0`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscriptionEndsAt TIMESTAMPTZ`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS trackStock BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS stockUnits INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS minStockUnits INTEGER NOT NULL DEFAULT 5`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelReason TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelledAt TIMESTAMPTZ`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelledBy VARCHAR(150)`,
      `ALTER TABLE shift_audits ADD COLUMN IF NOT EXISTS initialCashCOP NUMERIC(14, 2) NOT NULL DEFAULT 0`
    ];

    for (const q of alterQueries) {
      try {
        await targetDb.query(q);
      } catch (_) {
        // Ignorar si la tabla aún no existe o la columna ya está presente
      }
    }

    // 2. Ejecutar esquema DDL principal
    await targetDb.query(sql);

    // 3. Modificaciones de nulabilidad y constraints en columnas existentes
    const constraintQueries = [
      `ALTER TABLE invoices ALTER COLUMN sessionId DROP NOT NULL`,
      `ALTER TABLE invoices ALTER COLUMN tableId DROP NOT NULL`,
      `ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_method_check`,
      `ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_method_check CHECK (method IN ('CASH', 'CARD', 'NEQUI', 'DAVIPLATA', 'TRANSFER'))`
    ];

    for (const q of constraintQueries) {
      try {
        await targetDb.query(q);
      } catch (_) {}
    }
  } catch (err) {
    if (err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.warn('⚠️ No se pudo inicializar esquema en PostgreSQL remoto (' + err.code + '). Inicializando en SQLite persistente.');
      if (activePool) {
        try { await activePool.close(); } catch (_) {}
        activePool = null;
      }
      const sqlitePath = path.join(__dirname, '..', '..', 'comanda.sqlite');
      defaultMemoryAdapter = createSqliteAdapter(sqlitePath);
      await initSchema(defaultMemoryAdapter);
      return;
    }
    throw err;
  }
}

/**
 * Cierra la conexión de base de datos activa (útil para pruebas y apagado limpio).
 */
async function closeDatabase() {
  if (activePool) {
    await activePool.close();
    activePool = null;
  }
  if (defaultMemoryAdapter) {
    await defaultMemoryAdapter.close();
    defaultMemoryAdapter = null;
  }
}

module.exports = {
  getDatabase,
  query,
  withTransaction,
  initSchema,
  closeDatabase,
  supabase,
  translatePostgresToSqlite
};
