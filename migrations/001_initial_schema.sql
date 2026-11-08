-- =============================================================================
-- 001_initial_schema.sql
-- Campus Sports Facility Slot Booking System
--
-- TIME RULES
--   * Exact moments are ISO-8601 UTC strings:
--       2026-11-07T12:30:00.000Z
--   * booking_date is the calendar date in Asia/Kolkata.
--   * slots.start_time / slots.end_time are daily wall-clock times in
--     Asia/Kolkata ("18:00"). The absolute start/end of each booking is stored
--     in bookings.starts_at_utc / ends_at_utc so sorting and "2 hours before"
--     checks are unambiguous.
--
-- ACTIVE BOOKING RULE
--   "held" and "confirmed" are active. "cancelled", "expired" and "no_show"
--   are inactive and do not block the slot.
--
-- EXPIRED HOLD RULE
--   A SQLite partial index cannot compare against "now". Therefore an expired
--   "held" row still blocks inserts until it is physically changed to
--   "expired". Every hold/confirm transaction MUST start with:
--
--     UPDATE bookings
--        SET status = 'expired', updated_at = :now
--      WHERE status = 'held' AND hold_expires_at <= :now;
--
--   Read queries must also treat an expired hold as free. Use this join
--   condition when joining bookings to slots:
--
--     b.status = 'confirmed'
--     OR (b.status = 'held' AND b.hold_expires_at > :now)
--
--   This makes expired holds appear free immediately, even before the cron
--   cleanup job runs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users
-- A row is created with status = 'pending' during registration. It becomes
-- 'active' only after the emailed OTP is verified. This is why a pending user
-- has no email_verified_at.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,

  college_id               TEXT NOT NULL UNIQUE COLLATE NOCASE
                           CHECK (length(college_id) BETWEEN 3 AND 40),

  full_name                TEXT NOT NULL
                           CHECK (length(full_name) BETWEEN 1 AND 120),

  email                    TEXT NOT NULL UNIQUE COLLATE NOCASE
                           CHECK (length(email) BETWEEN 5 AND 254),

  -- bcrypt hash, never the password itself. Never returned by any API.
  password_hash            TEXT NOT NULL,

  role                     TEXT NOT NULL DEFAULT 'student'
                           CHECK (role IN ('student', 'admin')),

  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'active', 'suspended')),

  failed_login_attempts    INTEGER NOT NULL DEFAULT 0
                           CHECK (failed_login_attempts >= 0),

  -- UTC ISO timestamp. Login is blocked while this is in the future.
  locked_until             TEXT,

  email_verified_at        TEXT,

  -- Registration OTP. Only a hash of the OTP is stored.
  otp_hash                 TEXT,
  otp_expires_at           TEXT,
  otp_attempts             INTEGER NOT NULL DEFAULT 0
                           CHECK (otp_attempts >= 0),

  last_login_at            TEXT,

  created_at               TEXT NOT NULL
                           DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT NOT NULL
                           DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- An account cannot be active/suspended without a verified email.
  CHECK (
    (status = 'pending' AND email_verified_at IS NULL)
    OR (status IN ('active', 'suspended') AND email_verified_at IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- valid_college_ids
-- Uploaded by the college. An email can have only one account. The email here
-- is the authoritative address used to send the ownership OTP.
-- ---------------------------------------------------------------------------
CREATE TABLE valid_college_ids (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,

  college_id            TEXT NOT NULL UNIQUE COLLATE NOCASE
                        CHECK (length(college_id) BETWEEN 3 AND 40),

  email                 TEXT NOT NULL UNIQUE COLLATE NOCASE
                        CHECK (length(email) BETWEEN 5 AND 254),

  full_name             TEXT NOT NULL DEFAULT ''
                        CHECK (length(full_name) <= 120),

  is_claimed            INTEGER NOT NULL DEFAULT 0
                        CHECK (is_claimed IN (0, 1)),

  claimed_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_at            TEXT,

  created_at            TEXT NOT NULL
                        DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CHECK (is_claimed = 0 OR claimed_at IS NOT NULL)
);

CREATE INDEX ix_valid_ids_unclaimed
  ON valid_college_ids (is_claimed, college_id);

-- ---------------------------------------------------------------------------
-- facilities
-- ---------------------------------------------------------------------------
CREATE TABLE facilities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  name          TEXT NOT NULL UNIQUE COLLATE NOCASE
                CHECK (length(name) BETWEEN 1 AND 80),

  description   TEXT NOT NULL DEFAULT ''
                CHECK (length(description) <= 500),

  location      TEXT NOT NULL DEFAULT ''
                CHECK (length(location) <= 120),

  is_active     INTEGER NOT NULL DEFAULT 1
                CHECK (is_active IN (0, 1)),

  created_at    TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- slots
-- A reusable daily template, e.g. Badminton Court 1, 18:00-19:00.
-- Overlapping slot times are prevented by application checks in the admin
-- panel, not by this table, because SQLite cannot easily enforce that across
-- rows with a simple constraint.
-- ---------------------------------------------------------------------------
CREATE TABLE slots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  facility_id   INTEGER NOT NULL
                REFERENCES facilities(id) ON DELETE CASCADE,

  start_time    TEXT NOT NULL
                CHECK (
                  start_time GLOB '[01][0-9]:[0-5][0-9]'
                  OR start_time GLOB '2[0-3]:[0-5][0-9]'
                ),

  end_time      TEXT NOT NULL
                CHECK (
                  end_time GLOB '[01][0-9]:[0-5][0-9]'
                  OR end_time GLOB '2[0-3]:[0-5][0-9]'
                ),

  is_active     INTEGER NOT NULL DEFAULT 1
                CHECK (is_active IN (0, 1)),

  created_at    TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (facility_id, start_time, end_time),

  -- Times are zero-padded 24-hour strings, so text comparison is safe.
  CHECK (start_time < end_time)
);

CREATE INDEX ix_slots_facility
  ON slots (facility_id, is_active, start_time);

-- ---------------------------------------------------------------------------
-- bookings
--
-- status:
--   held       -> temporary 5-minute lock; counts as active
--   confirmed  -> final booking; counts as active
--   cancelled  -> released by the student (or admin later)
--   expired    -> hold ran out without confirmation
--   no_show    -> confirmed booking not used (advanced feature later)
--
-- booking_date is the local college date. starts_at_utc and ends_at_utc are
-- the exact UTC instants and are used for past checks and cancellation rules.
-- ---------------------------------------------------------------------------
CREATE TABLE bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id          INTEGER NOT NULL
                   REFERENCES users(id) ON DELETE RESTRICT,

  slot_id          INTEGER NOT NULL
                   REFERENCES slots(id) ON DELETE RESTRICT,

  booking_date     TEXT NOT NULL
                   CHECK (
                     booking_date GLOB
                     '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                   ),

  starts_at_utc    TEXT NOT NULL
                   CHECK (
                     starts_at_utc GLOB
                     '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                   ),

  ends_at_utc      TEXT NOT NULL
                   CHECK (
                     ends_at_utc GLOB
                     '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                   ),

  status           TEXT NOT NULL
                   CHECK (
                     status IN ('held', 'confirmed', 'cancelled', 'expired', 'no_show')
                   ),

  -- Required while status = 'held'; set to NULL on confirmation.
  hold_expires_at  TEXT,

  confirmed_at     TEXT,
  cancelled_at     TEXT,

  created_at       TEXT NOT NULL
                   DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL
                   DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CHECK (starts_at_utc < ends_at_utc),
  CHECK (status <> 'held' OR hold_expires_at IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- The double-booking guard.
--
-- This UNIQUE partial index allows only ONE active ('held' or 'confirmed')
-- booking for the same slot and local date. Cancelled/expired rows do not
-- participate, so the slot can be booked again.
--
-- The five-minute sweep in the file header is what lets a new user take over
-- a hold that has expired but is still stored as status = 'held'.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX ux_bookings_active_slot
  ON bookings (slot_id, booking_date)
  WHERE status = 'held' OR status = 'confirmed';

-- Fast lookup for "My Bookings" and the two-per-day rule.
CREATE INDEX ix_bookings_user_date
  ON bookings (user_id, booking_date, status);

-- Fast lookup for expired-hold cleanup.
CREATE INDEX ix_bookings_hold_sweep
  ON bookings (status, hold_expires_at);

-- Fast lookup for admin/staff views and reminders.
CREATE INDEX ix_bookings_slot_date
  ON bookings (slot_id, booking_date, status);

CREATE INDEX ix_bookings_starts_at
  ON bookings (starts_at_utc);
