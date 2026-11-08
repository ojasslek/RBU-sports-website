// tests/bookings.test.js
// --------------------------------------------------
// Automated test suite for Phase 3: Slot Holds & Bookings
// --------------------------------------------------

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import db from '../src/db/connection';
import { daysFromTodayIST } from '../src/utils/time';

describe('Phase 3: Slot Hold & Confirmation Suite', () => {
  let student1Cookie = null;
  let student2Cookie = null;
  let student1Id = null;
  let student2Id = null;
  let testSlotId = null;
  let testDate = null;

  beforeAll(async () => {
    testDate = daysFromTodayIST(3);

    // Setup 2 test students
    db.prepare("DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE college_id IN ('RBU2024003', 'RBU2024004'))").run();
    db.prepare("DELETE FROM users WHERE college_id IN ('RBU2024003', 'RBU2024004')").run();

    db.prepare(`
      INSERT INTO users (college_id, email, name, password_hash, role, is_verified)
      VALUES
        ('RBU2024003', 'student3@rbu.ac.in', 'Rohan Gupta', 'hash', 'student', 1),
        ('RBU2024004', 'student4@rbu.ac.in', 'Sneha Reddy', 'hash', 'student', 1)
    `).run();

    student1Id = db.prepare("SELECT id FROM users WHERE college_id = 'RBU2024003'").get().id;
    student2Id = db.prepare("SELECT id FROM users WHERE college_id = 'RBU2024004'").get().id;

    // Tokens
    const jwt = await import('jsonwebtoken');
    const config = (await import('../src/config')).default || (await import('../src/config'));

    const token1 = jwt.sign({ id: student1Id, college_id: 'RBU2024003', role: 'student' }, config.jwtSecret, { expiresIn: '1h' });
    const token2 = jwt.sign({ id: student2Id, college_id: 'RBU2024004', role: 'student' }, config.jwtSecret, { expiresIn: '1h' });

    student1Cookie = `token=${token1}`;
    student2Cookie = `token=${token2}`;

    // Pick an active slot in Badminton Court 1
    const slot = db.prepare('SELECT id FROM slots WHERE facility_id = 1 AND is_active = 1 LIMIT 1').get();
    testSlotId = slot.id;

    // Clean any prior bookings for testSlotId on testDate
    db.prepare('DELETE FROM bookings WHERE slot_id = ? AND booking_date = ?').run(testSlotId, testDate);
  });

  describe('1. Slot Hold Acquisition', () => {
    it('should allow student 1 to acquire a 5-minute hold on an available slot', async () => {
      const res = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student1Cookie)
        .send({
          slot_id: testSlotId,
          booking_date: testDate,
        });

      expect(res.status).toBe(201);
      expect(res.body.booking.status).toBe('held');
      expect(res.body.booking.hold_expires_at).toBeDefined();

      // Verify in DB
      const row = db.prepare('SELECT status, user_id FROM bookings WHERE id = ?').get(res.body.booking.id);
      expect(row.status).toBe('held');
      expect(row.user_id).toBe(student1Id);
    });

    it('should reject student 2 when attempting to hold the same currently held slot', async () => {
      const res = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student2Cookie)
        .send({
          slot_id: testSlotId,
          booking_date: testDate,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('temporarily held by another student');
    });

    it('should allow holding if previous hold has expired', async () => {
      // Artificially expire student 1's hold in DB
      const pastTime = new Date(Date.now() - 60 * 1000).toISOString();
      db.prepare(`
        UPDATE bookings
        SET hold_expires_at = ?
        WHERE slot_id = ? AND booking_date = ? AND status = 'held'
      `).run(pastTime, testSlotId, testDate);

      // Student 2 attempts hold now -> should succeed!
      const res = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student2Cookie)
        .send({
          slot_id: testSlotId,
          booking_date: testDate,
        });

      expect(res.status).toBe(201);
      expect(res.body.booking.status).toBe('held');
      expect(db.prepare('SELECT user_id FROM bookings WHERE id = ?').get(res.body.booking.id).user_id).toBe(student2Id);
    });
  });

  describe('2. Confirmation of Held Slot', () => {
    it('should allow student 2 to confirm their active hold', async () => {
      const activeHold = db.prepare(`
        SELECT id FROM bookings WHERE user_id = ? AND status = 'held' AND booking_date = ?
      `).get(student2Id, testDate);

      const res = await request(app)
        .post('/api/bookings/confirm')
        .set('Cookie', student2Cookie)
        .send({ booking_id: activeHold.id });

      expect(res.status).toBe(200);
      expect(res.body.booking.status).toBe('confirmed');

      const updated = db.prepare('SELECT status, hold_expires_at FROM bookings WHERE id = ?').get(activeHold.id);
      expect(updated.status).toBe('confirmed');
      expect(updated.hold_expires_at).toBeNull();
    });

    it('should reject holding or confirming an already confirmed slot', async () => {
      const res = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student1Cookie)
        .send({
          slot_id: testSlotId,
          booking_date: testDate,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already been booked');
    });
  });

  describe('3. Max 2 Bookings Per Day Rule', () => {
    it('should enforce max 2 confirmed bookings per day per student', async () => {
      // Student 2 already has 1 booking on testDate from previous test.
      // Pick 2 more slots
      const slots = db.prepare('SELECT id FROM slots WHERE facility_id = 1 AND id != ? LIMIT 2').all(testSlotId);
      const slotB = slots[0].id;
      const slotC = slots[1].id;

      // Clean slots
      db.prepare('DELETE FROM bookings WHERE slot_id IN (?, ?) AND booking_date = ?').run(slotB, slotC, testDate);

      // Book second slot (allowed: total 2)
      const holdRes2 = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student2Cookie)
        .send({ slot_id: slotB, booking_date: testDate });
      expect(holdRes2.status).toBe(201);

      const confirmRes2 = await request(app)
        .post('/api/bookings/confirm')
        .set('Cookie', student2Cookie)
        .send({ booking_id: holdRes2.body.booking.id });
      expect(confirmRes2.status).toBe(200);

      // Try to hold a third slot on the same day (should be rejected with 400)
      const holdRes3 = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student2Cookie)
        .send({ slot_id: slotC, booking_date: testDate });

      expect(holdRes3.status).toBe(400);
      expect(holdRes3.body.error).toContain('maximum of 2 slots per day');
    });
  });

  describe('4. Voluntary Release of Hold', () => {
    it('should allow student to voluntarily release their hold before 5 minutes', async () => {
      // Pick another slot for student 1
      const slot = db.prepare('SELECT id FROM slots WHERE facility_id = 2 LIMIT 1').get();
      db.prepare('DELETE FROM bookings WHERE slot_id = ? AND booking_date = ?').run(slot.id, testDate);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student1Cookie)
        .send({ slot_id: slot.id, booking_date: testDate });
      expect(holdRes.status).toBe(201);

      const releaseRes = await request(app)
        .post('/api/bookings/release')
        .set('Cookie', student1Cookie)
        .send({ booking_id: holdRes.body.booking.id });

      expect(releaseRes.status).toBe(200);
      expect(releaseRes.body.released).toBe(true);

      const status = db.prepare('SELECT status FROM bookings WHERE id = ?').get(holdRes.body.booking.id).status;
      expect(status).toBe('expired');
    });
  });
});

