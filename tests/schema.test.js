import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const schemaSql = fs.readFileSync(
  new URL('../migrations/001_initial_schema.sql', import.meta.url),
  'utf8'
);

const NOW = '2026-11-07T10:00:00.000Z';

function insertBooking(db, overrides = {}) {
  const values = {
    userId: 1,
    slotId: 1,
    bookingDate: '2026-11-08',
    startsAtUtc: '2026-11-08T12:30:00.000Z',
    endsAtUtc: '2026-11-08T13:30:00.000Z',
    status: 'held',
    holdExpiresAt: '2026-11-07T10:05:00.000Z',
    ...overrides
  };

  return db
    .prepare(
      `
      INSERT INTO bookings
        (user_id, slot_id, booking_date, starts_at_utc, ends_at_utc, status, hold_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      values.userId,
      values.slotId,
      values.bookingDate,
      values.startsAtUtc,
      values.endsAtUtc,
      values.status,
      values.holdExpiresAt
    );
}

describe('Database schema', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(schemaSql);

    db.prepare(
      `
      INSERT INTO users
        (college_id, full_name, email, password_hash, role, status, email_verified_at)
      VALUES
        ('RBU-001', 'Test Student', 'student1@example.invalid',
         '$2b$12$notarealhash', 'student', 'active', ?)
    `
    ).run(NOW);

    db.prepare(
      `
      INSERT INTO facilities (name, description, location)
      VALUES ('Badminton Court 1', 'Indoor court', 'Indoor Sports Hall')
    `
    ).run();

    db.prepare(
      `
      INSERT INTO slots (facility_id, start_time, end_time)
      VALUES (1, '18:00', '19:00')
    `
    ).run();
  });

  afterEach(() => {
    db.close();
  });

  it('allows only one active booking for the same slot and date', () => {
    insertBooking(db);

    expect(() => insertBooking(db)).toThrow(/UNIQUE constraint failed/);

    // A cancelled booking releases the slot.
    db.prepare(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = 1"
    ).run(NOW);

    expect(() => insertBooking(db)).not.toThrow();
  });

  it('treats a confirmed booking as active', () => {
    insertBooking(db, {
      status: 'confirmed',
      holdExpiresAt: null
    });

    expect(() => insertBooking(db)).toThrow(/UNIQUE constraint failed/);
  });

  it('treats an expired hold as free in read queries', () => {
    insertBooking(db, {
      holdExpiresAt: '2026-11-07T09:55:00.000Z'
    });

    // The stored row is still 'held'. This query is the pattern every read
    // endpoint must use: it only joins a hold while it is unexpired.
    const row = db
      .prepare(
        `
        SELECT
          CASE WHEN b.status IS NULL THEN 'available' ELSE b.status END AS status
        FROM slots s
        LEFT JOIN bookings b
          ON b.slot_id = s.id
         AND b.booking_date = ?
         AND (
           b.status = 'confirmed'
           OR (b.status = 'held' AND b.hold_expires_at > ?)
         )
        WHERE s.id = 1
      `
      )
      .get('2026-11-08', NOW);

    expect(row.status).toBe('available');
  });

  it('requires the expired-hold sweep before the slot can be re-held', () => {
    insertBooking(db, {
      holdExpiresAt: '2026-11-07T09:55:00.000Z'
    });

    // Even though the hold is expired, the partial unique index still sees
    // status = 'held'. That is why the booking transaction must sweep first.
    expect(() => insertBooking(db)).toThrow(/UNIQUE constraint failed/);

    db.prepare(
      `
      UPDATE bookings
         SET status = 'expired', updated_at = ?
       WHERE status = 'held' AND hold_expires_at <= ?
    `
    ).run(NOW, NOW);

    expect(() => insertBooking(db)).not.toThrow();
  });

  it('enforces foreign keys', () => {
    expect(() => insertBooking(db, { userId: 999 })).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });

  it('rejects invalid slot times and active users without verification', () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO slots (facility_id, start_time, end_time) VALUES (1, '25:00', '26:00')"
        )
        .run()
    ).toThrow(/CHECK constraint failed/);

    expect(() =>
      db
        .prepare(
          `
          INSERT INTO users
            (college_id, full_name, email, password_hash, status)
          VALUES
            ('RBU-002', 'Unverified User', 'student2@example.invalid',
             '$2b$12$notarealhash', 'active')
        `
        )
        .run()
    ).toThrow(/CHECK constraint failed/);
  });

  it('treats college IDs as case-insensitive for uniqueness', () => {
    db.prepare(
      `
      INSERT INTO valid_college_ids (college_id, email, full_name)
      VALUES ('RBU-100', 'one@example.invalid', 'One')
    `
    ).run();

    expect(() =>
      db
        .prepare(
          `
          INSERT INTO valid_college_ids (college_id, email, full_name)
          VALUES ('rbu-100', 'two@example.invalid', 'Two')
        `
        )
        .run()
    ).toThrow(/UNIQUE constraint failed/);
  });
});
