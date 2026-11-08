// tests/my-bookings.test.js
// --------------------------------------------------
// Automated test suite for Phase 5: "My Bookings" & Direct Cancellation
// --------------------------------------------------

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import db from '../src/db/connection';
import { daysFromTodayIST } from '../src/utils/time';

describe('Phase 5: "My Bookings" & Direct Cancellation Suite', () => {
  let student1Cookie = null;
  let student2Cookie = null;
  let student1Id = null;
  let student2Id = null;
  let futureDate = null;
  let bookingId = null;
  let slotId = null;

  beforeAll(async () => {
    futureDate = daysFromTodayIST(5);

    // Setup 2 test students
    db.prepare("DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE college_id IN ('RBU2024001', 'RBU2024002'))").run();
    db.prepare("DELETE FROM users WHERE college_id IN ('RBU2024001', 'RBU2024002')").run();

    db.prepare(`
      INSERT INTO users (college_id, email, name, password_hash, role, is_verified)
      VALUES
        ('RBU2024001', 'student1@rbu.ac.in', 'Aarav Sharma', 'hash', 'student', 1),
        ('RBU2024002', 'student2@rbu.ac.in', 'Priya Patel', 'hash', 'student', 1)
    `).run();

    const u1 = db.prepare("SELECT id FROM users WHERE college_id = 'RBU2024001'").get();
    const u2 = db.prepare("SELECT id FROM users WHERE college_id = 'RBU2024002'").get();
    student1Id = u1.id;
    student2Id = u2.id;

    const jwt = await import('jsonwebtoken');
    const config = (await import('../src/config')).default || (await import('../src/config'));

    const token1 = jwt.sign({ id: student1Id, college_id: 'RBU2024001', role: 'student' }, config.jwtSecret, { expiresIn: '1h' });
    const token2 = jwt.sign({ id: student2Id, college_id: 'RBU2024002', role: 'student' }, config.jwtSecret, { expiresIn: '1h' });

    student1Cookie = `token=${token1}`;
    student2Cookie = `token=${token2}`;

    // Pick an active slot in Badminton Court 1
    const slot = db.prepare('SELECT id FROM slots WHERE facility_id = 1 LIMIT 1').get();
    slotId = slot.id;
    db.prepare('DELETE FROM bookings WHERE slot_id = ? AND booking_date = ?').run(slotId, futureDate);

    // Create a confirmed booking for Student 1
    const res = db.prepare(`
      INSERT INTO bookings (slot_id, user_id, booking_date, status)
      VALUES (?, ?, ?, 'confirmed')
    `).run(slotId, student1Id, futureDate);

    bookingId = db.prepare('SELECT id FROM bookings WHERE slot_id = ? AND booking_date = ?').get(slotId, futureDate).id;
  });

  describe('1. Authentication & Retrieval of Personal Bookings', () => {
    it('should reject unauthenticated access with 401', async () => {
      const res = await request(app).get('/api/bookings/my');
      expect(res.status).toBe(401);
    });

    it('should return student 1 personal booking under upcoming list', async () => {
      const res = await request(app)
        .get('/api/bookings/my')
        .set('Cookie', student1Cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.upcoming)).toBe(true);
      expect(Array.isArray(res.body.past)).toBe(true);

      const found = res.body.upcoming.find(b => b.id === bookingId);
      expect(found).toBeDefined();
      expect(found.facility_name).toBe('Badminton Court 1');
      expect(found.status).toBe('confirmed');
    });

    it('should NOT show student 1 booking in student 2 upcoming list (IDOR prevention)', async () => {
      const res = await request(app)
        .get('/api/bookings/my')
        .set('Cookie', student2Cookie);

      expect(res.status).toBe(200);
      const found = res.body.upcoming.find(b => b.id === bookingId);
      expect(found).toBeUndefined();
    });
  });

  describe('2. Direct Cancellation & Authorization (No 2-Hour Cutoff)', () => {
    it('should reject cancellation attempt by student 2 on student 1 booking with 403 (IDOR defense)', async () => {
      const res = await request(app)
        .post('/api/bookings/cancel')
        .set('Cookie', student2Cookie)
        .send({ booking_id: bookingId });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('cannot cancel another student');
    });

    it('should allow student 1 to directly cancel their confirmed booking', async () => {
      const res = await request(app)
        .post('/api/bookings/cancel')
        .set('Cookie', student1Cookie)
        .send({ booking_id: bookingId });

      expect(res.status).toBe(200);
      expect(res.body.booking.status).toBe('cancelled');

      // Verify in database
      const row = db.prepare('SELECT status FROM bookings WHERE id = ?').get(bookingId);
      expect(row.status).toBe('cancelled');
    });

    it('should reject cancelling an already cancelled booking with 400', async () => {
      const res = await request(app)
        .post('/api/bookings/cancel')
        .set('Cookie', student1Cookie)
        .send({ booking_id: bookingId });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already been cancelled');
    });

    it('should immediately allow another student to book the cancelled slot', async () => {
      // Student 2 can now hold the slot because the cancelled booking is excluded from the unique index
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student2Cookie)
        .send({
          slot_id: slotId,
          booking_date: futureDate,
        });

      expect(holdRes.status).toBe(201);
      expect(holdRes.body.booking.status).toBe('held');

      // Clean up hold
      db.prepare('DELETE FROM bookings WHERE id = ?').run(holdRes.body.booking.id);
    });
  });
});
