const { spawnSync } = require('node:child_process');
const path = require('node:path');

console.log('🧪 Ejecutando suite de pruebas de lógica de negocio y persistencia...\n');

const testFile = path.join(__dirname, 'tests', 'test-business-logic.test.js');
const result = spawnSync(process.execPath, ['--test', testFile], {
  stdio: 'inherit',
  env: process.env
});

process.exit(result.status);
