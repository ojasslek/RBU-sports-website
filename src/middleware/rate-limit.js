// Rate limiters.
//
// These use express-rate-limit's default in-memory store. That is fine for a
// single server, but the counts reset on restart and are not shared between
// multiple instances. See the README limitations section.

const { rateLimit } = require('express-rate-limit');

function createLimiter({ windowMs, limit, code, message, skipSuccessfulRequests }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: Boolean(skipSuccessfulRequests),
    handler: (req, res) => {
      res.status(429).json({ error: message, code });
    }
  });
}

// A broad safety net for every API route.
const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  code: 'RATE_LIMITED',
  message: 'Too many requests. Please wait a moment and try again.'
});

// Successful logins do not count, so normal use is not punished.
const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  code: 'LOGIN_RATE_LIMITED',
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
  skipSuccessfulRequests: true
});

const registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  code: 'REGISTER_RATE_LIMITED',
  message: 'Too many registration attempts. Please try again later.'
});

const verifyLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  code: 'VERIFY_RATE_LIMITED',
  message: 'Too many code attempts. Please wait and try again.',
  skipSuccessfulRequests: true
});

const resendLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  code: 'RESEND_RATE_LIMITED',
  message: 'Too many code requests. Please wait 15 minutes and try again.'
});

module.exports = {
  apiLimiter,
  loginLimiter,
  registerLimiter,
  verifyLimiter,
  resendLimiter
};
