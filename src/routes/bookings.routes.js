// src/routes/bookings.routes.js
// --------------------------------------------------
// Slot Reservation, Hold & Cancellation Endpoints.
//
// Features:
// - Atomic 5-minute hold acquisition
// - 2 bookings per day limit enforcement
// - 7-day advance booking enforcement
// - "My Bookings" retrieval (Upcoming vs Past)
// - Direct reservation cancellation (no 2-hour restriction)
// - Real-time slot state broadcasting
// --------------------------------------------------

const express = require('express');
const { z } = require('zod');

const config = require('../config');
const bookingsDal = require('../data/bookings.dal');
const { requireAuth } = require('../middleware/auth.middleware');
const { todayIST, daysFromTodayIST } = require('../utils/time');
const { validateBody } = require('../middleware/validate');
const { broadcastSlotUpdate } = require('../realtime/socket');

const router = express.Router();

// Validation Schemas
const holdSchema = z.object({
  slot_id: z.number({ required_error: 'Slot ID is required' }).int().positive(),
  booking_date: z
    .string({ required_error: 'Booking date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD'),
});

const bookingIdSchema = z.object({
  booking_id: z.number({ required_error: 'Booking ID is required' }).int().positive(),
});

// ==================================================
// POST /api/bookings/hold
// Acquires a 5-minute hold on a slot
// ==================================================
router.post('/hold', requireAuth, validateBody(holdSchema), (req, res, next) => {
  try {
    const { slot_id, booking_date } = req.body;

    const minDate = todayIST();
    const maxDate = daysFromTodayIST(config.maxAdvanceBookingDays);

    if (booking_date < minDate) {
      return res.status(400).json({ error: 'Cannot book slots in the past.' });
    }

    if (booking_date > maxDate) {
      return res.status(400).json({
        error: `Bookings are allowed only up to ${config.maxAdvanceBookingDays} days in advance.`,
      });
    }

    const booking = bookingsDal.holdSlotTransaction({
      slotId: slot_id,
      userId: req.user.id,
      bookingDate: booking_date,
    });

    // Real-time broadcast: inform all students that this slot is held
    broadcastSlotUpdate({
      slot_id: booking.slot_id,
      booking_date: booking.booking_date,
      status: 'held',
    });

    res.status(201).json({
      message: 'Slot held for 5 minutes. Please confirm before the timer expires.',
      booking: {
        id: booking.id,
        slot_id: booking.slot_id,
        booking_date: booking.booking_date,
        hold_expires_at: booking.hold_expires_at,
        status: booking.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// POST /api/bookings/confirm
// Confirms an active 5-minute hold
// ==================================================
router.post('/confirm', requireAuth, validateBody(bookingIdSchema), (req, res, next) => {
  try {
    const { booking_id } = req.body;

    const confirmed = bookingsDal.confirmBookingTransaction({
      bookingId: booking_id,
      userId: req.user.id,
    });

    // Real-time broadcast: inform all students that this slot is confirmed/booked
    broadcastSlotUpdate({
      slot_id: confirmed.slot_id,
      booking_date: confirmed.booking_date,
      status: 'booked',
    });

    res.status(200).json({
      message: 'Booking confirmed successfully!',
      booking: {
        id: confirmed.id,
        slot_id: confirmed.slot_id,
        booking_date: confirmed.booking_date,
        facility_name: confirmed.facility_name,
        start_time: confirmed.start_time,
        status: confirmed.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// POST /api/bookings/cancel
// Cancels a confirmed booking directly
// ==================================================
router.post('/cancel', requireAuth, validateBody(bookingIdSchema), (req, res, next) => {
  try {
    const { booking_id } = req.body;

    const cancelled = bookingsDal.cancelBookingTransaction({
      bookingId: booking_id,
      userId: req.user.id,
    });

    // Real-time broadcast: inform all students that this slot is available again
    broadcastSlotUpdate({
      slot_id: cancelled.slot_id,
      booking_date: cancelled.booking_date,
      status: 'available',
    });

    res.status(200).json({
      message: 'Booking cancelled successfully. The slot is now available for other students.',
      booking: {
        id: cancelled.id,
        slot_id: cancelled.slot_id,
        booking_date: cancelled.booking_date,
        status: 'cancelled',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// POST /api/bookings/release
// Releases a hold voluntarily before 5 minutes expire
// ==================================================
router.post('/release', requireAuth, validateBody(bookingIdSchema), (req, res, next) => {
  try {
    const { booking_id } = req.body;

    const bookingBefore = bookingsDal.findBookingById(booking_id);

    const result = bookingsDal.releaseHoldTransaction({
      bookingId: booking_id,
      userId: req.user.id,
    });

    if (result.released && bookingBefore) {
      broadcastSlotUpdate({
        slot_id: bookingBefore.slot_id,
        booking_date: bookingBefore.booking_date,
        status: 'available',
      });
    }

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// ==================================================
// GET /api/bookings/my
// Returns current student's Upcoming and Past bookings
// ==================================================
router.get('/my', requireAuth, (req, res, next) => {
  try {
    const { upcoming, past } = bookingsDal.getUserBookings(req.user.id);
    res.json({ upcoming, past });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// GET /api/bookings/active-hold
// Returns current student's active hold (if any)
// ==================================================
router.get('/active-hold', requireAuth, (req, res, next) => {
  try {
    const hold = bookingsDal.findActiveHoldForUser(req.user.id);
    res.json({ hold: hold || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
