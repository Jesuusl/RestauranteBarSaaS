const { seedDatabase } = require('./src/db/seed');
const { closeDatabase } = require('./src/config/database');

seedDatabase()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('❌ Error en siembra:', err);
    await closeDatabase();
    process.exit(1);
  });
