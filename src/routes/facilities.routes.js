// src/routes/facilities.routes.js
// --------------------------------------------------
// Facility & Slot Grid API Routes.
//
// Rules enforced:
// - Date must be between Today and Today + 7 days
// - Invalid or past dates are rejected with 400
// - Privacy: other students' IDs are never returned
// --------------------------------------------------

const express = require('express');
const { z } = require('zod');

const config = require('../config');
const facilitiesDal = require('../data/facilities.dal');
const { requireAuth } = require('../middleware/auth.middleware');
const { todayIST, daysFromTodayIST } = require('../utils/time');

const router = express.Router();

// Schema for date query parameter
const dateQuerySchema = z.object({
  date: z
    .string({ message: 'Date query parameter is required (YYYY-MM-DD)' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

// ==================================================
// GET /api/facilities
// Returns list of all active sports facilities
// ==================================================
router.get('/', requireAuth, (_req, res, next) => {
  try {
    const facilities = facilitiesDal.getAllFacilities();
    res.json({ facilities });
  } catch (err) {
    next(err);
  }
});

// ==================================================
// GET /api/facilities/:id/slots?date=YYYY-MM-DD
// Returns slots for a facility on the requested date
// ==================================================
router.get('/:id/slots', requireAuth, (req, res, next) => {
  try {
    const facilityId = parseInt(req.params.id, 10);
    if (isNaN(facilityId) || facilityId <= 0) {
      return res.status(400).json({ error: 'Invalid facility ID.' });
    }

    // 1. Verify facility exists
    const facility = facilitiesDal.getFacilityById(facilityId);
    if (!facility || !facility.is_active) {
      return res.status(404).json({ error: 'Facility not found or currently unavailable.' });
    }

    // 2. Validate date parameter format
    const queryResult = dateQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      const issues = queryResult.error?.issues || queryResult.error?.errors || [];
      const msg = issues[0]?.message || 'Invalid date parameter. Use YYYY-MM-DD.';
      return res.status(400).json({ error: msg });
    }

    const { date } = queryResult.data;
    const minDate = todayIST();
    const maxDate = daysFromTodayIST(config.maxAdvanceBookingDays);

    // 3. Enforce 7-day advance booking window
    if (date < minDate) {
      return res.status(400).json({
        error: 'Cannot view or book slots for past dates.',
      });
    }

    if (date > maxDate) {
      return res.status(400).json({
        error: `Bookings are only allowed up to ${config.maxAdvanceBookingDays} days in advance. Max allowed date is ${maxDate}.`,
      });
    }

    // 4. Fetch slot grid with live status
    const slots = facilitiesDal.getSlotsForFacilityAndDate(facilityId, date, req.user.id);

    res.json({
      facility: {
        id: facility.id,
        name: facility.name,
        description: facility.description,
      },
      date,
      slots,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

