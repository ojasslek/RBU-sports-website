// src/db/seed-users.js
// Sets clean, known test passwords for local development.

const db = require('./connection');
const bcrypt = require('bcryptjs');

const defaultPassword = 'Password123!';
const passwordHash = bcrypt.hashSync(defaultPassword, 12);

console.log('[seed] Setting known passwords for test accounts...');

// List of all sample valid college IDs to ensure they exist and have password Password123!
const testStudents = [
  { id: 'RBU2024001', email: 'student1@rbu.ac.in', name: 'Aarav Sharma', role: 'student' },
  { id: 'RBU2024002', email: 'student2@rbu.ac.in', name: 'Priya Patel', role: 'student' },
  { id: 'RBU2024003', email: 'student3@rbu.ac.in', name: 'Rohan Gupta', role: 'student' },
  { id: 'RBU2024004', email: 'student4@rbu.ac.in', name: 'Sneha Reddy', role: 'student' },
  { id: 'RBU2024005', email: 'student5@rbu.ac.in', name: 'Arjun Nair', role: 'student' },
  { id: 'RBUADMIN01',  email: 'sports.admin@rbu.ac.in', name: 'Sports Secretary', role: 'admin' },
];

for (const s of testStudents) {
  // Ensure valid_college_ids entry exists
  db.prepare(`
    INSERT OR IGNORE INTO valid_college_ids (college_id, email, name)
    VALUES (?, ?, ?)
  `).run(s.id, s.email, s.name);

  // Check if user exists
  const existing = db.prepare('SELECT id FROM users WHERE college_id = ?').get(s.id);
  if (existing) {
    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          is_verified = 1,
          failed_login_attempts = 0,
          locked_until = NULL,
          role = ?
      WHERE id = ?
    `).run(passwordHash, s.role, existing.id);
  } else {
    db.prepare(`
      INSERT INTO users (college_id, email, name, password_hash, role, is_verified)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(s.id, s.email, s.name, passwordHash, s.role);
  }
}

console.log('[seed] Successfully set password to "Password123!" for all test accounts.');

