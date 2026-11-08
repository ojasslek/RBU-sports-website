// All SQL for users and approved college IDs lives here.
// Every query uses ? placeholders, never string concatenation.

const db = require('../db/connection');

const USER_COLUMNS = `
  id, college_id, full_name, email, password_hash, role, status,
  failed_login_attempts, locked_until, email_verified_at,
  otp_hash, otp_expires_at, otp_attempts, last_login_at
`;

function findUserByCollegeId(collegeId) {
  return (
    db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE college_id = ?`)
      .get(collegeId) || null
  );
}

function findUserById(id) {
  return (
    db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) || null
  );
}

function findValidCollegeId(collegeId) {
  return (
    db
      .prepare(
        `
        SELECT id, college_id, full_name, email, is_claimed, claimed_by_user_id
        FROM valid_college_ids
        WHERE college_id = ?
      `
      )
      .get(collegeId) || null
  );
}

function createPendingUser({
  collegeId,
  fullName,
  email,
  passwordHash,
  otpHash,
  otpExpiresAt
}) {
  const result = db
    .prepare(
      `
      INSERT INTO users
        (college_id, full_name, email, password_hash, role, status,
         otp_hash, otp_expires_at)
      VALUES (?, ?, ?, ?, 'student', 'pending', ?, ?)
    `
    )
    .run(collegeId, fullName, email, passwordHash, otpHash, otpExpiresAt);

  return Number(result.lastInsertRowid);
}

function updateOtpForPendingUser({ userId, otpHash, otpExpiresAt, now }) {
  return db
    .prepare(
      `
      UPDATE users
         SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = ?
       WHERE id = ? AND status = 'pending'
    `
    )
    .run(otpHash, otpExpiresAt, now, userId);
}

function deletePendingUser(userId) {
  return db
    .prepare("DELETE FROM users WHERE id = ? AND status = 'pending'")
    .run(userId);
}

function incrementOtpAttempts({ userId, now }) {
  return db
    .prepare(
      `
      UPDATE users
         SET otp_attempts = otp_attempts + 1, updated_at = ?
       WHERE id = ? AND status = 'pending'
    `
    )
    .run(now, userId);
}

// Activation + claiming the approved college ID must happen together.
// If either update fails, the whole transaction is rolled back.
function activateUser({ userId, collegeId, now }) {
  const activate = db.transaction(() => {
    const user = db
      .prepare("SELECT id FROM users WHERE id = ? AND status = 'pending'")
      .get(userId);

    if (!user) return { ok: false, reason: 'not_pending' };

    const valid = db
      .prepare(
        `
        SELECT id, is_claimed, claimed_by_user_id
        FROM valid_college_ids
        WHERE college_id = ?
      `
      )
      .get(collegeId);

    if (!valid) return { ok: false, reason: 'not_approved' };

    if (valid.is_claimed && valid.claimed_by_user_id !== userId) {
      return { ok: false, reason: 'claimed' };
    }

    const updated = db
      .prepare(
        `
        UPDATE users
           SET status = 'active',
               email_verified_at = ?,
               otp_hash = NULL,
               otp_expires_at = NULL,
               otp_attempts = 0,
               updated_at = ?
         WHERE id = ? AND status = 'pending'
      `
      )
      .run(now, now, userId);

    if (updated.changes !== 1) return { ok: false, reason: 'not_pending' };

    db.prepare(
      `
      UPDATE valid_college_ids
         SET is_claimed = 1, claimed_by_user_id = ?, claimed_at = ?
       WHERE id = ?
    `
    ).run(userId, now, valid.id);

    return { ok: true };
  });

  // IMMEDIATE takes the write lock up front, which prevents two requests from
  // claiming the same college ID at the same moment.
  return activate.immediate();
}

function recordSuccessfulLogin({ userId, now }) {
  return db
    .prepare(
      `
      UPDATE users
         SET failed_login_attempts = 0,
             locked_until = NULL,
             last_login_at = ?,
             updated_at = ?
       WHERE id = ?
    `
    )
    .run(now, now, userId);
}

// Returns { locked, attempts }. On the lock threshold the counter is reset to
// zero and locked_until is set, so the account gets a fresh set of attempts
// after the lock expires.
function recordFailedLogin({ userId, now, maxAttempts, lockUntil }) {
  const record = db.transaction(() => {
    const user = db
      .prepare('SELECT failed_login_attempts FROM users WHERE id = ?')
      .get(userId);

    if (!user) return { locked: false, attempts: 0 };

    const attempts = user.failed_login_attempts + 1;

    if (attempts >= maxAttempts) {
      db.prepare(
        `
        UPDATE users
           SET failed_login_attempts = 0, locked_until = ?, updated_at = ?
         WHERE id = ?
      `
      ).run(lockUntil, now, userId);

      return { locked: true, attempts: maxAttempts };
    }

    db.prepare(
      `
      UPDATE users
         SET failed_login_attempts = ?, updated_at = ?
       WHERE id = ?
    `
    ).run(attempts, now, userId);

    return { locked: false, attempts };
  });

  return record.immediate();
}

module.exports = {
  findUserByCollegeId,
  findUserById,
  findValidCollegeId,
  createPendingUser,
  updateOtpForPendingUser,
  deletePendingUser,
  incrementOtpAttempts,
  activateUser,
  recordSuccessfulLogin,
  recordFailedLogin
};
