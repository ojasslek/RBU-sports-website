// All SQL for holds, confirmations and releases lives here.
// Every query uses ? placeholders, never string concatenation.
//
// This module never decides business rules (daily limit, time window, hold
// length). It only reads and writes rows. src/services/booking-service.js owns
// the rules and wraps these calls in one BEGIN IMMEDIATE transaction.

const db = require('../db/connection');

const BOOKING_VIEW_COLUMNS = `
  b.id,
  b.user_id,
  b.slot_id,
  b.booking_date,
  b.starts_at_utc,
  b.ends_at_utc,
  b.status,
  b.hold_expires_at,
  b.confirmed_at,
  s.facility_id,
  s.start_time,
  s.end_time,
  f.name AS facility_name,
  f.location AS facility_location
`;

// Critical: any expired "held" row still blocks the partial unique index until
// its status is changed. Every booking transaction starts with this sweep.
function sweepExpiredHolds(now) {
  return db
    .prepare(
      `
      UPDATE bookings
         SET status = 'expired',
             updated_at = ?
       WHERE status = 'held'
         AND hold_expires_at <= ?
    `
    )
    .run(now, now).changes;
}

// One active slot template plus its facility.
// Returns null if the slot or its facility has been deactivated.
function findBookableSlot(slotId) {
  return (
    db
      .prepare(
        `
        SELECT s.id, s.facility_id, s.start_time, s.end_time,
               f.name AS facility_name,
               f.location AS facility_location
          FROM slots s
          JOIN facilities f ON f.id = s.facility_id
         WHERE s.id = ?
           AND s.is_active = 1
           AND f.is_active = 1
      `
      )
      .get(slotId) || null
  );
}

// Active = confirmed, or held with a future expiry.
function countActiveBookingsForUserDate({ userId, bookingDate, now }) {
  return db
    .prepare(
      `
      SELECT COUNT(*) AS total
        FROM bookings
       WHERE user_id = ?
         AND booking_date = ?
         AND (
               status = 'confirmed'
               OR (status = 'held' AND hold_expires_at > ?)
             )
    `
    )
    .get(userId, bookingDate, now).total;
}

function countConfirmedBookingsForUserDate({ userId, bookingDate, excludeBookingId }) {
  return db
    .prepare(
      `
      SELECT COUNT(*) AS total
        FROM bookings
       WHERE user_id = ?
         AND booking_date = ?
         AND status = 'confirmed'
         AND id <> ?
    `
    )
    .get(userId, bookingDate, excludeBookingId).total;
}

// The student may hold only one slot at a time.
function findActiveHoldForUser({ userId, now }) {
  return (
    db
      .prepare(
        `
        SELECT ${BOOKING_VIEW_COLUMNS}
          FROM bookings b
          JOIN slots s ON s.id = b.slot_id
          JOIN facilities f ON f.id = s.facility_id
         WHERE b.user_id = ?
           AND b.status = 'held'
           AND b.hold_expires_at > ?
         ORDER BY b.hold_expires_at
         LIMIT 1
      `
      )
      .get(userId, now) || null
  );
}

// Does this slot already have an active booking on this date?
function findActiveBookingForSlotDate({ slotId, bookingDate, now }) {
  return (
    db
      .prepare(
        `
        SELECT id, user_id, status
          FROM bookings
         WHERE slot_id = ?
           AND booking_date = ?
           AND (
                 status = 'confirmed'
                 OR (status = 'held' AND hold_expires_at > ?)
               )
         LIMIT 1
      `
      )
      .get(slotId, bookingDate, now) || null
  );
}

// Raw row. Callers must compare user_id themselves and return 404 for a
// booking that belongs to someone else.
function findBookingById(bookingId) {
  return (
    db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId) || null
  );
}

function getBookingView(bookingId) {
  return (
    db
      .prepare(
        `
        SELECT ${BOOKING_VIEW_COLUMNS}
          FROM bookings b
          JOIN slots s ON s.id = b.slot_id
          JOIN facilities f ON f.id = s.facility_id
         WHERE b.id = ?
      `
      )
      .get(bookingId) || null
  );
}

function insertHold({
  userId,
  slotId,
  bookingDate,
  startsAtUtc,
  endsAtUtc,
  holdExpiresAt
}) {
  const result = db
    .prepare(
      `
      INSERT INTO bookings
        (user_id, slot_id, booking_date, starts_at_utc, ends_at_utc,
         status, hold_expires_at)
      VALUES (?, ?, ?, ?, ?, 'held', ?)
    `
    )
    .run(userId, slotId, bookingDate, startsAtUtc, endsAtUtc, holdExpiresAt);

  return Number(result.lastInsertRowid);
}

function confirmHeldBooking({ bookingId, now }) {
  return db
    .prepare(
      `
      UPDATE bookings
         SET status = 'confirmed',
             hold_expires_at = NULL,
             confirmed_at = ?,
             updated_at = ?
       WHERE id = ?
         AND status = 'held'
    `
    )
    .run(now, now, bookingId).changes;
}

function releaseHeldBooking({ bookingId, now }) {
  return db
    .prepare(
      `
      UPDATE bookings
         SET status = 'cancelled',
             cancelled_at = ?,
             updated_at = ?
       WHERE id = ?
         AND status = 'held'
    `
    )
    .run(now, now, bookingId).changes;
}

function markHoldExpired({ bookingId, now }) {
  return db
    .prepare(
      `
      UPDATE bookings
         SET status = 'expired',
             updated_at = ?
       WHERE id = ?
         AND status = 'held'
    `
    )
    .run(now, bookingId).changes;
}

module.exports = {
  sweepExpiredHolds,
  findBookableSlot,
  countActiveBookingsForUserDate,
  countConfirmedBookingsForUserDate,
  findActiveHoldForUser,
  findActiveBookingForSlotDate,
  findBookingById,
  getBookingView,
  insertHold,
  confirmHeldBooking,
  releaseHeldBooking,
  markHoldExpired
};
