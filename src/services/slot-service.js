// Slot availability rules for Phase 2.
//
// This phase only READS availability. It does not reserve anything. The booking
// transaction and its race protections arrive in Phase 3.
//
// The server decides every status. The browser only draws what it is given.

const slotsData = require('../data/slots');
const { HttpError } = require('../utils/http-error');
const {
  nowUtcIso,
  todayInCollege,
  addDaysToDateString,
  assertDateString,
  collegeDateTimeToUtcIso,
  collegeDateParts,
  formatCollegeDate
} = require('../utils/time');

// A student may book up to 7 days ahead of today.
// So the visible range is today .. today + 7 (8 dates including today).
// Phase 3 must import this same constant when it validates new bookings.
const BOOKING_WINDOW_DAYS = 7;

const SLOT_STATUS_LABELS = {
  available: 'Available',
  booked: 'Booked',
  held: 'On hold',
  ongoing: 'In progress',
  past: 'Ended'
};

function buildDateChoices(today, lastDate) {
  const days = [];
  let current = today;

  while (current <= lastDate) {
    const parts = collegeDateParts(current);

    days.push({
      date: current,
      weekday: parts.weekday,
      dayNumber: parts.dayNumber,
      month: parts.month,
      isToday: current === today
    });

    current = addDaysToDateString(current, 1);
  }

  return days;
}

// The pickable date range, calculated from the server clock in
// Asia/Kolkata. `now` can be passed by tests; production uses the real clock.
function getBookingWindow(now = nowUtcIso()) {
  const today = todayInCollege(new Date(now));
  const lastDate = addDaysToDateString(today, BOOKING_WINDOW_DAYS);

  return {
    today,
    minDate: today,
    maxDate: lastDate,
    days: buildDateChoices(today, lastDate)
  };
}

function publicFacility(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    location: row.location
  };
}

function getFacilities(now = nowUtcIso()) {
  const facilities = slotsData.listActiveFacilities().map(publicFacility);
  const window = getBookingWindow(now);

  return {
    facilities,
    ...window
  };
}

// Decide one slot's status.
//
// Priority matters:
//   1. A slot that already ended is "past", even if it had a booking.
//   2. A slot in progress is "ongoing" and cannot be booked.
//   3. Future bookings are "booked" or "held".
//   4. Everything else is "available".
//
// ISO-8601 UTC strings with the same format can be compared as text.
function decideStatus({ startsAtUtc, endsAtUtc, booking, now }) {
  if (endsAtUtc <= now) return 'past';
  if (startsAtUtc <= now) return 'ongoing';
  if (booking && booking.status === 'confirmed') return 'booked';
  if (booking && booking.status === 'held') return 'held';
  return 'available';
}

function getSlotBoard({ facilityId, date, now = nowUtcIso(), userId = null }) {
  try {
    assertDateString(date);
  } catch {
    throw new HttpError(400, 'Choose a valid date.', 'INVALID_DATE');
  }

  const window = getBookingWindow(now);

  if (date < window.minDate || date > window.maxDate) {
    throw new HttpError(
      400,
      'You can view slots up to 7 days in advance.',
      'DATE_OUT_OF_RANGE'
    );
  }

  const facility = slotsData.findActiveFacilityById(facilityId);

  if (!facility) {
    throw new HttpError(
      404,
      'That facility is not available.',
      'FACILITY_NOT_FOUND'
    );
  }

  const slotRows = slotsData.listActiveSlotsForFacility(facilityId);

  const bookingRows = slotsData.listActiveBookingsForFacilityDate({
    facilityId,
    bookingDate: date,
    now
  });

  // slot_id -> booking row. The partial unique index guarantees at most one
  // active booking per slot and date.
  const bookingsBySlotId = new Map();
  for (const booking of bookingRows) {
    bookingsBySlotId.set(booking.slot_id, booking);
  }

  const slots = slotRows.map((slot) => {
    const startsAtUtc = collegeDateTimeToUtcIso(date, slot.start_time);
    const endsAtUtc = collegeDateTimeToUtcIso(date, slot.end_time);

    const booking = bookingsBySlotId.get(slot.id);
    const isMine = Boolean(userId && booking && booking.user_id === userId);

    const status = decideStatus({
      startsAtUtc,
      endsAtUtc,
      booking,
      now
    });

    return {
      id: slot.id,
      startTime: slot.start_time,
      endTime: slot.end_time,
      timeLabel: `${slot.start_time} – ${slot.end_time}`,
      status,
      statusLabel: SLOT_STATUS_LABELS[status],
      isAvailable: status === 'available',
      // Booking IDs are only exposed for the signed-in student's own rows.
      // Someone else's booking is just "booked" or "held".
      isMine,
      bookingId: isMine ? booking.id : null,
      holdExpiresAt:
        isMine && booking.status === 'held' ? booking.hold_expires_at : null
    };
  });

  return {
    facility: publicFacility(facility),
    date,
    dateLabel: formatCollegeDate(date),
    window,
    slots
  };
}

module.exports = {
  BOOKING_WINDOW_DAYS,
  getBookingWindow,
  getFacilities,
  getSlotBoard
};
