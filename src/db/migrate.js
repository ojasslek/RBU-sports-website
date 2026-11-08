// src/db/migrate.js
// --------------------------------------------------
// Migration runner: executes all .sql files in src/db/migrations/
// in alphanumeric order.
// Can be run standalone: `npm run migrate`
// Or invoked automatically on server startup.
// --------------------------------------------------

const fs = require('fs');
const path = require('path');
const db = require('./connection');

const migrationsDir = path.join(__dirname, 'migrations');

function runMigrations() {
  console.log('[migrate] Checking and applying migrations...');

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] No migration scripts found.');
    return;
  }

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`[migrate] Applying: ${file}`);
    db.exec(sql);
  }

  console.log('[migrate] Database is up to date.');
}

if (require.main === module) {
  runMigrations();
  db.close();
  console.log('[migrate] Finished.');
}

module.exports = runMigrations;

