// scripts/delete-user.js
// Removes a user and their bookings so you can re-test the registration & OTP flow.
const db = require('../src/db/connection');

const targetEmail = process.argv[2] || '25lekurwaleon@rbunagpur.in';

const user = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(targetEmail);
if (user) {
  db.prepare('DELETE FROM bookings WHERE user_id = ?').run(user.id);
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  console.log(`Deleted user (ID: ${user.id}) and all associated records for: ${targetEmail}`);
} else {
  console.log(`No user found with email: ${targetEmail}`);
}
