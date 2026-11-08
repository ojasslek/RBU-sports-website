// Reads the session cookie and attaches the current user to req.user.
// It also blocks suspended or deleted accounts immediately, even if their
// old JWT has not expired yet.

const config = require('../config');
const data = require('../data/users');
const session = require('../services/session');

function loadUser(req, res, next) {
  const token = req.cookies ? req.cookies[config.sessionCookieName] : null;

  if (!token) {
    req.user = null;
    return next();
  }

  const payload = session.readSessionToken(token);
  if (!payload) {
    session.clearSession(res);
    req.user = null;
    return next();
  }

  const user = data.findUserById(payload.userId);

  if (!user || user.status !== 'active') {
    session.clearSession(res);
    req.user = null;
    return next();
  }

  // Only safe fields are put on the request object.
  req.user = {
    id: user.id,
    collegeId: user.college_id,
    fullName: user.full_name,
    email: user.email,
    role: user.role
  };

  return next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Please log in.', code: 'AUTH_REQUIRED' });
    return;
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Please log in.', code: 'AUTH_REQUIRED' });
    return;
  }

  if (req.user.role !== 'admin') {
    // 403 instead of 404 is fine here; there is no secret route to hide.
    res.status(403).json({ error: 'Admin access required.', code: 'ADMIN_REQUIRED' });
    return;
  }

  next();
}

module.exports = { loadUser, requireAuth, requireAdmin };
