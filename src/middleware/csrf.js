// Cross-Site Request Forgery (CSRF) protection.
//
// Pattern: double-submit cookie.
//   1. A random token is stored in a readable cookie (rbu_csrf).
//   2. The page's JavaScript reads it and sends it in the X-CSRF-Token header.
//   3. The server checks that the header matches the cookie.
//
// An attacker on another site can make the browser send the cookie, but the
// browser will not let them read the cookie to build the matching header.
// We also reject an Origin header that does not belong to this site.

const crypto = require('node:crypto');
const config = require('../config');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function timingSafeStringEqual(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;

  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  if (firstBuffer.length !== secondBuffer.length) return false;

  return crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function csrfProtection(req, res, next) {
  let token = req.cookies ? req.cookies[config.csrfCookieName] : '';

  if (!TOKEN_PATTERN.test(token || '')) {
    token = crypto.randomBytes(32).toString('hex');

    res.cookie(config.csrfCookieName, token, {
      httpOnly: false, // The page's JavaScript must read this one.
      secure: config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: config.jwtExpiresMinutes * 60 * 1000
    });
  }

  // The /api/auth/csrf endpoint sends this value to the page.
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const headerToken = req.get('x-csrf-token') || '';

  if (!timingSafeStringEqual(headerToken, token)) {
    return res.status(403).json({
      error:
        'Your security token is missing or expired. Refresh the page and try again.',
      code: 'CSRF_FAILED'
    });
  }

  const origin = req.get('origin');

  if (origin) {
    // In production, only the exact configured origin is accepted. In local
    // development, allow either localhost or 127.0.0.1 on the same port.
    const expectedOrigin = config.isProduction
      ? config.appOrigin
      : `${req.protocol}://${req.get('host')}`;

    if (origin !== expectedOrigin) {
      return res.status(403).json({
        error: 'This request came from an unexpected origin.',
        code: 'CSRF_ORIGIN_FAILED'
      });
    }
  }

  return next();
}

module.exports = { csrfProtection };
