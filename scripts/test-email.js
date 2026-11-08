// scripts/test-email.js
// Quick CLI tool to test if your SMTP configuration in .env works.
// Run with: node scripts/test-email.js your-email@rbunagpur.in

const config = require('../src/config');
const { sendOtpEmail } = require('../src/utils/email');

async function main() {
  const targetEmail = process.argv[2] || '25lekurwaleon@rbunagpur.in';

  console.log('--- Email Delivery Test ---');
  console.log(`SMTP Host: ${config.smtp.host || '(not set)'}`);
  console.log(`SMTP Port: ${config.smtp.port || '(not set)'}`);
  console.log(`SMTP User: ${config.smtp.user ? config.smtp.user : '(empty - you need to set SMTP_USER in .env)'}`);
  console.log(`SMTP Pass: ${config.smtp.pass ? '********' : '(empty - you need to set SMTP_PASS in .env)'}`);
  console.log('---------------------------');

  if (!config.smtp.user || !config.smtp.pass) {
    console.log('\n❌ Real email is NOT active yet because SMTP_USER and SMTP_PASS are empty in .env.');
    console.log('👉 Please open .env, add your Gmail and App Password, and run this script again.\n');
    return;
  }

  const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
  console.log(`Sending test OTP ${testOtp} to ${targetEmail}...`);

  await sendOtpEmail(targetEmail, 'Test Student', testOtp);
  console.log('\nFinished test execution.');
}

main().catch(err => {
  console.error('Fatal error during test:', err);
});

