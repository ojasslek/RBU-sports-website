// Sends the registration verification code (OTP) by email.
//
// Local development without SMTP:
//   The code is printed in the server terminal instead. This block never runs
//   when NODE_ENV=production, because the server refuses to start without SMTP
//   configuration in production. Never copy that terminal output into a bug
//   report or screenshot.

const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (!config.smtp.host || !config.smtp.from) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      // Some local SMTP servers do not require a username.
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined
    });
  }

  return transporter;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return replacements[character];
  });
}

async function sendOtpEmail({ to, fullName, collegeId, otp }) {
  // Test hook: automated tests set globalThis.__rbuTestOtpSender to capture
  // the code instead of contacting SMTP. It is ignored outside NODE_ENV=test,
  // and the application never sets it.
  if (config.isTest && typeof globalThis.__rbuTestOtpSender === 'function') {
    await globalThis.__rbuTestOtpSender({ to, fullName, collegeId, otp });
    return;
  }

  const mailer = getTransporter();

  if (!mailer) {
    if (config.isProduction) {
      throw new Error('Email is not configured.');
    }

    // Development-only convenience. Real email is used in production.
    console.log('');
    console.log('============================================================');
    console.log('DEV ONLY: verification code (no SMTP configured)');
    console.log(`College ID: ${collegeId}`);
    console.log(`Code:       ${otp}`);
    console.log(`Expires:    ${config.otpExpiresMinutes} minutes`);
    console.log('============================================================');
    console.log('');
    return;
  }

  const safeName = escapeHtml(fullName || 'Student');
  const safeCollegeId = escapeHtml(collegeId);
  const safeOtp = escapeHtml(otp);

  const text = [
    `Hello ${fullName || 'Student'},`,
    '',
    `Your RBU Sports booking verification code is: ${otp}`,
    '',
    `College ID: ${collegeId}`,
    `The code expires in ${config.otpExpiresMinutes} minutes.`,
    '',
    'If you did not request this code, you can ignore this email.',
    ''
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #2D2D2D; line-height: 1.5;">
      <p>Hello ${safeName},</p>
      <p>Your RBU Sports booking verification code is:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">
        ${safeOtp}
      </p>
      <p>College ID: <strong>${safeCollegeId}</strong></p>
      <p>The code expires in ${config.otpExpiresMinutes} minutes.</p>
      <p>If you did not request this code, you can ignore this email.</p>
    </div>
  `;

  await mailer.sendMail({
    from: config.smtp.from,
    to,
    subject: 'Your RBU Sports verification code',
    text,
    html
  });
}

module.exports = { sendOtpEmail };
