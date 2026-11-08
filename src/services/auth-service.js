// Registration, email verification and login rules.
//
// This file contains the decisions; src/data/users.js contains the SQL.
// The browser can never decide whether a login succeeds, whether an OTP is
// valid, or whether an account is locked.

const config = require('../config');
const data = require('../data/users');
const logger = require('../utils/logger');
const { HttpError } = require('../utils/http-error');
const { hashPassword, verifyPassword, spendDummyPasswordCheck } = require('./password');
const {
  normalizeCollegeId,
  generateOtp,
  hashOtp,
  otpMatches
} = require('./otp');
const email = require('./email');
const { nowUtcIso, addMinutesToUtcIso, isFutureUtc } = require('../utils/time');

const GENERIC_LOGIN_ERROR = 'Invalid college ID or password.';

function publicUser(row) {
  return {
    id: row.id,
    collegeId: row.college_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role
  };
}

// Example: student1@rbu.invalid -> s*******@rbu.invalid
// The real address is never returned by the API.
function maskEmail(address) {
  const atIndex = address.indexOf('@');
  if (atIndex < 1) return '';

  const name = address.slice(0, atIndex);
  const domain = address.slice(atIndex);
  const stars = '*'.repeat(Math.max(1, Math.min(8, name.length - 1)));

  return `${name.slice(0, 1)}${stars}${domain}`;
}

function isUniqueConstraintError(error) {
  return typeof error.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT');
}

async function registerStudent({ collegeId, password }) {
  const normalizedId = normalizeCollegeId(collegeId);

  const existingUser = data.findUserByCollegeId(normalizedId);

  if (existingUser) {
    if (existingUser.status === 'pending') {
      throw new HttpError(
        409,
        'This college ID is waiting for email verification. Enter your code or request a new one.',
        'PENDING_VERIFICATION'
      );
    }

    throw new HttpError(
      409,
      'This college ID is already registered. Log in instead.',
      'ID_ALREADY_REGISTERED'
    );
  }

  const approved = data.findValidCollegeId(normalizedId);

  if (!approved) {
    throw new HttpError(
      400,
      'This college ID is not on the approved list. Contact the sports office if this is a mistake.',
      'ID_NOT_APPROVED'
    );
  }

  if (approved.is_claimed) {
    throw new HttpError(
      409,
      'This college ID is already registered. Log in instead.',
      'ID_ALREADY_REGISTERED'
    );
  }

  const passwordHash = await hashPassword(password);
  const otp = generateOtp();
  const now = nowUtcIso();
  const otpExpiresAt = addMinutesToUtcIso(now, config.otpExpiresMinutes);

  let userId;

  try {
    userId = data.createPendingUser({
      collegeId: normalizedId,
      fullName: approved.full_name || 'Student',
      email: approved.email,
      passwordHash,
      otpHash: hashOtp(normalizedId, otp),
      otpExpiresAt
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      logger.warn('registration_conflict', { code: error.code });
      throw new HttpError(
        409,
        'This college ID cannot be registered right now. Try logging in or contact the sports office.',
        'REGISTRATION_CONFLICT'
      );
    }
    throw error;
  }

  try {
    await email.sendOtpEmail({
      to: approved.email,
      fullName: approved.full_name || 'Student',
      collegeId: normalizedId,
      otp
    });
  } catch (error) {
    // Remove the half-created account so the student can try again later.
    data.deletePendingUser(userId);
    logger.error('otp_email_failed', { message: error.message });

    throw new HttpError(
      503,
      'We could not send the verification email. Please try again in a few minutes.',
      'EMAIL_FAILED'
    );
  }

  return {
    collegeId: normalizedId,
    emailHint: maskEmail(approved.email),
    message: 'Verification code sent. Check your college email.'
  };
}

async function verifyRegistrationOtp({ collegeId, otp }) {
  const normalizedId = normalizeCollegeId(collegeId);
  const user = data.findUserByCollegeId(normalizedId);

  if (!user || user.status !== 'pending') {
    throw new HttpError(
      400,
      'That code is invalid or has expired. Request a new code.',
      'INVALID_OTP'
    );
  }

  const now = nowUtcIso();

  if (!user.otp_hash || !user.otp_expires_at) {
    throw new HttpError(
      400,
      'That code is invalid or has expired. Request a new code.',
      'INVALID_OTP'
    );
  }

  if (!isFutureUtc(user.otp_expires_at, now)) {
    throw new HttpError(
      400,
      'That code has expired. Request a new code.',
      'OTP_EXPIRED'
    );
  }

  if (user.otp_attempts >= config.otpMaxAttempts) {
    throw new HttpError(
      429,
      'Too many incorrect codes. Request a new code.',
      'OTP_ATTEMPTS_EXCEEDED'
    );
  }

  if (!otpMatches(normalizedId, otp, user.otp_hash)) {
    data.incrementOtpAttempts({ userId: user.id, now });

    if (user.otp_attempts + 1 >= config.otpMaxAttempts) {
      throw new HttpError(
        429,
        'Too many incorrect codes. Request a new code.',
        'OTP_ATTEMPTS_EXCEEDED'
      );
    }

    throw new HttpError(
      400,
      'That code is not correct. Check the email and try again.',
      'INVALID_OTP'
    );
  }

  const activation = data.activateUser({
    userId: user.id,
    collegeId: normalizedId,
    now
  });

  if (!activation.ok) {
    if (activation.reason === 'claimed') {
      throw new HttpError(
        409,
        'This college ID was already registered. Log in instead.',
        'ID_ALREADY_REGISTERED'
      );
    }

    throw new HttpError(
      400,
      'We could not verify this account. Request a new code and try again.',
      'VERIFICATION_FAILED'
    );
  }

  const activatedUser = data.findUserById(user.id);
  if (!activatedUser) {
    throw new HttpError(
      500,
      'Your account was verified but could not be loaded. Please log in.',
      'ACCOUNT_LOAD_FAILED'
    );
  }

  return publicUser(activatedUser);
}

// Always returns a generic message. It must not reveal whether a college ID
// exists or whether it is still waiting for verification.
async function resendOtp({ collegeId }) {
  const normalizedId = normalizeCollegeId(collegeId);
  const user = data.findUserByCollegeId(normalizedId);

  if (!user || user.status !== 'pending') {
    return {
      message:
        'If this college ID is waiting for verification, a new code has been sent.'
    };
  }

  const approved = data.findValidCollegeId(normalizedId);
  if (!approved) {
    return {
      message:
        'If this college ID is waiting for verification, a new code has been sent.'
    };
  }

  const otp = generateOtp();
  const now = nowUtcIso();
  const otpExpiresAt = addMinutesToUtcIso(now, config.otpExpiresMinutes);

  data.updateOtpForPendingUser({
    userId: user.id,
    otpHash: hashOtp(normalizedId, otp),
    otpExpiresAt,
    now
  });

  try {
    await email.sendOtpEmail({
      to: approved.email,
      fullName: approved.full_name || user.full_name || 'Student',
      collegeId: normalizedId,
      otp
    });
  } catch (error) {
    // Do not tell the caller whether the address exists. The resend button is
    // rate-limited, and the error is recorded for the operator.
    logger.error('otp_resend_email_failed', { message: error.message });
  }

  return {
    message:
      'If this college ID is waiting for verification, a new code has been sent.'
  };
}

async function login({ collegeId, password }) {
  const normalizedId = normalizeCollegeId(collegeId);
  const user = data.findUserByCollegeId(normalizedId);
  const now = nowUtcIso();

  if (!user || user.status !== 'active') {
    // Spend roughly the same time as a real bcrypt check.
    await spendDummyPasswordCheck(password);
    throw new HttpError(401, GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  if (user.locked_until && isFutureUtc(user.locked_until, now)) {
    throw new HttpError(
      429,
      `Too many failed attempts. Try again in ${config.loginLockMinutes} minutes.`,
      'ACCOUNT_LOCKED'
    );
  }

  const passwordIsCorrect = await verifyPassword(password, user.password_hash);

  if (!passwordIsCorrect) {
    const result = data.recordFailedLogin({
      userId: user.id,
      now,
      maxAttempts: config.loginMaxAttempts,
      lockUntil: addMinutesToUtcIso(now, config.loginLockMinutes)
    });

    if (result.locked) {
      throw new HttpError(
        429,
        `Too many failed attempts. This account is locked for ${config.loginLockMinutes} minutes.`,
        'ACCOUNT_LOCKED'
      );
    }

    throw new HttpError(401, GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  data.recordSuccessfulLogin({ userId: user.id, now });

  const freshUser = data.findUserById(user.id);
  return publicUser(freshUser);
}

module.exports = {
  registerStudent,
  verifyRegistrationOtp,
  resendOtp,
  login
};
