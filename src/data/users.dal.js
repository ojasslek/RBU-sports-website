// src/data/users.dal.js
// --------------------------------------------------
// Data Access Layer for Users.
// Supports email-based RBU student registration (@rbunagpur.in).
// All queries use strict parameterized statements to prevent SQL Injection.
// --------------------------------------------------

const db = require('../db/connection');
const { nowUTC, minutesFromNowUTC } = require('../utils/time');

/**
 * Find user by email (case-insensitive).
 */
function findUserByEmail(email) {
  const stmt = db.prepare(`
    SELECT id, college_id, email, name, password_hash, role,
           is_verified, otp_hash, otp_expires_at,
           failed_login_attempts, locked_until, created_at
    FROM users
    WHERE LOWER(email) = LOWER(?)
  `);
  return stmt.get(email);
}

/**
 * Find user by College ID OR Email (allows login with either).
 */
function findUserByIdentifier(identifier) {
  const stmt = db.prepare(`
    SELECT id, college_id, email, name, password_hash, role,
           is_verified, otp_hash, otp_expires_at,
           failed_login_attempts, locked_until, created_at
    FROM users
    WHERE LOWER(email) = LOWER(?) OR UPPER(college_id) = UPPER(?)
  `);
  return stmt.get(identifier, identifier);
}

/**
 * Find user by primary key ID.
 */
function findUserById(id) {
  const stmt = db.prepare(`
    SELECT id, college_id, email, name, role, is_verified, created_at
    FROM users
    WHERE id = ?
  `);
  return stmt.get(id);
}

/**
 * Create or update a pending registration with a fresh OTP.
 * Also ensures valid_college_ids has a record to satisfy any foreign key.
 */
function createOrUpdatePendingRegistration({ email, name, otp_hash, otp_expires_at }) {
  // Derive a college ID from the email username part (e.g. "rohan.gupta" from "rohan.gupta@rbunagpur.in")
  const defaultCollegeId = email.split('@')[0].toUpperCase();
  const displayName = name || email.split('@')[0].replace(/[._-]/g, ' ');

  // 1. Ensure a record in valid_college_ids exists
  db.prepare(`
    INSERT OR IGNORE INTO valid_college_ids (college_id, email, name)
    VALUES (?, ?, ?)
  `).run(defaultCollegeId, email, displayName);

  // 2. Check if a user row already exists
  const existing = findUserByEmail(email);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET otp_hash = ?,
          otp_expires_at = ?,
          name = COALESCE(?, name)
      WHERE id = ?
    `).run(otp_hash, otp_expires_at, name || null, existing.id);
    return existing.id;
  }

  // 3. Insert new unverified user (placeholder password until OTP is verified)
  const stmt = db.prepare(`
    INSERT INTO users (
      college_id, email, name, password_hash, role,
      is_verified, otp_hash, otp_expires_at, created_at
    ) VALUES (?, ?, ?, 'PENDING_PASSWORD_SET', 'student', 0, ?, ?, ?)
  `);

  const result = stmt.run(
    defaultCollegeId,
    email,
    displayName,
    otp_hash,
    otp_expires_at,
    nowUTC()
  );

  return result.lastInsertRowid;
}

/**
 * Activate user, set their chosen password, and clear OTP.
 */
function activateUserWithPassword({ userId, passwordHash, name }) {
  const stmt = db.prepare(`
    UPDATE users
    SET password_hash = ?,
        is_verified = 1,
        otp_hash = NULL,
        otp_expires_at = NULL,
        failed_login_attempts = 0,
        locked_until = NULL,
        name = COALESCE(?, name)
    WHERE id = ?
  `);
  return stmt.run(passwordHash, name || null, userId);
}

/**
 * Update the OTP code and expiration for an existing user (resend).
 */
function updateUserOtp(userId, otp_hash, otp_expires_at) {
  const stmt = db.prepare(`
    UPDATE users
    SET otp_hash = ?,
        otp_expires_at = ?
    WHERE id = ?
  `);
  return stmt.run(otp_hash, otp_expires_at, userId);
}

/**
 * Increment failed login attempts. If threshold reached, lock the account.
 */
function recordFailedLogin(userId, currentFailedCount, maxAttempts, lockoutMinutes) {
  const newCount = currentFailedCount + 1;
  let lockUntil = null;

  if (newCount >= maxAttempts) {
    lockUntil = minutesFromNowUTC(lockoutMinutes);
  }

  const stmt = db.prepare(`
    UPDATE users
    SET failed_login_attempts = ?,
        locked_until = ?
    WHERE id = ?
  `);
  stmt.run(newCount, lockUntil, userId);

  return {
    isLocked: !!lockUntil,
    lockedUntil: lockUntil,
    attemptsRemaining: Math.max(0, maxAttempts - newCount),
  };
}

/**
 * Reset failed login attempts on successful login.
 */
function resetFailedLogins(userId) {
  const stmt = db.prepare(`
    UPDATE users
    SET failed_login_attempts = 0,
        locked_until = NULL
    WHERE id = ?
  `);
  return stmt.run(userId);
}

module.exports = {
  findUserByEmail,
  findUserByIdentifier,
  findUserById,
  createOrUpdatePendingRegistration,
  activateUserWithPassword,
  updateUserOtp,
  recordFailedLogin,
  resetFailedLogins,
};
