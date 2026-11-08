// src/middleware/auth.middleware.js
// --------------------------------------------------
// JWT Authentication & Role Authorization Middleware.
//
// Reads token from:
// 1. httpOnly cookie named "token" (primary for web browsers)
// 2. "Authorization: Bearer <token>" header (useful for tests/APIs)
// --------------------------------------------------

const jwt = require('jsonwebtoken');
const config = require('../config');
const usersDal = require('../data/users.dal');

const COOKIE_NAME = 'token';

/**
 * Attaches auth cookie to the response.
 */
function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,                               // Cannot be read by JavaScript (XSS defense)
    secure: config.isProduction,                  // Only send over HTTPS in production
    sameSite: 'lax',                              // Protects against CSRF on top-level navigations
    maxAge: 2 * 60 * 60 * 1000,                   // 2 hours in milliseconds
    path: '/',
  });
}

/**
 * Clears the auth cookie on logout.
 */
function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Middleware: Requires a valid logged-in user.
 */
function requireAuth(req, res, next) {
  // 1. Look in cookie first, then in Authorization header
  let token = req.cookies?.[COOKIE_NAME];
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);

    // Verify user still exists in database
    const user = usersDal.findUserById(decoded.id);
    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Session invalid. User not found.' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Account not activated. Please verify OTP.' });
    }

    // Attach user payload to request
    req.user = user;
    next();
  } catch (err) {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

/**
 * Middleware: Requires the user to have the 'admin' role.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  requireAdmin,
};

