// tests/facilities.test.js
// --------------------------------------------------
// Automated test suite for Phase 2: Facility List & Daily Slot Grid
// --------------------------------------------------

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import db from '../src/db/connection';
import { todayIST, daysFromTodayIST, minutesFromNowUTC } from '../src/utils/time';

describe('Phase 2: Facilities & Daily Slot Grid Suite', () => {
  let authCookie = null;
  let testUserId = null;

  beforeAll(async () => {
    // 1. Ensure test student exists and is verified
    db.prepare("DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE college_id = 'RBU2024002')").run();
    db.prepare("DELETE FROM users WHERE college_id = 'RBU2024002'").run();
    db.prepare(`
      INSERT INTO users (college_id, email, name, password_hash, role, is_verified)
      VALUES ('RBU2024002', 'student2@rbu.ac.in', 'Priya Patel', 'hash', 'student', 1)
    `).run();

    const user = db.prepare("SELECT id FROM users WHERE college_id = 'RBU2024002'").get();
    testUserId = user.id;

    // 2. Log in to get auth cookie
    const jwt = await import('jsonwebtoken');
    const config = (await import('../src/config')).default || (await import('../src/config'));
    const token = jwt.sign(
      { id: testUserId, college_id: 'RBU2024002', role: 'student' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    authCookie = `token=${token}`;
  });

  describe('1. Facility Listing', () => {
    it('should reject unauthenticated access with 401', async () => {
      const res = await request(app).get('/api/facilities');
      expect(res.status).toBe(401);
    });

    it('should return list of all active facilities when authenticated', async () => {
      const res = await request(app)
        .get('/api/facilities')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.facilities)).toBe(true);
      expect(res.body.facilities.length).toBeGreaterThanOrEqual(5);

      const names = res.body.facilities.map(f => f.name);
      expect(names).toContain('Badminton Court 1');
      expect(names).toContain('Football Turf');
      expect(names).toContain('Gymnasium');
    });
  });

  describe('2. Date Constraints & Validation', () => {
    it('should reject missing date query parameter with 400', async () => {
      const res = await request(app)
        .get('/api/facilities/1/slots')
        .set('Cookie', authCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Date');
    });

    it('should reject past dates with 400', async () => {
      const pastDate = '2020-01-01';
      const res = await request(app)
        .get(`/api/facilities/1/slots?date=${pastDate}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('past dates');
    });

    it('should reject dates beyond the 7-day advance booking limit with 400', async () => {
      const farFutureDate = daysFromTodayIST(15);
      const res = await request(app)
        .get(`/api/facilities/1/slots?date=${farFutureDate}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('7 days in advance');
    });

    it('should reject nonexistent facility with 404', async () => {
      const date = todayIST();
      const res = await request(app)
        .get(`/api/facilities/99999/slots?date=${date}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('3. Slot Grid Status Accuracy & Expiry Handling', () => {
    const targetDate = daysFromTodayIST(2); // 2 days ahead to avoid 'past' interference

    beforeAll(() => {
      // Clear bookings on targetDate for clean assertions
      db.prepare('DELETE FROM bookings WHERE booking_date = ?').run(targetDate);
    });

    it('should show all slots as available when no bookings exist', async () => {
      const res = await request(app)
        .get(`/api/facilities/1/slots?date=${targetDate}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.slots.length).toBeGreaterThan(0);
      expect(res.body.slots.every(s => s.status === 'available')).toBe(true);
    });

    it('should show confirmed booking as "booked"', async () => {
      const slot = db.prepare('SELECT id FROM slots WHERE facility_id = 1 LIMIT 1').get();

      // Insert confirmed booking
      db.prepare(`
        INSERT INTO bookings (slot_id, user_id, booking_date, status)
        VALUES (?, ?, ?, 'confirmed')
      `).run(slot.id, testUserId, targetDate);

      const res = await request(app)
        .get(`/api/facilities/1/slots?date=${targetDate}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      const bookedSlot = res.body.slots.find(s => s.slot_id === slot.id);
      expect(bookedSlot).toBeDefined();
      expect(bookedSlot.status).toBe('booked');
    });

    it('should show active hold as "held"', async () => {
      // Pick second slot
      const slots = db.prepare('SELECT id FROM slots WHERE facility_id = 1 LIMIT 2').all();
      const secondSlot = slots[1];

      // Hold expires 5 minutes from now
      const holdExpires = minutesFromNowUTC(5);

      db.prepare(`
        INSERT INTO bookings (slot_id, user_id, booking_date, status, hold_expires_at)
        VALUES (?, ?, ?, 'held', ?)
      `).run(secondSlot.id, testUserId, targetDate, holdExpires);

      const res = await request(app)
        .get(`/api/facilities/1/slots?date=${targetDate}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      const heldSlot = res.body.slots.find(s => s.slot_id === secondSlot.id);
      expect(heldSlot).toBeDefined();
      expect(heldSlot.status).toBe('held');
      expect(heldSlot.is_your_hold).toBe(true);
    });

    it('should treat EXPIRED hold as "available" immediately at query time', async () => {
      // Pick third slot
      const slots = db.prepare('SELECT id FROM slots WHERE facility_id = 1 LIMIT 3').all();
      const thirdSlot = slots[2];

      // Hold expired 10 minutes ago
      const expiredHoldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO bookings (slot_id, user_id, booking_date, status, hold_expires_at)
        VALUES (?, ?, ?, 'held', ?)
      `).run(thirdSlot.id, testUserId, targetDate, expiredHoldTime);

      const res = await request(app)
        .get(`/api/facilities/1/slots?date=${targetDate}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      const expiredSlot = res.body.slots.find(s => s.slot_id === thirdSlot.id);
      expect(expiredSlot).toBeDefined();
      // Must be AVAILABLE because hold_expires_at <= nowUTC!
      expect(expiredSlot.status).toBe('available');
    });

    it('should NEVER expose who booked or held the slot (Privacy check)', async () => {
      const res = await request(app)
        .get(`/api/facilities/1/slots?date=${targetDate}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      // Verify no student ID, name, or user_id is in any slot object
      for (const slot of res.body.slots) {
        expect(slot.booked_by_user_id).toBeUndefined();
        expect(slot.user_id).toBeUndefined();
        expect(slot.college_id).toBeUndefined();
        expect(slot.name).toBeUndefined();
      }
    });
  });
});
