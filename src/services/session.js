// Creates and reads the login session cookie.
//
// The token is a signed JWT stored in an httpOnly cookie, so browser
// JavaScript cannot read it. The cookie is SameSite=Lax and becomes Secure
// when NODE_ENV=production (HTTPS).

const jwt = require('jsonwebtoken');
const config = require('../config');

const TOKEN_ISSUER = 'rbu-sports-booking';
const TOKEN_AUDIENCE = 'rbu-sports-web';
const TOKEN_ALGORITHM = 'HS256';

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/'
  };
}

function issueSession(res, user) {
  const token = jwt.sign(
    { role: user.role },
    config.jwtSecret,
    {
      subject: String(user.id),
      expiresIn: config.jwtExpiresMinutes * 60,
      algorithm: TOKEN_ALGORITHM,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE
    }
  );

  res.cookie(config.sessionCookieName, token, {
    ...baseCookieOptions(),
    maxAge: config.jwtExpiresMinutes * 60 * 1000
  });
}

function clearSession(res) {
  res.clearCookie(config.sessionCookieName, baseCookieOptions());
}

// Returns { userId, role } for a valid token, or null for anything else.
// We verify the algorithm, issuer and audience as well as the signature.
function readSessionToken(token) {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: [TOKEN_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE
    });

    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) return null;

    return { userId, role: payload.role };
  } catch {
    return null;
  }
}

module.exports = { issueSession, clearSession, readSessionToken };
