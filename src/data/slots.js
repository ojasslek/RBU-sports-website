// All SQL for facilities, slots, and slot availability lives here.
// Every query uses ? placeholders, never string concatenation.

const db = require('../db/connection');

function listActiveFacilities() {
  return db
    .prepare(
      `
      SELECT id, name, description, location
        FROM facilities
       WHERE is_active = 1
       ORDER BY name COLLATE NOCASE
    `
    )
    .all();
}

function findActiveFacilityById(facilityId) {
  return (
    db
      .prepare(
        `
        SELECT id, name, description, location
          FROM facilities
         WHERE id = ? AND is_active = 1
      `
      )
      .get(facilityId) || null
  );
}

function listActiveSlotsForFacility(facilityId) {
  return db
    .prepare(
      `
      SELECT id, facility_id, start_time, end_time
        FROM slots
       WHERE facility_id = ? AND is_active = 1
       ORDER BY start_time
    `
    )
    .all(facilityId);
}

// Returns only bookings that currently block a slot.
//
// An expired hold is treated as free even if its stored status is still
// 'held'. The Phase 3 booking transaction will also sweep expired rows before
// inserting, but every read query must filter them out on its own.
function listActiveBookingsForFacilityDate({
  facilityId,
  bookingDate,
  now
}) {
  return db
    .prepare(
      `
      SELECT b.id, b.user_id, b.slot_id, b.status, b.hold_expires_at
        FROM bookings b
        JOIN slots s ON s.id = b.slot_id
       WHERE s.facility_id = ?
         AND b.booking_date = ?
         AND (
               b.status = 'confirmed'
               OR (b.status = 'held' AND b.hold_expires_at > ?)
             )
    `
    )
    .all(facilityId, bookingDate, now);
}

module.exports = {
  listActiveFacilities,
  findActiveFacilityById,
  listActiveSlotsForFacility,
  listActiveBookingsForFacilityDate
};
