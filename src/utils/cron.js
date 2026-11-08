// src/utils/cron.js
// --------------------------------------------------
// Background scheduled jobs using node-cron.
//
// Every minute:
// Cleans up any expired holds in the database as a backup
// (even though queries already treat expired holds as free).
// --------------------------------------------------

const cron = require('node-cron');
const bookingsDal = require('../data/bookings.dal');
const { performBackup } = require('./backup');

let cleanupTask = null;
let backupTask = null;

function startCronJobs() {
  // 1. Run hold cleanup once every minute
  cleanupTask = cron.schedule('* * * * *', () => {
    try {
      const expiredCount = bookingsDal.cleanupExpiredHolds();
      if (expiredCount > 0) {
        console.log(`[cron] Released ${expiredCount} expired slot hold(s).`);
      }
    } catch (err) {
      console.error('[cron] Error during hold cleanup:', err.message);
    }
  });

  // 2. Run database backup every night at 02:00 AM IST
  backupTask = cron.schedule('0 2 * * *', () => {
    try {
      performBackup();
    } catch (err) {
      console.error('[cron] Daily backup failed:', err.message);
    }
  });

  console.log('[cron] Background jobs started (hold cleanup 1m, daily backup at 2 AM).');
}

function stopCronJobs() {
  if (cleanupTask) cleanupTask.stop();
  if (backupTask) backupTask.stop();
}

module.exports = {
  startCronJobs,
  stopCronJobs,
};

