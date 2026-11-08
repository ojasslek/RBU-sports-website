// tests/socket.test.js
// --------------------------------------------------
// Automated test suite for Phase 4: Real-time Socket.io Synchronization
// --------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as Client } from 'socket.io-client';
import request from 'supertest';
import { app, server } from '../src/server';
import db from '../src/db/connection';
import { daysFromTodayIST } from '../src/utils/time';

describe('Phase 4: Real-Time Socket.io Synchronization Suite', () => {
  let serverPort = null;
  let student1Token = null;
  let student2Token = null;
  let student1Id = null;
  let student2Id = null;
  let student1Cookie = null;
  let student2Cookie = null;
  let testSlotId = null;
  let testDate = null;

  beforeAll(async () => {
    testDate = daysFromTodayIST(4);

    // Setup 2 test students
    db.prepare("DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE college_id IN ('RBU2024005', 'RBUADMIN01'))").run();
    db.prepare("DELETE FROM users WHERE college_id IN ('RBU2024005', 'RBUADMIN01')").run();

    db.prepare(`
      INSERT INTO users (college_id, email, name, password_hash, role, is_verified)
      VALUES
        ('RBU2024005', 'student5@rbu.ac.in', 'Arjun Nair', 'hash', 'student', 1),
        ('RBUADMIN01',  'sports.admin@rbu.ac.in', 'Sports Secretary', 'hash', 'admin', 1)
    `).run();

    student1Id = db.prepare("SELECT id FROM users WHERE college_id = 'RBU2024005'").get().id;
    student2Id = db.prepare("SELECT id FROM users WHERE college_id = 'RBUADMIN01'").get().id;

    const jwt = await import('jsonwebtoken');
    const config = (await import('../src/config')).default || (await import('../src/config'));

    student1Token = jwt.sign({ id: student1Id, college_id: 'RBU2024005', role: 'student' }, config.jwtSecret, { expiresIn: '1h' });
    student2Token = jwt.sign({ id: student2Id, college_id: 'RBUADMIN01', role: 'admin' }, config.jwtSecret, { expiresIn: '1h' });

    student1Cookie = `token=${student1Token}`;
    student2Cookie = `token=${student2Token}`;

    const slot = db.prepare('SELECT id FROM slots WHERE facility_id = 3 LIMIT 1').get();
    testSlotId = slot.id;
    db.prepare('DELETE FROM bookings WHERE slot_id = ? AND booking_date = ?').run(testSlotId, testDate);

    // Listen on port for testing
    await new Promise((resolve) => {
      server.listen(0, () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  describe('1. Socket Authentication Handshake', () => {
    it('should reject unauthenticated socket connection', async () => {
      const socket = Client(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        reconnection: false,
      });

      const err = await new Promise((resolve) => {
        socket.on('connect_error', (e) => resolve(e));
        socket.on('connect', () => resolve(null));
      });

      expect(err).toBeDefined();
      expect(err.message).toContain('Authentication required');
      socket.close();
    });

    it('should accept socket connection with valid student cookie', async () => {
      const socket = Client(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: {
          Cookie: student1Cookie,
        },
      });

      const connected = await new Promise((resolve) => {
        socket.on('connect', () => resolve(true));
        socket.on('connect_error', () => resolve(false));
      });

      expect(connected).toBe(true);
      socket.close();
    });
  });

  describe('2. Live Broadcast of Slot State Transitions', () => {
    let clientSocket = null;

    beforeAll(async () => {
      // Connect observer socket (student 2)
      clientSocket = Client(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        extraHeaders: {
          Cookie: student2Cookie,
        },
      });

      await new Promise((resolve) => clientSocket.on('connect', resolve));
    });

    afterAll(() => {
      if (clientSocket) clientSocket.close();
    });

    it('should broadcast "held" event to observer when student 1 holds a slot', async () => {
      const eventPromise = new Promise((resolve) => {
        clientSocket.once('slot:update', (payload) => resolve(payload));
      });

      // Student 1 acquires hold via HTTP API
      const res = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', student1Cookie)
        .send({
          slot_id: testSlotId,
          booking_date: testDate,
        });

      expect(res.status).toBe(201);

      // Student 2 receives real-time WebSocket broadcast
      const event = await eventPromise;
      expect(event).toBeDefined();
      expect(event.slot_id).toBe(testSlotId);
      expect(event.booking_date).toBe(testDate);
      expect(event.status).toBe('held');

      // PRIVACY CHECK: Payload must NOT contain user details!
      expect(event.user_id).toBeUndefined();
      expect(event.college_id).toBeUndefined();
      expect(event.name).toBeUndefined();
    });

    it('should broadcast "booked" event to observer when student 1 confirms the booking', async () => {
      const activeHold = db.prepare('SELECT id FROM bookings WHERE user_id = ? AND status = ?').get(student1Id, 'held');

      const eventPromise = new Promise((resolve) => {
        clientSocket.once('slot:update', (payload) => resolve(payload));
      });

      // Student 1 confirms hold
      const res = await request(app)
        .post('/api/bookings/confirm')
        .set('Cookie', student1Cookie)
        .send({ booking_id: activeHold.id });

      expect(res.status).toBe(200);

      // Observer receives 'booked' status
      const event = await eventPromise;
      expect(event).toBeDefined();
      expect(event.slot_id).toBe(testSlotId);
      expect(event.status).toBe('booked');
    });
  });
});

