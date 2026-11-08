import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import bcrypt from 'bcrypt';

// The environment must be set BEFORE src/config.js is loaded.
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rbu-slots-test-'));

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDirectory, 'slots-test.sqlite');
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.JWT_SECRET =
  'test-only-secret-that-is-definitely-longer-than-32-characters';

const schemaSql = fs.readFileSync(
  new URL('../migrations/001_initial_schema.sql', import.meta.url),
  'utf8'
);

const PASSWORD = 'Password123';

let app;
let db;
let slotService;
let time;
let agent;
let passwordHash = '';

async function getCsrfToken(activeAgent) {
  const response = await activeAgent.get('/api/auth/csrf');
  expect(response.status).toBe(200);
  return response.body.csrfToken;
}

async function login(activeAgent) {
  const token = await getCsrfToken(activeAgent);
  return activeAgent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ collegeId: 'RBU-SLOT-001', password: PASSWORD });
}

function insertUser() {
  db.prepare(
    `
    INSERT INTO users
      (college_id, full_name, email, password_hash, role, status, email_verified_at)
    VALUES (?, ?, ?, ?, 'student', 'active', ?)
  `
  ).run(
    'RBU-SLOT-001',
    'Slot Test Student',
    'slots@example.invalid',
    passwordHash,
    new Date().toISOString()
  );
}

function insertFacility(overrides = {}) {
  const values = {
    name: 'Badminton Court 1',
    description: 'Indoor court',
    location: 'Indoor Sports Hall',
    isActive: 1,
    ...overrides
  };

  const result = db
    .prepare(
      `
      INSERT INTO facilities (name, description, location, is_active)
      VALUES (?, ?, ?, ?)
    `
    )
    .run(values.name, values.description, values.location, values.isActive);

  return Number(result.lastInsertRowid);
}

function insertSlot(facilityId, startTime = '18:00', endTime = '19:00') {
  const result = db
    .prepare(
      `
      INSERT INTO slots (facility_id, start_time, end_time)
      VALUES (?, ?, ?)
    `
    )
    .run(facilityId, startTime, endTime);

  return Number(result.lastInsertRowid);
}

function insertBooking({
  userId,
  slotId,
  bookingDate,
  startTime,
  endTime,
  status,
  holdExpiresAt = null
}) {
  db.prepare(
    `
    INSERT INTO bookings
      (user_id, slot_id, booking_date, starts_at_utc, ends_at_utc,
       status, hold_expires_at, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    userId,
    slotId,
    bookingDate,
    time.collegeDateTimeToUtcIso(bookingDate, startTime),
    time.collegeDateTimeToUtcIso(bookingDate, endTime),
    status,
    holdExpiresAt,
    status === 'confirmed' ? new Date().toISOString() : null
  );
}

function findUserId() {
  return db
    .prepare('SELECT id FROM users WHERE college_id = ?')
    .get('RBU-SLOT-001').id;
}

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);

  db = (await import('../src/db/connection.js')).default;
  db.exec(schemaSql);

  slotService = await import('../src/services/slot-service.js');
  time = await import('../src/utils/time.js');

  app = (await import('../src/app.js')).default;
  agent = request.agent(app);
});

beforeEach(() => {
  db.exec(`
    DELETE FROM bookings;
    DELETE FROM slots;
    DELETE FROM facilities;
    DELETE FROM users;
    DELETE FROM valid_college_ids;
  `);
});

afterAll(() => {
  db.close();

  try {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  } catch {
    // Windows may hold the database file briefly. The OS cleans temp files.
  }
});

describe('Slot availability API', () => {
  it('requires a signed-in student', async () => {
    const facilities = await request(app).get('/api/facilities');
    expect(facilities.status).toBe(401);
    expect(facilities.body.code).toBe('AUTH_REQUIRED');

    const slots = await request(app).get('/api/slots?facilityId=1&date=2026-11-07');
    expect(slots.status).toBe(401);
  });

  it('returns active facilities and the seven-day date window', async () => {
    insertUser();
    insertFacility({ name: 'Active Court' });
    insertFacility({ name: 'Closed Court', isActive: 0 });

    expect((await login(agent)).status).toBe(200);

    const response = await agent.get('/api/facilities');

    expect(response.status).toBe(200);
    expect(response.body.facilities).toHaveLength(1);
    expect(response.body.facilities[0].name).toBe('Active Court');
    expect(response.body.facilities[0].is_active).toBeUndefined();

    expect(response.body.days).toHaveLength(8);
    expect(response.body.days[0].isToday).toBe(true);
    expect(response.body.days[0].date).toBe(response.body.today);
    expect(response.body.minDate).toBe(response.body.today);
    expect(response.body.maxDate).toBe(
      time.addDaysToDateString(response.body.today, 7)
    );
  });

  it('marks past, in-progress, booked, held, expired and free slots correctly', async () => {
    const userId = (() => {
      insertUser();
      return findUserId();
    })();

    const facilityId = insertFacility();

    const pastSlot = insertSlot(facilityId, '06:00', '07:00');
    const ongoingSlot = insertSlot(facilityId, '11:00', '12:00');
    const freeSlot = insertSlot(facilityId, '12:00', '13:00');
    const bookedSlot = insertSlot(facilityId, '13:00', '14:00');
    const heldSlot = insertSlot(facilityId, '14:00', '15:00');
    const expiredHoldSlot = insertSlot(facilityId, '15:00', '16:00');

    // 06:00Z is 11:30 IST on 2026-11-07.
    const now = '2026-11-07T06:00:00.000Z';
    const bookingDate = '2026-11-07';

    insertBooking({
      userId,
      slotId: bookedSlot,
      bookingDate,
      startTime: '13:00',
      endTime: '14:00',
      status: 'confirmed'
    });

    insertBooking({
      userId,
      slotId: heldSlot,
      bookingDate,
      startTime: '14:00',
      endTime: '15:00',
      status: 'held',
      holdExpiresAt: '2026-11-07T06:05:00.000Z'
    });

    insertBooking({
      userId,
      slotId: expiredHoldSlot,
      bookingDate,
      startTime: '15:00',
      endTime: '16:00',
      status: 'held',
      holdExpiresAt: '2026-11-07T05:00:00.000Z'
    });

    const board = slotService.getSlotBoard({
      facilityId,
      date: bookingDate,
      now
    });

    const statusBySlotId = new Map(
      board.slots.map((slot) => [slot.id, slot.status])
    );

    expect(statusBySlotId.get(pastSlot)).toBe('past');
    expect(statusBySlotId.get(ongoingSlot)).toBe('ongoing');
    expect(statusBySlotId.get(freeSlot)).toBe('available');
    expect(statusBySlotId.get(bookedSlot)).toBe('booked');
    expect(statusBySlotId.get(heldSlot)).toBe('held');
    expect(statusBySlotId.get(expiredHoldSlot)).toBe('available');

    // No user IDs or private booking details leak through the API.
    for (const slot of board.slots) {
      expect(Object.keys(slot).sort()).toEqual([
        'endTime',
        'id',
        'isAvailable',
        'startTime',
        'status',
        'statusLabel',
        'timeLabel'
      ]);
    }
  });

  it('rejects invalid dates, out-of-range dates, and unknown facilities', async () => {
    insertUser();
    const facilityId = insertFacility();

    expect((await login(agent)).status).toBe(200);

    const invalidDate = await agent.get(
      `/api/slots?facilityId=${facilityId}&date=2026-02-30`
    );
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.code).toBe('INVALID_DATE');

    const badFormat = await agent.get(
      `/api/slots?facilityId=${facilityId}&date=07-11-2026`
    );
    expect(badFormat.status).toBe(400);
    expect(badFormat.body.code).toBe('VALIDATION_FAILED');

    const today = time.todayInCollege();
    const tooFar = time.addDaysToDateString(today, 8);
    const outOfRange = await agent.get(
      `/api/slots?facilityId=${facilityId}&date=${tooFar}`
    );
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.body.code).toBe('DATE_OUT_OF_RANGE');

    const lastAllowed = time.addDaysToDateString(today, 7);
    const allowed = await agent.get(
      `/api/slots?facilityId=${facilityId}&date=${lastAllowed}`
    );
    expect(allowed.status).toBe(200);

    const unknown = await agent.get(
      `/api/slots?facilityId=9999&date=${today}`
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('FACILITY_NOT_FOUND');
  });

  it('serves the slot board for a signed-in student', async () => {
    insertUser();
    const facilityId = insertFacility();
    insertSlot(facilityId, '06:00', '07:00');
    insertSlot(facilityId, '18:00', '19:00');

    expect((await login(agent)).status).toBe(200);

    const today = time.todayInCollege();
    const response = await agent.get(
      `/api/slots?facilityId=${facilityId}&date=${today}`
    );

    expect(response.status).toBe(200);
    expect(response.body.facility.name).toBe('Badminton Court 1');
    expect(response.body.date).toBe(today);
    expect(response.body.dateLabel).toMatch(/\d{2} \w{3},? \d{4}/);
    expect(response.body.slots).toHaveLength(2);
    expect(response.body.slots[0].timeLabel).toBe('06:00 – 07:00');
    expect(response.body.slots[1].statusLabel).toBeTruthy();
  });
});
