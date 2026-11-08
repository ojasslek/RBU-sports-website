// Very small structured logger.
// We print one JSON object per line so hosting platforms can search it.
// Never pass passwords, OTPs, JWTs, cookies, or full email addresses here.

function write(level, message, fields = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...fields
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields)
};
