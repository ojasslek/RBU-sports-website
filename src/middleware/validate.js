// src/middleware/validate.js
// --------------------------------------------------
// Request validation using Zod.
// Validates types, formats, lengths, and trims inputs BEFORE
// any controller or database code runs.
// --------------------------------------------------

const { z } = require('zod');

// Middleware factory: validates req.body against a Zod schema
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error?.issues || result.error?.errors || [];
      const firstError = issues[0]?.message || 'Invalid input data';
      return res.status(400).json({ error: firstError });
    }
    req.body = result.data;
    next();
  };
}

// 1. Step 1 of Registration: Request OTP to RBU Email
const requestOtpSchema = z.object({
  email: z
    .string({ required_error: 'College email is required' })
    .trim()
    .toLowerCase()
    .email('Please enter a valid email address')
    .refine(
      (email) => email.endsWith('@rbunagpur.in'),
      { message: 'Only official college email addresses ending in @rbunagpur.in are allowed' }
    ),
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name cannot exceed 50 characters')
    .optional(),
});

// 2. Step 2 of Registration: Verify OTP and Set Password
const verifyOtpAndSetPasswordSchema = z.object({
  email: z
    .string({ required_error: 'College email is required' })
    .trim()
    .toLowerCase()
    .email('Please enter a valid email address')
    .refine(
      (email) => email.endsWith('@rbunagpur.in'),
      { message: 'Email must end in @rbunagpur.in' }
    ),
  otp: z
    .string({ required_error: 'Verification code is required' })
    .trim()
    .length(6, 'Verification code must be exactly 6 digits')
    .regex(/^\d{6}$/, 'Verification code must be 6 numeric digits'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters long')
    .max(100, 'Password is too long'),
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name cannot exceed 50 characters')
    .optional(),
});

// 3. Login Schema: Accepts either RBU Email or College ID
const loginSchema = z.object({
  identifier: z
    .string({ required_error: 'Email or College ID is required' })
    .trim()
    .min(1, 'Email or College ID is required'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

// 4. Resend OTP Schema
const resendOtpSchema = z.object({
  email: z
    .string({ required_error: 'College email is required' })
    .trim()
    .toLowerCase()
    .email('Please enter a valid email address')
    .refine(
      (email) => email.endsWith('@rbunagpur.in'),
      { message: 'Email must end in @rbunagpur.in' }
    ),
});

module.exports = {
  validateBody,
  requestOtpSchema,
  verifyOtpAndSetPasswordSchema,
  loginSchema,
  resendOtpSchema,
};
