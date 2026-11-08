// An error that is safe to show to the browser.
// Anything thrown that is NOT an HttpError becomes a generic 500 response,
// so SQL errors and stack traces never reach the user.

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

module.exports = { HttpError };
