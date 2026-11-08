// Small helper around zod.
// It returns the cleaned values or throws the first friendly validation
// message. Only the first message is shown so the UI stays simple.

const { HttpError } = require('./http-error');

function validate(schema, input) {
  const result = schema.safeParse(input);

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new HttpError(
      400,
      firstIssue ? firstIssue.message : 'Please check the form and try again.',
      'VALIDATION_FAILED'
    );
  }

  return result.data;
}

module.exports = { validate };
