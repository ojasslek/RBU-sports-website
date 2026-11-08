// src/db/connection.js
// --------------------------------------------------
// SQLite database connection.
//
// Dual-engine support:
// 1. Tries `better-sqlite3` first (standard for production/Linux).
// 2. Falls back to Node's built-in `node:sqlite` (Node v22+), which requires
//    ZERO native compilation on Windows and provides identical synchronous API:
//    - db.prepare(sql).get(...params)
//    - db.prepare(sql).all(...params)
//    - db.prepare(sql).run(...params)
//    - db.transaction(fn) with BEGIN IMMEDIATE
// --------------------------------------------------

const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure database directory exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let dbInstance = null;

function createConnection() {
  let rawDb;
  let isBetterSqlite = false;

  try {
    const BetterSqlite3 = require('better-sqlite3');
    rawDb = new BetterSqlite3(config.dbPath);
    isBetterSqlite = true;
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');
    rawDb.pragma('busy_timeout = 5000');
  } catch (_err) {
    // Fall back to Node v22+ built-in node:sqlite
    const { DatabaseSync } = require('node:sqlite');
    rawDb = new DatabaseSync(config.dbPath);
    rawDb.exec('PRAGMA journal_mode = WAL;');
    rawDb.exec('PRAGMA foreign_keys = ON;');
    rawDb.exec('PRAGMA busy_timeout = 5000;');
  }

  // Unified API wrapper so queries in src/data/ never have to care which driver runs
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql);
      return {
        get(...params) {
          return stmt.get(...params);
        },
        all(...params) {
          return stmt.all(...params);
        },
        run(...params) {
          return stmt.run(...params);
        },
      };
    },
    exec(sql) {
      return rawDb.exec(sql);
    },
    pragma(sql) {
      if (isBetterSqlite) {
        return rawDb.pragma(sql);
      }
      return rawDb.exec(`PRAGMA ${sql};`);
    },
    transaction(fn) {
      if (isBetterSqlite) {
        return rawDb.transaction(fn);
      }
      // Transaction wrapper for node:sqlite using BEGIN IMMEDIATE
      return function (...args) {
        rawDb.exec('BEGIN IMMEDIATE;');
        try {
          const result = fn(...args);
          rawDb.exec('COMMIT;');
          return result;
        } catch (err) {
          rawDb.exec('ROLLBACK;');
          throw err;
        }
      };
    },
    close() {
      return rawDb.close();
    },
  };

  return db;
}

function getDb() {
  if (!dbInstance) {
    dbInstance = createConnection();
  }
  return dbInstance;
}

module.exports = getDb();

