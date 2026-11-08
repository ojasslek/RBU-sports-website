// tests/concurrency.test.js
// --------------------------------------------------
// High-Concurrency & Race Condition Verification Suite.
//
// Tests:
// 1. 20 simultaneous student requests race to hold the exact same slot at the
//    exact same millisecond. Exactly 1 must succeed (201) and 19 must fail (409).
// 2. Database validation: exactly 1 row exists in SQLite for (slot_id, booking_date).
// 3. Repeated / rapid double-clicks (idempotent confirmation).
// 4. Timezone edge cases: midnight rollover and IST offset consistency.
// --------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import db from '../src/db/connection';
import { daysFromTodayIST, todayIST, istToUTC, isSlotInPast } from '../src/utils/time';

describe('Phase 6: Concurrency, Race Condition & Edge Case Suite', () => {
  const NUM_STUDENTS = 20;
  const studentTokens = [];
  const studentCookies = [];
  let testSlotId = null;
  let testDate = null;

  beforeAll(async () => {
    testDate = daysFromTodayIST(6);
    const jwt = await import('jsonwebtoken');
    const config = (await import('../src/config')).default || (await import('../src/config'));

    // 1. Create 20 unique test students in DB
    for (let i = 1; i <= NUM_STUDENTS; i++) {
      const collegeId = `RBU_RACE_${String(i).padStart(2, '0')}`;
      const email = `race_${i}@rbu.ac.in`;
      const name = `Race Student ${i}`;

      // Insert valid ID and user
      db.prepare("INSERT OR IGNORE INTO valid_college_ids (college_id, email, name) VALUES (?, ?, ?)").run(collegeId, email, name);
      db.prepare("DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE college_id = ?)").run(collegeId);
      db.prepare("DELETE FROM users WHERE college_id = ?").run(collegeId);

      db.prepare(`
        INSERT INTO users (college_id, email, name, password_hash, role, is_verified)
        VALUES (?, ?, ?, 'hash', 'student', 1)
      `).run(collegeId, email, name);

      const user = db.prepare('SELECT id FROM users WHERE college_id = ?').get(collegeId);
      const token = jwt.sign({ id: user.id, college_id: collegeId, role: 'student' }, config.jwtSecret, { expiresIn: '1h' });

      studentTokens.push(token);
      studentCookies.push(`token=${token}`);
    }

    // 2. Select an active slot in Football Turf
    const slot = db.prepare('SELECT id FROM slots WHERE facility_id = 3 LIMIT 1').get();
    testSlotId = slot.id;

    // Clear any bookings on this slot for testDate
    db.prepare('DELETE FROM bookings WHERE slot_id = ? AND booking_date = ?').run(testSlotId, testDate);
  });

  afterAll(() => {
    // Clean up test students
    db.prepare("DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE college_id LIKE 'RBU_RACE_%')").run();
    db.prepare("DELETE FROM users WHERE college_id LIKE 'RBU_RACE_%'").run();
    db.prepare("DELETE FROM valid_college_ids WHERE college_id LIKE 'RBU_RACE_%'").run();
  });

  describe('1. 20 Simultaneous Requests Racing for 1 Slot', () => {
    it('should allow EXACTLY 1 student to hold the slot and reject all 19 others with 409 Conflict', async () => {
      // Fire 20 requests at the EXACT same instant using Promise.all
      const promises = studentCookies.map((cookie) =>
        request(app)
          .post('/api/bookings/hold')
          .set('Cookie', cookie)
          .send({
            slot_id: testSlotId,
            booking_date: testDate,
          })
      );

      const results = await Promise.all(promises);

      // Count HTTP status outcomes
      const successResponses = results.filter(r => r.status === 201);
      const conflictResponses = results.filter(r => r.status === 409);
      const otherResponses = results.filter(r => r.status !== 201 && r.status !== 409);

      // Verify ZERO unexpected crashes or errors
      expect(otherResponses.length).toBe(0);

      // EXACTLY ONE student got the hold!
      expect(successResponses.length).toBe(1);

      // EXACTLY NINETEEN students received 409 Conflict!
      expect(conflictResponses.length).toBe(NUM_STUDENTS - 1);

      // Check the error message given to the 19 rejected students
      conflictResponses.forEach((res) => {
        expect(res.body.error).toContain('temporarily held by another student');
      });

      // Database verification: Verify SQLite holds EXACTLY 1 active booking row
      const dbRows = db.prepare(`
        SELECT COUNT(*) AS total
        FROM bookings
        WHERE slot_id = ? AND booking_date = ? AND status = 'held'
      `).get(testSlotId, testDate);

      expect(dbRows.total).toBe(1);
    });
  });

  describe('2. Repeated Double-Click Defense (Idempotent Confirmation)', () => {
    it('should handle rapid double-clicks on confirmation safely without error', async () => {
      // Find the winning student from the previous race
      const winningHold = db.prepare(`
        SELECT id, user_id FROM bookings
        WHERE slot_id = ? AND booking_date = ? AND status = 'held'
      `).get(testSlotId, testDate);

      const winningUser = db.prepare('SELECT college_id FROM users WHERE id = ?').get(winningHold.user_id);
      const winningStudentCookie = studentCookies.find((_, idx) => `RBU_RACE_${String(idx + 1).padStart(2, '0')}` === winningUser.college_id);

      // Simulate a user rapidly double-clicking "Confirm Booking"
      const [click1, click2] = await Promise.all([
        request(app)
          .post('/api/bookings/confirm')
          .set('Cookie', winningStudentCookie)
          .send({ booking_id: winningHold.id }),
        request(app)
          .post('/api/bookings/confirm')
          .set('Cookie', winningStudentCookie)
          .send({ booking_id: winningHold.id }),
      ]);

      // Both requests resolve safely with 200 OK without crashing or creating duplicates
      expect(click1.status).toBe(200);
      expect(click2.status).toBe(200);

      // Database verification: status is confirmed, exactly 1 row exists
      const finalCount = db.prepare(`
        SELECT COUNT(*) AS total FROM bookings
        WHERE slot_id = ? AND booking_date = ? AND status = 'confirmed'
      `).get(testSlotId, testDate);

      expect(finalCount.total).toBe(1);
    });
  });

  describe('3. Timezone Consistency & Date Boundary Review', () => {
    it('should calculate IST local date accurately without UTC date drift', () => {
      const today = todayIST();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Check conversion from IST 23:00 to UTC
      // 23:00 IST is 17:30 UTC of the SAME calendar day
      const istTime = '23:00';
      const utcIso = istToUTC(today, istTime);
      expect(utcIso).toContain('T17:30:00.000Z');
    });

    it('should flag past slots earlier today while keeping future slots today available', () => {
      const today = todayIST();

      // 01:00 AM IST today has definitely passed
      expect(isSlotInPast(today, '01:00')).toBe(true);

      // 23:59 PM IST today has not passed (unless running at 23:59:59)
      const now = new Date();
      const istHours = (now.getUTCHours() + 5.5) % 24;
      if (istHours < 23) {
        expect(isSlotInPast(today, '23:50')).toBe(false);
      }
    });
  });
});

