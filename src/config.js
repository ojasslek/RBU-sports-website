// src/config.js
// Loads environment variables and checks required ones exist.
// The app REFUSES to start if a required secret is missing.

const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

// --- Check required variables ---
const required = ['JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

if (process.env.JWT_SECRET === 'change-me-to-a-random-64-char-string') {
  console.warn('WARNING: You are using the placeholder JWT_SECRET. Change it before deploying!');
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'sports.db'),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: '2h',
  bcryptRounds: 12,
  otpExpiryMinutes: 10,
  holdMinutes: 5,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  collegeName: process.env.COLLEGE_NAME || 'RBU',
  collegeTimezone: process.env.COLLEGE_TIMEZONE || 'Asia/Kolkata',
  maxBookingsPerDay: 2,
  maxAdvanceBookingDays: 7,
  minCancelHours: 2,
  loginRateLimit:    process.env.NODE_ENV === 'production' ? { windowMs: 15 * 60 * 1000, max: 10 } : { windowMs: 15 * 60 * 1000, max: 100 },
  registerRateLimit: process.env.NODE_ENV === 'production' ? { windowMs: 60 * 60 * 1000, max: 5 } : { windowMs: 60 * 60 * 1000, max: 100 },
  otpRateLimit:      process.env.NODE_ENV === 'production' ? { windowMs: 60 * 1000,      max: 3 } : { windowMs: 60 * 1000,      max: 50 },
  bookingRateLimit:  process.env.NODE_ENV === 'production' ? { windowMs: 60 * 1000,      max: 10 } : { windowMs: 60 * 1000,      max: 100 },
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000'],
  backupDir: process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'),
};

module.exports = config;
