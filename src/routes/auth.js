// Authentication API.
// Every route here is mounted at /api/auth.
//
// The server validates every input and never trusts checks done in the
// browser. The browser's minlength/required attributes are only a convenience.

const express = require('express');
const { z } = require('zod');
const authService = require('../services/auth-service');
const { issueSession, clearSession } = require('../services/session');
const { requireAuth } = require('../middleware/auth');
const {
  loginLimiter,
  registerLimiter,
  verifyLimiter,
  resendLimiter
} = require('../middleware/rate-limit');
const { validate } = require('../utils/validate');

const router = express.Router();

// Session data must never be cached by the browser or a proxy.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const collegeIdField = z
  .string({ error: 'College ID is required.' })
  .trim()
  .min(3, 'College ID must be at least 3 characters.')
  .max(40, 'College ID must be at most 40 characters.')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'College ID can only contain letters, numbers, dots, dashes and underscores.'
  )
  .transform((value) => value.toUpperCase());

const registerSchema = z.object({
  collegeId: collegeIdField,
  password: z
    .string({ error: 'Password is required.' })
    .min(10, 'Password must be at least 10 characters.')
    .max(72, 'Password must be at most 72 characters.')
    .refine((value) => /[A-Za-z]/.test(value), {
      message: 'Password must include at least one letter.'
    })
    .refine((value) => /[0-9]/.test(value), {
      message: 'Password must include at least one number.'
    })
});

const loginSchema = z.object({
  collegeId: collegeIdField,
  password: z
    .string({ error: 'Password is required.' })
    .min(1, 'Password is required.')
    .max(72, 'Password must be at most 72 characters.')
});

const verifySchema = z.object({
  collegeId: collegeIdField,
  otp: z
    .string({ error: 'Verification code is required.' })
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your email.')
});

const resendSchema = z.object({
  collegeId: collegeIdField
});

// The page calls this once to receive a CSRF token. The csrfProtection
// middleware has already set the matching cookie.
router.get('/csrf', (req, res) => {
  res.json({ csrfToken: res.locals.csrfToken });
});

router.post('/register', registerLimiter, async (req, res) => {
  const input = validate(registerSchema, req.body || {});
  const result = await authService.registerStudent(input);
  res.status(201).json(result);
});

router.post('/verify-otp', verifyLimiter, async (req, res) => {
  const input = validate(verifySchema, req.body || {});
  const user = await authService.verifyRegistrationOtp(input);

  issueSession(res, user);
  res.json({ user });
});

router.post('/resend-otp', resendLimiter, async (req, res) => {
  const input = validate(resendSchema, req.body || {});
  const result = await authService.resendOtp(input);
  res.json(result);
});

router.post('/login', loginLimiter, async (req, res) => {
  const input = validate(loginSchema, req.body || {});
  const user = await authService.login(input);

  issueSession(res, user);
  res.json({ user });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ message: 'Logged out.' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
