// src/utils/backup.js
// --------------------------------------------------
// Automated SQLite Daily Backup Service.
//
// Creates point-in-time snapshot of the database file
// using SQLite's VACUUM INTO or file copy into the backups/ folder.
// Rotates backups older than 7 days to prevent disk bloat.
// --------------------------------------------------

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db/connection');

function performBackup() {
  const backupDir = config.backupDir;
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Format backup filename with local date/time: sports-YYYY-MM-DD-HHMMSS.db
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `sports-backup-${timestamp}.db`;
  const targetPath = path.join(backupDir, backupFileName);

  console.log(`[backup] Creating database backup: ${backupFileName}...`);

  try {
    // If the database has VACUUM INTO (SQLite 3.27+), use it for a live transactional snapshot
    db.exec(`VACUUM INTO '${targetPath.replace(/\\/g, '/')}'`);
    console.log(`[backup] Backup created successfully at ${targetPath}`);
  } catch (_vacuumErr) {
    // Fallback: direct file copy
    try {
      fs.copyFileSync(config.dbPath, targetPath);
      console.log(`[backup] Backup copied successfully to ${targetPath}`);
    } catch (copyErr) {
      console.error('[backup] Failed to create database backup:', copyErr.message);
      return false;
    }
  }

  // Prune backups older than 7 days
  try {
    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (file.startsWith('sports-backup-') && file.endsWith('.db')) {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > SEVEN_DAYS_MS) {
          fs.unlinkSync(filePath);
          console.log(`[backup] Pruned old backup: ${file}`);
        }
      }
    }
  } catch (pruneErr) {
    console.error('[backup] Error pruning old backups:', pruneErr.message);
  }

  return true;
}

// Can be run standalone from CLI: `node src/utils/backup.js`
if (require.main === module) {
  performBackup();
}

module.exports = {
  performBackup,
};

