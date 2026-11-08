// tests/auth.test.js
// --------------------------------------------------
// Automated test suite for Simplified RBU Email (@rbunagpur.in) Auth & OTP Flow
// --------------------------------------------------

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import db from '../src/db/connection';

describe('Simplified RBU Email Registration & Password Set Suite', () => {
  const testEmail = 'ojas.test@rbunagpur.in';
  const testPassword = 'MySecretPassword123!';

  beforeAll(() => {
    db.prepare("DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@rbunagpur.in')").run();
    db.prepare("DELETE FROM users WHERE email LIKE '%@rbunagpur.in'").run();
  });

  describe('1. Step 1: Request Verification Code', () => {
    it('should reject non-rbunagpur.in email domain with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register-request')
        .send({
          email: 'student@gmail.com',
          name: 'Fake Student',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('@rbunagpur.in');
    });

    it('should accept valid @rbunagpur.in email and dispatch 6-digit OTP', async () => {
      const res = await request(app)
        .post('/api/auth/register-request')
        .send({
          email: testEmail,
          name: 'Ojas Test',
        });

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testEmail);

      // Verify unverified user row created in SQLite
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(testEmail);
      expect(user).toBeDefined();
      expect(user.is_verified).toBe(0);
      expect(user.otp_hash).toBeDefined();
      expect(user.password_hash).toBe('PENDING_PASSWORD_SET');
    });
  });

  describe('2. Step 2: Verify Code and Set Password', () => {
    it('should reject activation with incorrect OTP code', async () => {
      const res = await request(app)
        .post('/api/auth/register-verify')
        .send({
          email: testEmail,
          otp: '000000',
          password: testPassword,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Incorrect verification code');
    });

    it('should reject password under 8 characters', async () => {
      const res = await request(app)
        .post('/api/auth/register-verify')
        .send({
          email: testEmail,
          otp: '123456',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('at least 8 characters');
    });

    it('should activate account with valid OTP, set password, and return session cookie', async () => {
      const bcrypt = await import('bcryptjs');
      const testOtp = '789123';
      const testHash = bcrypt.hashSync(testOtp, 12);

      // Set known OTP in DB for testing
      db.prepare('UPDATE users SET otp_hash = ? WHERE email = ?').run(testHash, testEmail);

      const res = await request(app)
        .post('/api/auth/register-verify')
        .send({
          email: testEmail,
          otp: testOtp,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(testEmail);

      // Verify cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('token=');
      expect(cookies[0]).toContain('HttpOnly');

      // Verify DB row activated with real password hash
      const user = db.prepare('SELECT is_verified, password_hash, otp_hash FROM users WHERE email = ?').get(testEmail);
      expect(user.is_verified).toBe(1);
      expect(user.otp_hash).toBeNull();
      expect(user.password_hash.startsWith('$2')).toBe(true);
      expect(bcrypt.compareSync(testPassword, user.password_hash)).toBe(true);
    });
  });

  describe('3. Login with RBU Email or College ID', () => {
    it('should successfully log in with @rbunagpur.in email and new password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(testEmail);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('token=');
    });

    it('should return generic error for wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: testEmail,
          password: 'WrongPassword!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password.');
    });
  });

  describe('4. Session Check (GET /api/auth/me)', () => {
    it('should return student profile when authenticated via cookie', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: testEmail,
          password: testPassword,
        });

      const authCookie = loginRes.headers['set-cookie'][0];

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(testEmail);
    });
  });
});
