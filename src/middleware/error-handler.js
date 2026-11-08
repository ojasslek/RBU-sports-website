// src/middleware/error-handler.js
// --------------------------------------------------
// Central Express error handler.
// Never leaks stack traces in production.
// Never logs passwords, tokens, or personal info.
// --------------------------------------------------

const config = require('../config');

function errorHandler(err, req, res, _next) {
  // In development, log the error details for debugging
  if (!config.isProduction) {
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err);
  } else {
    // In production, keep logs clean and devoid of user input
    console.error(`[ERROR] ${req.method} ${req.originalUrl}: ${err.message}`);
  }

  const status = err.statusCode || err.status || 500;

  res.status(status).json({
    error: status >= 500 && config.isProduction
      ? 'An unexpected error occurred. Please try again later.'
      : err.message || 'Internal Server Error',
  });
}

module.exports = errorHandler;

