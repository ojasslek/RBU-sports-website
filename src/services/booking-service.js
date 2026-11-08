// Booking rules and the race-safe hold/confirm/release flow.
//
// Every write runs inside ONE BEGIN IMMEDIATE transaction. That takes SQLite's
// write lock before the "is it free?" read, so two requests cannot both see the
// same slot as available:
//
//   1. sweep expired holds
//   2. read availability / limits
//   3. insert or update
//
// The unique partial index ux_bookings_active_slot is the final guard. If it
// rejects the insert, the student sees SLOT_UNAVAILABLE instead of a 500.

const db = require('../db/connection');
const config = require('../config');
const bookingsData = require('../data/bookings');
const slotService = require('./slot-service');
const { HttpError } = require('../utils/http-error');
const {
  nowUtcIso,
  addMinutesToUtcIso,
  assertDateString,
  collegeDateTimeToUtcIso,
  formatCollegeDate
} = require('../utils/time');

const HOLD_MINUTES = config.holdMinutes;
const MAX_BOOKINGS_PER_DAY = config.maxBookingsPerDay;
const BOOKING_WINDOW_DAYS = slotService.BOOKING_WINDOW_DAYS;

function bookingView(row, now) {
  const isHeld = row.status === 'held' && Boolean(row.hold_expires_at);

  const remainingSeconds = isHeld
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(row.hold_expires_at) - Date.parse(now)) / 1000
        )
      )
    : 0;

  return {
    id: row.id,
    slotId: row.slot_id,
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    facilityLocation: row.facility_location || '',
    bookingDate: row.booking_date,
    dateLabel: formatCollegeDate(row.booking_date),
    startTime: row.start_time,
    endTime: row.end_time,
    timeLabel: `${row.start_time} – ${row.end_time}`,
    startsAtUtc: row.starts_at_utc,
    endsAtUtc: row.ends_at_utc,
    status: row.status,
    holdExpiresAt: row.hold_expires_at,
    remainingSeconds
  };
}

function assertBookableDate(date, now) {
  try {
    assertDateString(date);
  } catch {
    throw new HttpError(400, 'Choose a valid date.', 'INVALID_DATE');
  }

  const window = slotService.getBookingWindow(now);

  if (date < window.minDate || date > window.maxDate) {
    throw new HttpError(
      400,
      `You can book up to ${BOOKING_WINDOW_DAYS} days in advance.`,
      'DATE_OUT_OF_RANGE'
    );
  }
}

function assertSlotHasNotStarted(startsAtUtc, now) {
  if (startsAtUtc <= now) {
    throw new HttpError(
      409,
      'That slot has already started. Choose a later one.',
      'SLOT_STARTED'
    );
  }
}

function assertUnderDailyLimit({ userId, bookingDate, now }) {
  const total = bookingsData.countActiveBookingsForUserDate({
    userId,
    bookingDate,
    now
  });

  if (total >= MAX_BOOKINGS_PER_DAY) {
    throw new HttpError(
      409,
      `You can book at most ${MAX_BOOKINGS_PER_DAY} slots per day.`,
      'DAILY_LIMIT_REACHED'
    );
  }
}

// ---------------------------------------------------------------- hold

function createHold({ userId, slotId, date, now = nowUtcIso() }) {
  assertBookableDate(date, now);

  const run = db.transaction(() => {
    // Expired holds must be freed before the unique index is consulted.
    bookingsData.sweepExpiredHolds(now);

    const slot = bookingsData.findBookableSlot(slotId);

    if (!slot) {
      throw new HttpError(
        404,
        'That slot is not available.',
        'SLOT_NOT_FOUND'
      );
    }

    const startsAtUtc = collegeDateTimeToUtcIso(date, slot.start_time);
    const endsAtUtc = collegeDateTimeToUtcIso(date, slot.end_time);

    assertSlotHasNotStarted(startsAtUtc, now);

    // One hold at a time keeps the mobile hold bar simple and prevents a
    // student from parking several slots while deciding.
    if (bookingsData.findActiveHoldForUser({ userId, now })) {
      throw new HttpError(
        409,
        'You already have a slot on hold. Confirm it or let it go first.',
        'HOLD_ALREADY_ACTIVE'
      );
    }

    assertUnderDailyLimit({ userId, bookingDate: date, now });

    if (
      bookingsData.findActiveBookingForSlotDate({
        slotId,
        bookingDate: date,
        now
      })
    ) {
      throw new HttpError(
        409,
        'Someone just booked that slot. Choose another one.',
        'SLOT_UNAVAILABLE'
      );
    }

    const holdExpiresAt = addMinutesToUtcIso(now, HOLD_MINUTES);

    let bookingId;
    try {
      bookingId = bookingsData.insertHold({
        userId,
        slotId,
        bookingDate: date,
        startsAtUtc,
        endsAtUtc,
        holdExpiresAt
      });
    } catch (error) {
      // The partial unique index is the last line of defence. A plain SQLite
      // constraint error must become a friendly 409, never a 500.
      if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
        throw new HttpError(
          409,
          'Someone just held that slot. Choose another one.',
          'SLOT_UNAVAILABLE'
        );
      }
      throw error;
    }

    return bookingView(bookingsData.getBookingView(bookingId), now);
  });

  return run.immediate();
}

// ------------------------------------------------------------- confirm

function confirmBooking({ userId, bookingId, now = nowUtcIso() }) {
  const run = db.transaction(() => {
    bookingsData.sweepExpiredHolds(now);

    const booking = bookingsData.findBookingById(bookingId);

    // A booking that belongs to another student is reported as missing so the
    // API never confirms that it exists.
    if (!booking || booking.user_id !== userId) {
      throw new HttpError(
        404,
        'That booking was not found.',
        'BOOKING_NOT_FOUND'
      );
    }

    if (booking.status === 'confirmed') {
      return bookingView(bookingsData.getBookingView(bookingId), now);
    }

    if (
      booking.status !== 'held' ||
      !booking.hold_expires_at ||
      booking.hold_expires_at <= now
    ) {
      throw new HttpError(
        409,
        'Your hold has expired. Please choose the slot again.',
        'HOLD_EXPIRED'
      );
    }

    assertSlotHasNotStarted(booking.starts_at_utc, now);

    const confirmedToday = bookingsData.countConfirmedBookingsForUserDate({
      userId,
      bookingDate: booking.booking_date,
      excludeBookingId: booking.id
    });

    if (confirmedToday >= MAX_BOOKINGS_PER_DAY) {
      throw new HttpError(
        409,
        `You can book at most ${MAX_BOOKINGS_PER_DAY} slots per day.`,
        'DAILY_LIMIT_REACHED'
      );
    }

    const changes = bookingsData.confirmHeldBooking({ bookingId, now });

    if (changes !== 1) {
      throw new HttpError(
        409,
        'Your hold has expired. Please choose the slot again.',
        'HOLD_EXPIRED'
      );
    }

    return bookingView(bookingsData.getBookingView(bookingId), now);
  });

  return run.immediate();
}

// ------------------------------------------------------------- release

// Releasing an unconfirmed hold is not a cancellation. It simply frees a slot
// the student decided not to book. Confirmed bookings cannot be released here.
function releaseHold({ userId, bookingId, now = nowUtcIso() }) {
  const run = db.transaction(() => {
    bookingsData.sweepExpiredHolds(now);

    const booking = bookingsData.findBookingById(bookingId);

    if (!booking || booking.user_id !== userId) {
      throw new HttpError(
        404,
        'That booking was not found.',
        'BOOKING_NOT_FOUND'
      );
    }

    if (booking.status === 'confirmed') {
      throw new HttpError(
        409,
        'Confirmed bookings cannot be released. Contact the sports office.',
        'NOT_A_HOLD'
      );
    }

    if (booking.status === 'cancelled' || booking.status === 'expired') {
      return true;
    }

    if (booking.status !== 'held') {
      throw new HttpError(
        409,
        'That hold is no longer active.',
        'HOLD_EXPIRED'
      );
    }

    const changes = bookingsData.releaseHeldBooking({ bookingId, now });

    if (changes !== 1) {
      throw new HttpError(
        409,
        'That hold is no longer active.',
        'HOLD_EXPIRED'
      );
    }

    return true;
  });

  return run.immediate();
}

// --------------------------------------------------------- active hold

// Read-only: expired holds are filtered out by the query, so this never has
// to write during a page load.
function getActiveHold({ userId, now = nowUtcIso() }) {
  const row = bookingsData.findActiveHoldForUser({ userId, now });
  return row ? bookingView(row, now) : null;
}

module.exports = {
  HOLD_MINUTES,
  MAX_BOOKINGS_PER_DAY,
  BOOKING_WINDOW_DAYS,
  createHold,
  confirmBooking,
  releaseHold,
  getActiveHold
};
