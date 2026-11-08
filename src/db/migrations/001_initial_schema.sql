-- ============================================================
-- Migration 001: Initial Schema
-- Campus Sports Facility Slot Booking System (RBU)
--
-- TIME CONVENTION:
--   - All datetime columns (created_at, hold_expires_at, locked_until) are UTC.
--   - Slot template times (start_time, end_time) are in IST (Asia/Kolkata) "HH:MM"
--   - booking_date is a local date string "YYYY-MM-DD" in IST.
-- ============================================================

PRAGMA foreign_keys = ON;

-- 1. Table: valid_college_ids
-- Pre-uploaded master list of students eligible to register.
-- Admin uploads via CSV. Stops non-students from registering.
CREATE TABLE IF NOT EXISTS valid_college_ids (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    college_id  TEXT    NOT NULL UNIQUE,          -- e.g. "RBU2024001"
    email       TEXT    NOT NULL,                 -- student's official email for OTP
    name        TEXT    NOT NULL,                 -- student's full name
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 2. Table: users
-- Registered accounts.
-- An account starts as is_verified = 0.
-- When the user enters the OTP sent to their official email, is_verified = 1.
CREATE TABLE IF NOT EXISTS users (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    college_id            TEXT    NOT NULL UNIQUE,
    email                 TEXT    NOT NULL,
    name                  TEXT    NOT NULL,
    password_hash         TEXT    NOT NULL,        -- bcrypt hash (cost 12), NEVER plaintext
    role                  TEXT    NOT NULL DEFAULT 'student'
                                  CHECK(role IN ('student', 'admin')),
    is_verified           INTEGER NOT NULL DEFAULT 0
                                  CHECK(is_verified IN (0, 1)),
    otp_hash              TEXT,                    -- bcrypt hash of the active 6-digit OTP
    otp_expires_at        TEXT,                    -- UTC ISO datetime string
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until          TEXT,                    -- UTC ISO datetime string (temporary ban)
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (college_id) REFERENCES valid_college_ids(college_id)
);

-- 3. Table: facilities
-- Sports facilities available for booking.
CREATE TABLE IF NOT EXISTS facilities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,                  -- e.g. "Badminton Court 1"
    description TEXT,                              -- brief description / location
    is_active   INTEGER NOT NULL DEFAULT 1
                        CHECK(is_active IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 4. Table: slots
-- Daily recurring schedule templates for each facility.
-- Times are "HH:MM" in local IST.
CREATE TABLE IF NOT EXISTS slots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_id  INTEGER NOT NULL,
    start_time   TEXT    NOT NULL,                 -- e.g. "06:00"
    end_time     TEXT    NOT NULL,                 -- e.g. "07:00"
    is_active    INTEGER NOT NULL DEFAULT 1
                         CHECK(is_active IN (0, 1)),
    FOREIGN KEY (facility_id) REFERENCES facilities(id),
    UNIQUE(facility_id, start_time, end_time)
);

-- 5. Table: bookings
-- Holds and confirmed reservations.
-- Status flow:
--   held -> confirmed (user confirms within 5 min)
--   held -> expired (5 minutes lapse without confirmation)
--   confirmed -> cancelled (user cancels >= 2 hours prior)
CREATE TABLE IF NOT EXISTS bookings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id         INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    booking_date    TEXT    NOT NULL,              -- "YYYY-MM-DD" local IST date
    status          TEXT    NOT NULL DEFAULT 'held'
                            CHECK(status IN ('held', 'confirmed', 'cancelled', 'expired')),
    hold_expires_at TEXT,                          -- UTC ISO string (only set for 'held')
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (slot_id) REFERENCES slots(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================
-- INDEXES & INTEGRITY
-- ============================================================

-- Critical partial unique index:
-- Guarantees that no slot on the same date can have two active bookings.
-- Only applies to 'held' and 'confirmed' bookings.
-- When a booking is 'cancelled' or 'expired', it is excluded,
-- allowing the slot to be held/booked again immediately!
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_active
ON bookings(slot_id, booking_date)
WHERE status IN ('held', 'confirmed');

-- Fast index for "My Bookings" page (user's upcoming/past bookings)
CREATE INDEX IF NOT EXISTS idx_booking_user
ON bookings(user_id, status);

-- Fast index for date queries (fetching slots for a specific day)
CREATE INDEX IF NOT EXISTS idx_booking_date
ON bookings(booking_date, status);

-- Fast index for hold-expiry cleanup
CREATE INDEX IF NOT EXISTS idx_booking_hold_expiry
ON bookings(status, hold_expires_at)
WHERE status = 'held';

-- ============================================================
-- SEED DATA (Default Facilities, Slots, & Valid College IDs)
-- ============================================================

-- Facilities
INSERT OR IGNORE INTO facilities (id, name, description) VALUES
    (1, 'Badminton Court 1', 'Indoor sports hall, wooden floor'),
    (2, 'Badminton Court 2', 'Indoor sports hall, synthetic floor'),
    (3, 'Football Turf',     'Main campus 7-a-side floodlit artificial turf'),
    (4, 'Gymnasium',         'Fitness center with cardio & weight training'),
    (5, 'Table Tennis Room', 'Indoor recreation room with two ITTF tables');

-- Badminton Court 1 & 2 (1-hour slots from 06:00 to 21:00)
INSERT OR IGNORE INTO slots (facility_id, start_time, end_time) VALUES
    (1, '06:00', '07:00'), (1, '07:00', '08:00'), (1, '08:00', '09:00'),
    (1, '09:00', '10:00'), (1, '10:00', '11:00'), (1, '11:00', '12:00'),
    (1, '12:00', '13:00'), (1, '13:00', '14:00'), (1, '14:00', '15:00'),
    (1, '15:00', '16:00'), (1, '16:00', '17:00'), (1, '17:00', '18:00'),
    (1, '18:00', '19:00'), (1, '19:00', '20:00'), (1, '20:00', '21:00'),
    (2, '06:00', '07:00'), (2, '07:00', '08:00'), (2, '08:00', '09:00'),
    (2, '09:00', '10:00'), (2, '10:00', '11:00'), (2, '11:00', '12:00'),
    (2, '12:00', '13:00'), (2, '13:00', '14:00'), (2, '14:00', '15:00'),
    (2, '15:00', '16:00'), (2, '16:00', '17:00'), (2, '17:00', '18:00'),
    (2, '18:00', '19:00'), (2, '19:00', '20:00'), (2, '20:00', '21:00');

-- Football Turf (90-minute slots)
INSERT OR IGNORE INTO slots (facility_id, start_time, end_time) VALUES
    (3, '06:00', '07:30'), (3, '07:30', '09:00'), (3, '09:00', '10:30'),
    (3, '16:00', '17:30'), (3, '17:30', '19:00'), (3, '19:00', '20:30');

-- Gymnasium (1-hour sessions)
INSERT OR IGNORE INTO slots (facility_id, start_time, end_time) VALUES
    (4, '06:00', '07:00'), (4, '07:00', '08:00'), (4, '08:00', '09:00'),
    (4, '16:00', '17:00'), (4, '17:00', '18:00'), (4, '18:00', '19:00'),
    (4, '19:00', '20:00'), (4, '20:00', '21:00');

-- Table Tennis (45-minute slots)
INSERT OR IGNORE INTO slots (facility_id, start_time, end_time) VALUES
    (5, '06:00', '06:45'), (5, '06:45', '07:30'), (5, '07:30', '08:15'),
    (5, '16:00', '16:45'), (5, '16:45', '17:30'), (5, '17:30', '18:15'),
    (5, '18:15', '19:00'), (5, '19:00', '19:45'), (5, '19:45', '20:30');

-- Sample valid college IDs for testing registration & OTP
INSERT OR IGNORE INTO valid_college_ids (college_id, email, name) VALUES
    ('RBU2024001', 'student1@rbu.ac.in', 'Aarav Sharma'),
    ('RBU2024002', 'student2@rbu.ac.in', 'Priya Patel'),
    ('RBU2024003', 'student3@rbu.ac.in', 'Rohan Gupta'),
    ('RBU2024004', 'student4@rbu.ac.in', 'Sneha Reddy'),
    ('RBU2024005', 'student5@rbu.ac.in', 'Arjun Nair'),
    ('RBUADMIN01',  'sports.admin@rbu.ac.in', 'Sports Secretary');

