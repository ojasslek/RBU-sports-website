// src/data/facilities.dal.js
// --------------------------------------------------
// Data Access Layer for Facilities and Daily Slot Grids.
//
// Rules enforced:
// 1. Expired holds (status='held' AND hold_expires_at <= nowUTC) are
//    treated as available in every query.
// 2. Public slot query NEVER reveals who booked or held the slot.
// 3. Past slots (earlier today) are flagged so they cannot be selected.
// --------------------------------------------------

const db = require('../db/connection');
const { nowUTC, todayIST, isSlotInPast } = require('../utils/time');

/**
 * Get all active sports facilities.
 */
function getAllFacilities() {
  const stmt = db.prepare(`
    SELECT id, name, description
    FROM facilities
    WHERE is_active = 1
    ORDER BY id ASC
  `);
  return stmt.all();
}

/**
 * Get single facility by ID.
 */
function getFacilityById(facilityId) {
  const stmt = db.prepare(`
    SELECT id, name, description, is_active
    FROM facilities
    WHERE id = ?
  `);
  return stmt.get(facilityId);
}

/**
 * Get the daily slot grid for a facility on a specific date (YYYY-MM-DD).
 *
 * Joins slots with bookings table to resolve live status:
 * - 'booked'    -> booking exists with status = 'confirmed'
 * - 'held'      -> booking exists with status = 'held' AND hold_expires_at > nowUTC()
 * - 'available' -> no booking, OR booking was cancelled, OR hold has expired
 * - 'past'      -> date is today and slot start_time has already passed
 *
 * @param {number} facilityId
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {number} [currentUserId] - Optional user ID to mark "your hold"
 */
function getSlotsForFacilityAndDate(facilityId, dateStr, currentUserId = null) {
  const currentUtc = nowUTC();
  const today = todayIST();
  const isToday = dateStr === today;

  // Query all active slots for the facility, LEFT JOINing active bookings for the given date.
  // We filter the join to only consider bookings that are confirmed OR currently unexpired holds.
  const stmt = db.prepare(`
    SELECT
      s.id AS slot_id,
      s.facility_id,
      s.start_time,
      s.end_time,
      b.id AS booking_id,
      b.user_id AS booked_by_user_id,
      b.status AS booking_status,
      b.hold_expires_at
    FROM slots s
    LEFT JOIN bookings b
      ON s.id = b.slot_id
      AND b.booking_date = ?
      AND (
        b.status = 'confirmed'
        OR (b.status = 'held' AND b.hold_expires_at > ?)
      )
    WHERE s.facility_id = ?
      AND s.is_active = 1
    ORDER BY s.start_time ASC
  `);

  const rows = stmt.all(dateStr, currentUtc, facilityId);

  // Map each row to clean, privacy-safe public slot status
  return rows.map((row) => {
    let status = 'available';
    let isYourHold = false;

    // Check if in the past
    if (isToday && isSlotInPast(dateStr, row.start_time)) {
      status = 'past';
    } else if (row.booking_status === 'confirmed') {
      status = 'booked';
    } else if (row.booking_status === 'held') {
      status = 'held';
      if (currentUserId && row.booked_by_user_id === currentUserId) {
        isYourHold = true;
      }
    }

    // PRIVACY REQUIREMENT:
    // Never expose booked_by_user_id to the public client!
    return {
      slot_id: row.slot_id,
      facility_id: row.facility_id,
      start_time: row.start_time,
      end_time: row.end_time,
      status,                     // 'available' | 'booked' | 'held' | 'past'
      is_your_hold: isYourHold,   // true only if the requesting student holds it
      hold_expires_at: isYourHold ? row.hold_expires_at : null,
    };
  });
}

module.exports = {
  getAllFacilities,
  getFacilityById,
  getSlotsForFacilityAndDate,
};

