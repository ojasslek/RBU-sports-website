// src/data/bookings.dal.js
// --------------------------------------------------
// Data Access Layer for Slot Holds & Bookings.
//
// CONCURRENCY & INTEGRITY:
// - All state-changing operations run inside atomic BEGIN IMMEDIATE transactions.
// - Enforces no double bookings via the partial unique index:
//   idx_booking_active ON bookings(slot_id, booking_date) WHERE status IN ('held', 'confirmed')
// - Enforces max 2 confirmed bookings per day per student.
// - Direct cancellation on active reservations (no 2-hour cutoff restriction).
// --------------------------------------------------

const db = require('../db/connection');
const { nowUTC, todayIST, nowTimeIST, minutesFromNowUTC, isExpired, isSlotInPast } = require('../utils/time');
const config = require('../config');

/**
 * Count active (confirmed) bookings for a student on a specific date.
 */
function countConfirmedBookingsOnDate(userId, dateStr) {
  const stmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM bookings
    WHERE user_id = ?
      AND booking_date = ?
      AND status = 'confirmed'
  `);
  return stmt.get(userId, dateStr).count;
}

/**
 * Find booking by primary key ID.
 */
function findBookingById(bookingId) {
  const stmt = db.prepare(`
    SELECT b.id, b.slot_id, b.user_id, b.booking_date, b.status,
           b.hold_expires_at, b.created_at, b.updated_at,
           s.facility_id, s.start_time, s.end_time,
           f.name AS facility_name
    FROM bookings b
    JOIN slots s ON b.slot_id = s.id
    JOIN facilities f ON s.facility_id = f.id
    WHERE b.id = ?
  `);
  return stmt.get(bookingId);
}

/**
 * Find user's currently active hold (if any).
 */
function findActiveHoldForUser(userId) {
  const currentUtc = nowUTC();
  const stmt = db.prepare(`
    SELECT b.id, b.slot_id, b.booking_date, b.hold_expires_at
    FROM bookings b
    WHERE b.user_id = ?
      AND b.status = 'held'
      AND b.hold_expires_at > ?
    ORDER BY b.id DESC
    LIMIT 1
  `);
  return stmt.get(userId, currentUtc);
}

/**
 * Get all bookings for a user, categorized into Upcoming and Past.
 */
function getUserBookings(userId) {
  const today = todayIST();
  const currentTime = nowTimeIST();

  const stmt = db.prepare(`
    SELECT
      b.id, b.slot_id, b.booking_date, b.status, b.created_at,
      s.start_time, s.end_time,
      f.name AS facility_name, f.description AS facility_desc
    FROM bookings b
    JOIN slots s ON b.slot_id = s.id
    JOIN facilities f ON s.facility_id = f.id
    WHERE b.user_id = ?
      AND b.status IN ('confirmed', 'cancelled')
    ORDER BY b.booking_date DESC, s.start_time DESC
  `);

  const allBookings = stmt.all(userId);

  const upcoming = [];
  const past = [];

  for (const b of allBookings) {
    const isPastDate = b.booking_date < today;
    const isTodayPastTime = b.booking_date === today && b.start_time <= currentTime;

    if (isPastDate || isTodayPastTime || b.status === 'cancelled') {
      past.push(b);
    } else {
      upcoming.push(b);
    }
  }

  // Sort upcoming chronologically (earliest first)
  upcoming.sort((a, b) => {
    if (a.booking_date !== b.booking_date) {
      return a.booking_date.localeCompare(b.booking_date);
    }
    return a.start_time.localeCompare(b.start_time);
  });

  return { upcoming, past };
}

/**
 * Hold a slot for 5 minutes.
 * Uses BEGIN IMMEDIATE transaction to prevent race conditions.
 */
function holdSlotTransaction({ slotId, userId, bookingDate }) {
  const holdTx = db.transaction(() => {
    const currentUtc = nowUTC();

    const slot = db.prepare(`
      SELECT s.id, s.facility_id, s.start_time, s.end_time, s.is_active,
             f.is_active AS facility_active
      FROM slots s
      JOIN facilities f ON s.facility_id = f.id
      WHERE s.id = ?
    `).get(slotId);

    if (!slot || !slot.is_active || !slot.facility_active) {
      const err = new Error('Slot or facility is not active.');
      err.statusCode = 404;
      throw err;
    }

    if (isSlotInPast(bookingDate, slot.start_time)) {
      const err = new Error('Cannot book a time slot that has already passed.');
      err.statusCode = 400;
      throw err;
    }

    const activeConfirmedCount = countConfirmedBookingsOnDate(userId, bookingDate);
    if (activeConfirmedCount >= config.maxBookingsPerDay) {
      const err = new Error(`Daily limit reached: You can book a maximum of ${config.maxBookingsPerDay} slots per day.`);
      err.statusCode = 400;
      throw err;
    }

    // Release any previous unconfirmed hold by this user
    db.prepare(`
      UPDATE bookings
      SET status = 'expired', updated_at = ?
      WHERE user_id = ? AND status = 'held'
    `).run(currentUtc, userId);

    const existing = db.prepare(`
      SELECT id, user_id, status, hold_expires_at
      FROM bookings
      WHERE slot_id = ? AND booking_date = ? AND status IN ('held', 'confirmed')
      LIMIT 1
    `).get(slotId, bookingDate);

    if (existing) {
      if (existing.status === 'confirmed') {
        const err = new Error('This slot has already been booked by another student.');
        err.statusCode = 409;
        throw err;
      }

      if (existing.status === 'held') {
        if (existing.hold_expires_at > currentUtc) {
          const err = new Error('This slot is temporarily held by another student. Please try again in 5 minutes.');
          err.statusCode = 409;
          throw err;
        }

        db.prepare(`
          UPDATE bookings
          SET status = 'expired', updated_at = ?
          WHERE id = ?
        `).run(currentUtc, existing.id);
      }
    }

    const holdExpiresAt = minutesFromNowUTC(config.holdMinutes);

    db.prepare(`
      INSERT INTO bookings (
        slot_id, user_id, booking_date, status, hold_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'held', ?, ?, ?)
    `).run(
      slotId,
      userId,
      bookingDate,
      holdExpiresAt,
      currentUtc,
      currentUtc
    );

    const newBooking = db.prepare(`
      SELECT id, slot_id, user_id, booking_date, status, hold_expires_at
      FROM bookings
      WHERE slot_id = ? AND booking_date = ? AND status = 'held'
      ORDER BY id DESC LIMIT 1
    `).get(slotId, bookingDate);

    return newBooking;
  });

  return holdTx();
}

/**
 * Confirm a held slot.
 */
function confirmBookingTransaction({ bookingId, userId }) {
  const confirmTx = db.transaction(() => {
    const currentUtc = nowUTC();

    const booking = db.prepare(`
      SELECT b.id, b.slot_id, b.user_id, b.booking_date, b.status, b.hold_expires_at,
             s.start_time, f.name AS facility_name
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN facilities f ON s.facility_id = f.id
      WHERE b.id = ?
    `).get(bookingId);

    if (!booking) {
      const err = new Error('Booking not found.');
      err.statusCode = 404;
      throw err;
    }

    if (booking.user_id !== userId) {
      const err = new Error('Unauthorized: You do not own this hold.');
      err.statusCode = 403;
      throw err;
    }

    if (booking.status === 'confirmed') {
      return booking;
    }

    if (booking.status !== 'held') {
      const err = new Error(`Cannot confirm booking with status '${booking.status}'.`);
      err.statusCode = 400;
      throw err;
    }

    if (!booking.hold_expires_at || isExpired(booking.hold_expires_at)) {
      db.prepare(`
        UPDATE bookings
        SET status = 'expired', updated_at = ?
        WHERE id = ?
      `).run(currentUtc, booking.id);

      const err = new Error('Your 5-minute hold has expired. Please select the slot again.');
      err.statusCode = 400;
      throw err;
    }

    const confirmedCount = countConfirmedBookingsOnDate(userId, booking.booking_date);
    if (confirmedCount >= config.maxBookingsPerDay) {
      const err = new Error(`Daily limit reached: Maximum ${config.maxBookingsPerDay} bookings per day.`);
      err.statusCode = 400;
      throw err;
    }

    db.prepare(`
      UPDATE bookings
      SET status = 'confirmed', hold_expires_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(currentUtc, booking.id);

    return {
      ...booking,
      status: 'confirmed',
      hold_expires_at: null,
      updated_at: currentUtc,
    };
  });

  return confirmTx();
}

/**
 * Cancel a confirmed booking directly (no 2-hour restriction).
 * Uses BEGIN IMMEDIATE transaction.
 */
function cancelBookingTransaction({ bookingId, userId }) {
  const cancelTx = db.transaction(() => {
    const currentUtc = nowUTC();

    const booking = db.prepare(`
      SELECT b.id, b.slot_id, b.user_id, b.booking_date, b.status,
             s.start_time, f.name AS facility_name
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN facilities f ON s.facility_id = f.id
      WHERE b.id = ?
    `).get(bookingId);

    if (!booking) {
      const err = new Error('Booking not found.');
      err.statusCode = 404;
      throw err;
    }

    // IDOR Protection: Student can only cancel their OWN booking
    if (booking.user_id !== userId) {
      const err = new Error('Unauthorized: You cannot cancel another student’s booking.');
      err.statusCode = 403;
      throw err;
    }

    if (booking.status === 'cancelled') {
      const err = new Error('This booking has already been cancelled.');
      err.statusCode = 400;
      throw err;
    }

    if (booking.status !== 'confirmed') {
      const err = new Error(`Cannot cancel a booking with status '${booking.status}'.`);
      err.statusCode = 400;
      throw err;
    }

    // Direct cancellation executed
    db.prepare(`
      UPDATE bookings
      SET status = 'cancelled', updated_at = ?
      WHERE id = ?
    `).run(currentUtc, booking.id);

    return {
      ...booking,
      status: 'cancelled',
      updated_at: currentUtc,
    };
  });

  return cancelTx();
}

/**
 * Release an active hold voluntarily.
 */
function releaseHoldTransaction({ bookingId, userId }) {
  const releaseTx = db.transaction(() => {
    const currentUtc = nowUTC();

    const booking = db.prepare(`
      SELECT id, user_id, status FROM bookings WHERE id = ?
    `).get(bookingId);

    if (!booking) {
      return { released: false, message: 'Booking not found.' };
    }

    if (booking.user_id !== userId) {
      const err = new Error('Unauthorized: Cannot release another user’s hold.');
      err.statusCode = 403;
      throw err;
    }

    if (booking.status === 'held') {
      db.prepare(`
        UPDATE bookings
        SET status = 'expired', updated_at = ?
        WHERE id = ?
      `).run(currentUtc, booking.id);
      return { released: true, message: 'Hold released.' };
    }

    return { released: false, message: 'Booking is not held.' };
  });

  return releaseTx();
}

/**
 * Cleanup expired holds (called by the background cron job).
 */
function cleanupExpiredHolds() {
  const currentUtc = nowUTC();
  const stmt = db.prepare(`
    UPDATE bookings
    SET status = 'expired', updated_at = ?
    WHERE status = 'held' AND hold_expires_at <= ?
  `);
  const result = stmt.run(currentUtc, currentUtc);
  return result.changes;
}

module.exports = {
  countConfirmedBookingsOnDate,
  findBookingById,
  findActiveHoldForUser,
  getUserBookings,
  holdSlotTransaction,
  confirmBookingTransaction,
  cancelBookingTransaction,
  releaseHoldTransaction,
  cleanupExpiredHolds,
};
