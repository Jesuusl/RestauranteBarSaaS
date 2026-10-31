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
 * Crea un adaptador en memoria basado en SQLite que emula la API asíncrona de PostgreSQL / pg.Pool.
 */
function createMemoryAdapter() {
  const sqliteDb = new DatabaseSync(':memory:');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');

  const adapter = {
    isMemory: true,
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
 * - Si hay conexión configurada a PostgreSQL / Supabase, retorna el Pool con wrapper unificado.
 * - De lo contrario o en modo test/fallback, retorna el adaptador en memoria.
 *
 * @param {string} [customTarget]
 * @returns {Object} Adaptador con método query(text, params)
 */
function getDatabase(customTarget) {
  if (customTarget === ':memory:') {
    return createMemoryAdapter();
  }

  // Si ya tenemos un pool o adaptador de memoria por defecto
  if (activePool) return activePool;
  if (defaultMemoryAdapter) return defaultMemoryAdapter;

  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const isPostgresConfigured = connectionString &&
    !connectionString.includes('your-project-id') &&
    !connectionString.includes('your-password');

  // En entorno de pruebas automatizadas o si no está configurada la BD remota, usar fallback de memoria
  if (process.env.NODE_ENV === 'test' || !isPostgresConfigured) {
    defaultMemoryAdapter = createMemoryAdapter();
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
        return await pool.query(text, params);
      },
      async exec(sql) {
        return await pool.query(sql);
      },
      async close() {
        await pool.end();
        activePool = null;
      }
    };

    return activePool;
  } catch (err) {
    console.warn('⚠️ Error al configurar Pool de PostgreSQL, activando modo memoria fallback:', err.message);
    defaultMemoryAdapter = createMemoryAdapter();
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
 * Inicializa el esquema DDL ejecutando schema.sql sobre la base de datos indicada.
 * @param {Object} [db]
 */
async function initSchema(db) {
  const targetDb = db || getDatabase();
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  if (targetDb.isMemory) {
    await targetDb.exec('PRAGMA foreign_keys = ON;\n' + sql);
  } else {
    await targetDb.query(sql);
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
  initSchema,
  closeDatabase,
  supabase
};
