// src/utils/email.js
// --------------------------------------------------
// Service to send transactional emails (OTPs, notifications).
//
// In DEVELOPMENT:
//   Prints the OTP directly to the terminal console with clear formatting,
//   so you can test instantly without setting up an SMTP server.
//
// In PRODUCTION:
//   Uses configured SMTP credentials from .env to deliver real emails.
// --------------------------------------------------

const config = require('../config');

async function sendOtpEmail(toEmail, studentName, otpCode) {
  // Always log to console in development for effortless testing
  console.log(`
  ================================================
   [EMAIL NOTIFICATION - OTP VERIFICATION]
   To     : ${studentName} <${toEmail}>
   Code   : ${otpCode}
   Expires: In ${config.otpExpiryMinutes} minutes
  ================================================
  `);

  // If SMTP is configured in .env, send real email via nodemailer
  if (config.smtp && config.smtp.host && config.smtp.user && config.smtp.pass) {
    try {
      console.log(`[email] Attempting to send email via SMTP (${config.smtp.host}) to ${toEmail}...`);
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      });

      const info = await transporter.sendMail({
        from: `"${config.collegeName} Sports" <${config.smtp.user}>`,
        to: toEmail,
        subject: `Your ${config.collegeName} Sports Verification Code: ${otpCode}`,
        text: `Hello ${studentName},\n\nYour account verification code is: ${otpCode}\n\nThis code will expire in ${config.otpExpiryMinutes} minutes.\nIf you did not request this, please ignore this email.`,
      });
      console.log(`[email] Message sent successfully! MessageId: ${info.messageId}`);
    } catch (err) {
      console.error('[email] Failed to send email via SMTP:', err.message);
    }
  } else {
    console.log('[email] SMTP credentials not set in .env. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to deliver real emails.');
  }

  return true;
}

module.exports = {
  sendOtpEmail,
};

