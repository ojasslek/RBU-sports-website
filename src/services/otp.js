// One-time password (OTP) helpers for email verification.
//
// The plain code is only sent by email. The database stores an HMAC hash of
// the code, so a leaked database does not reveal usable codes.
//
// The JWT secret is used as the HMAC key. This means changing JWT_SECRET
// invalidates any OTP that is still pending, which is acceptable.

const crypto = require('node:crypto');
const config = require('../config');

function normalizeCollegeId(collegeId) {
  return String(collegeId).trim().toUpperCase();
}

function generateOtp() {
  // randomInt is cryptographically secure. padStart keeps leading zeroes.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashOtp(collegeId, otp) {
  return crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`otp:${normalizeCollegeId(collegeId)}:${otp}`)
    .digest('hex');
}

function otpMatches(collegeId, otp, storedHash) {
  if (typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash)) {
    return false;
  }

  const expected = Buffer.from(hashOtp(collegeId, otp), 'hex');
  const actual = Buffer.from(storedHash, 'hex');

  if (expected.length !== actual.length) return false;

  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  normalizeCollegeId,
  generateOtp,
  hashOtp,
  otpMatches
};
