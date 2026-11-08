// Booking API: hold, confirm, release, and the current hold.
//
// All routes require a signed-in student. POST requests also go through the
// global CSRF check in src/app.js. The server validates every value again here
// and never trusts the slot grid in the browser.
//
// There is no cancellation route in this project. "Release" only gives up an
// unconfirmed 5-minute hold; a confirmed booking cannot be released here.

const express = require('express');
const { z } = require('zod');
const bookingService = require('../services/booking-service');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../utils/validate');

const router = express.Router();

const holdSchema = z.object({
  slotId: z.coerce
    .number({ error: 'Choose a slot.' })
    .int('Choose a slot.')
    .positive('Choose a slot.'),
  date: z
    .string({ error: 'Choose a date.' })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.')
});

const bookingParamsSchema = z.object({
  bookingId: z.coerce
    .number({ error: 'Choose a booking.' })
    .int('Choose a booking.')
    .positive('Choose a booking.')
});

// The hold bar calls this after a reload so a hold survives page navigation.
router.get('/active', requireAuth, (req, res) => {
  res.json({ hold: bookingService.getActiveHold({ userId: req.user.id }) });
});

// Reserve a slot for a few minutes. Nothing is final until confirmation.
router.post('/hold', requireAuth, (req, res) => {
  const input = validate(holdSchema, req.body || {});
  const hold = bookingService.createHold({
    userId: req.user.id,
    slotId: input.slotId,
    date: input.date
  });

  res.status(201).json({ hold });
});

// Turn the student's own hold into a confirmed booking.
router.post('/:bookingId/confirm', requireAuth, (req, res) => {
  const { bookingId } = validate(bookingParamsSchema, req.params);
  const booking = bookingService.confirmBooking({
    userId: req.user.id,
    bookingId
  });

  res.json({ booking });
});

// Give up an unconfirmed hold. This is not a booking cancellation.
router.post('/:bookingId/release', requireAuth, (req, res) => {
  const { bookingId } = validate(bookingParamsSchema, req.params);
  bookingService.releaseHold({ userId: req.user.id, bookingId });
  res.json({ released: true });
});

module.exports = router;
