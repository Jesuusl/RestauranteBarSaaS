const { getDatabase, initSchema, closeDatabase } = require('../config/database');

async function run() {
  console.log('🔄 Inicializando tablas del sistema en PostgreSQL / Supabase...');
  try {
    const db = getDatabase();
    await initSchema(db);
    console.log('✅ Esquema inicializado exitosamente.');
  } catch (err) {
    console.error('❌ Error al inicializar el esquema:', err.message);
    throw err;
  }
}

if (require.main === module) {
  run()
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async () => {
      await closeDatabase();
      process.exit(1);
    });
}

module.exports = { run };
