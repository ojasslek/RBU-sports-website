// Password hashing and checking.
// bcrypt is intentionally slow (cost 12), which makes guessing passwords
// expensive for an attacker. Never store or log the plain password.

const bcrypt = require('bcrypt');
const config = require('../config');

async function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptRounds);
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

// When a college ID does not exist, login still spends time checking a dummy
// hash. Without this, an attacker could measure response times to discover
// which college IDs are registered.
const dummyHashPromise = bcrypt.hash(
  'this-is-not-a-real-account-password',
  config.bcryptRounds
);

async function spendDummyPasswordCheck(password) {
  const dummyHash = await dummyHashPromise;
  await bcrypt.compare(password, dummyHash);
  return false;
}

module.exports = { hashPassword, verifyPassword, spendDummyPasswordCheck };
