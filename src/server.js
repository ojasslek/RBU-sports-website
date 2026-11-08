// src/server.js
// --------------------------------------------------
// Main application server.
// Serves both the JSON API and the mobile-first frontend.
// --------------------------------------------------

const express = require('express');
const { createServer } = require('http');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./config');
const db = require('./db/connection');
const runMigrations = require('./db/migrate');
const errorHandler = require('./middleware/error-handler');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth.routes');
const facilitiesRouter = require('./routes/facilities.routes');
const bookingsRouter = require('./routes/bookings.routes');
const { startCronJobs, stopCronJobs } = require('./utils/cron');
const { initSocket } = require('./realtime/socket');

// Ensure database migrations run on boot
runMigrations();

const app = express();
const server = createServer(app);
const io = initSocket(server);

// Reverse proxy trust (Render / Railway / Nginx)
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// --------------------------------------------------
// Security Middleware
// --------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  frameguard: { action: 'deny' },
}));

// Body parsing with sane size limits
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// HTTPS enforcement in production
if (config.isProduction) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// --------------------------------------------------
// Static Frontend Files
// --------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// --------------------------------------------------
// Routes
// --------------------------------------------------
app.use(healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/facilities', facilitiesRouter);
app.use('/api/bookings', bookingsRouter);

// Start background hold cleanup cron job
if (!process.env.VITEST) {
  startCronJobs();
}

// Dynamic routes will be mounted in upcoming phases:
// Phase 1: app.use('/api/auth', authRouter);
// Phase 2: app.use('/api/facilities', facilitiesRouter);
// Phase 3: app.use('/api/bookings', bookingsRouter);
// Phase 6: app.use('/api/admin', adminRouter);

// Catch-all route: API 404s return JSON, all other routes serve index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Central error handler
app.use(errorHandler);

// --------------------------------------------------
// Graceful Shutdown
// --------------------------------------------------
function shutdown(signal) {
  console.log(`\n[server] Received ${signal}. Shutting down gracefully...`);
  stopCronJobs();
  server.close(() => {
    console.log('[server] Closed HTTP server.');
    try {
      db.close();
      console.log('[server] Closed SQLite database.');
    } catch (e) {
      // Ignored if already closed
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[server] Force shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start listening if run directly
if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`
  ================================================
   ${config.collegeName} Sports Facility Booking System
  ================================================
   Environment : ${config.nodeEnv}
   Listening on: http://localhost:${config.port}
   Health check: http://localhost:${config.port}/health
  ================================================
    `);
  });
}

module.exports = { app, server, io };

