// src/routes/auth.routes.js
// --------------------------------------------------
// Authentication & Account Verification Routes.
//
// New Simplified Flow:
// 1. POST /api/auth/register-request:
//    Student enters their official @rbunagpur.in email.
//    Server sends 6-digit OTP code.
// 2. POST /api/auth/register-verify:
//    Student submits OTP + sets their desired password.
//    Account is activated and student is logged in.
// 3. POST /api/auth/login:
//    Accepts either RBU email or College ID + password.
// --------------------------------------------------

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const config = require('../config');
const usersDal = require('../data/users.dal');
const { sendOtpEmail } = require('../utils/email');
const { minutesFromNowUTC, isExpired } = require('../utils/time');
const {
  validateBody,
  requestOtpSchema,
  verifyOtpAndSetPasswordSchema,
  loginSchema,
  resendOtpSchema,
} = require('../middleware/validate');
const {
  loginLimiter,
  registerLimiter,
  otpLimiter,
} = require('../middleware/rate-limiters');
const {
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
} = require('../middleware/auth.middleware');

const router = express.Router();

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

const DUMMY_HASH = bcrypt.hashSync('dummy_password_for_timing_defense', 12);

// ==================================================
// STEP 1: POST /api/auth/register-request
// Accepts @rbunagpur.in email, generates and sends 6-digit OTP
// ==================================================
router.post('/register-request', registerLimiter, validateBody(requestOtpSchema), async (req, res, next) => {
  try {
    const { email, name } = req.body;

    // Check if account is already verified
    const existingUser = usersDal.findUserByEmail(email);
    if (existingUser && existingUser.is_verified) {
      return res.status(409).json({
        error: 'An account with this RBU email is already active. Please log in.',
      });
    }

    // Generate 6-digit OTP and store bcrypt hash
    const otp = generateOtp();
    const otpHash = bcrypt.hashSync(otp, config.bcryptRounds);
    const otpExpiresAt = minutesFromNowUTC(config.otpExpiryMinutes);

    usersDal.createOrUpdatePendingRegistration({
      email,
      name,
      otp_hash: otpHash,
      otp_expires_at: otpExpiresAt,
    });

    const displayName = name || email.split('@')[0];
    await sendOtpEmail(email, displayName, otp);

    return res.status(200).json({
      message: `A 6-digit verification code has been sent to ${email}.`,
      email,
    });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// STEP 2: POST /api/auth/register-verify
// Verifies OTP, sets student's password, activates account & logs in
// ==================================================
router.post('/register-verify', otpLimiter, validateBody(verifyOtpAndSetPasswordSchema), async (req, res, next) => {
  try {
    const { email, otp, password, name } = req.body;

    const user = usersDal.findUserByEmail(email);
    if (!user) {
      return res.status(400).json({
        error: 'No pending registration found for this email. Please request a code first.',
      });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'This account is already verified. Please log in.' });
    }

    // Check expiration
    if (!user.otp_expires_at || isExpired(user.otp_expires_at)) {
      return res.status(400).json({
        error: 'The verification code has expired. Please request a new code.',
      });
    }

    // Verify OTP
    const isValid = bcrypt.compareSync(otp, user.otp_hash);
    if (!isValid) {
      return res.status(400).json({
        error: 'Incorrect verification code. Please check your email and try again.',
      });
    }

    // Hash the student's chosen password
    const passwordHash = bcrypt.hashSync(password, config.bcryptRounds);

    // Activate user with their password
    usersDal.activateUserWithPassword({
      userId: user.id,
      passwordHash,
      name,
    });

    // Auto-login: Issue JWT session cookie
    const token = jwt.sign(
      { id: user.id, college_id: user.college_id, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    setAuthCookie(res, token);

    return res.status(200).json({
      message: 'Account created and activated successfully!',
      user: {
        id: user.id,
        college_id: user.college_id,
        name: name || user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// POST /api/auth/resend-otp
// Resends a new OTP code to the email
// ==================================================
router.post('/resend-otp', otpLimiter, validateBody(resendOtpSchema), async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = usersDal.findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: 'No account found with this email. Please register first.' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Account is already verified. Please log in.' });
    }

    const otp = generateOtp();
    const otpHash = bcrypt.hashSync(otp, config.bcryptRounds);
    const otpExpiresAt = minutesFromNowUTC(config.otpExpiryMinutes);

    usersDal.updateUserOtp(user.id, otpHash, otpExpiresAt);
    await sendOtpEmail(user.email, user.name, otp);

    return res.status(200).json({
      message: `A new verification code was sent to ${user.email}.`,
    });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// POST /api/auth/login
// Accepts either RBU email or College ID + password
// ==================================================
router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    const user = usersDal.findUserByIdentifier(identifier);

    // Timing-attack prevention: perform dummy comparison if user not found
    if (!user) {
      bcrypt.compareSync(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check account lockout
    if (user.locked_until && !isExpired(user.locked_until)) {
      return res.status(423).json({
        error: 'Account temporarily locked due to multiple failed login attempts. Please wait 15 minutes before trying again.',
      });
    }

    // Verify password
    const isPasswordCorrect = bcrypt.compareSync(password, user.password_hash);

    if (!isPasswordCorrect) {
      const lockResult = usersDal.recordFailedLogin(
        user.id,
        user.failed_login_attempts,
        config.maxFailedLogins,
        config.lockoutMinutes
      );

      if (lockResult.isLocked) {
        return res.status(423).json({
          error: `Too many failed attempts. Account locked for ${config.lockoutMinutes} minutes.`,
        });
      }

      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check if account is verified
    if (!user.is_verified) {
      return res.status(403).json({
        error: 'Account activation pending. Please enter the verification code sent to your email to set your password.',
        unverified: true,
        email: user.email,
      });
    }

    // Reset failed logins on successful authentication
    usersDal.resetFailedLogins(user.id);

    // Issue JWT in httpOnly cookie
    const token = jwt.sign(
      { id: user.id, college_id: user.college_id, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    setAuthCookie(res, token);

    return res.status(200).json({
      message: 'Logged in successfully.',
      user: {
        id: user.id,
        college_id: user.college_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// POST /api/auth/logout
// ==================================================
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  return res.status(200).json({ message: 'Logged out successfully.' });
});

// ==================================================
// GET /api/auth/me
// ==================================================
router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({
    user: {
      id: req.user.id,
      college_id: req.user.college_id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

module.exports = router;
