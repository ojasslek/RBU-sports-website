// src/middleware/rate-limiters.js
// --------------------------------------------------
// Rate limiters to prevent brute-force attacks and abuse.
//
// Limits:
// - Login: 10 attempts per 15 minutes per IP
// - Register: 5 attempts per hour per IP
// - OTP verification / resend: 3 requests per minute per IP
// --------------------------------------------------

const rateLimit = require('express-rate-limit');
const config = require('../config');

// Login rate limiter
const loginLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,
  max: config.loginRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts. Please wait 15 minutes before trying again.',
  },
});

// Registration rate limiter
const registerLimiter = rateLimit({
  windowMs: config.registerRateLimit.windowMs,
  max: config.registerRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many registration requests. Please wait an hour before trying again.',
  },
});

// OTP verification and resend limiter
const otpLimiter = rateLimit({
  windowMs: config.otpRateLimit.windowMs,
  max: config.otpRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many verification attempts. Please wait a minute and try again.',
  },
});

module.exports = {
  loginLimiter,
  registerLimiter,
  otpLimiter,
};

