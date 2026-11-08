// Express application.
// This file wires together security headers, cookies, CSRF checks, API
// routes, static pages and error handling.

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./config');
const db = require('./db/connection');
const logger = require('./utils/logger');
const { loadUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { apiLimiter } = require('./middleware/rate-limit');
const authRouter = require('./routes/auth');
const slotsRouter = require('./routes/slots');
const bookingsRouter = require('./routes/bookings');

const app = express();

app.disable('x-powered-by');

// Behind Render/Railway, secure cookies and rate limiting need proxy awareness.
app.set('trust proxy', config.trustProxy);

// Strict Content-Security-Policy: no inline scripts, no inline styles, no
// external scripts. All page JavaScript lives in public/js/.
const contentSecurityPolicy = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'"],
    styleSrcAttr: ["'none'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"]
  }
};

// Only force HTTPS upgrades in production. Local development uses http.
if (config.isProduction) {
  contentSecurityPolicy.directives.upgradeInsecureRequests = [];
}

app.use(helmet({ contentSecurityPolicy }));

// JSON only, and small. The auth forms send tiny objects.
app.use(express.json({ limit: '16kb', strict: true }));
app.use(cookieParser());

// Health check used by the hosting platform.
// It verifies that SQLite can execute a query, not just that Node is running.
app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error('health_check_failed', { message: error.message });
    res.status(503).json({ status: 'unavailable' });
  }
});

// API pipeline:
//   1. attach req.user from the session cookie (if present)
//   2. broad rate limit
//   3. CSRF token issue/check
//   4. feature routes
app.use('/api', loadUser);
app.use('/api', apiLimiter, csrfProtection);
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/auth', authRouter);
app.use('/api', slotsRouter);
app.use('/api/bookings', bookingsRouter);

// Serve the hand-written frontend from public/.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    dotfiles: 'deny',
    etag: true,
    maxAge: 0
  })
);

// JSON 404 for API paths, plain 404 for missing pages.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
    return;
  }
  res.status(404).type('text/plain').send('Page not found.');
});

// Central error handler.
// It never sends a stack trace or raw SQL error to the browser.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (!config.isTest) {
    const logFields = {
      method: req.method,
      path: req.path,
      message: error.message,
      ...(config.isProduction ? {} : { stack: error.stack })
    };

    if (error.status >= 500 || !error.status) {
      logger.error('request_failed', logFields);
    } else {
      logger.warn('request_rejected', logFields);
    }
  }

  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' });
    return;
  }

  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large.', code: 'BODY_TOO_LARGE' });
    return;
  }

  // HttpError is the only error type allowed to expose its message.
  if (error.expose === true && error.status >= 400 && error.status < 600) {
    res.status(error.status).json({
      error: error.message,
      code: error.code || 'REQUEST_FAILED'
    });
    return;
  }

  res.status(500).json({
    error: 'Something went wrong. Please try again.',
    code: 'INTERNAL_ERROR'
  });
});

module.exports = app;
