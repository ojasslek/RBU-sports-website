// src/routes/health.js
// --------------------------------------------------
// Health check endpoint for monitoring & deployment
// --------------------------------------------------

const express = require('express');
const router = express.Router();
const db = require('../db/connection');

router.get('/health', (_req, res) => {
  try {
    // Simple query to verify SQLite connection is alive
    db.prepare('SELECT 1 AS alive').get();
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
    });
  }
});

module.exports = router;

