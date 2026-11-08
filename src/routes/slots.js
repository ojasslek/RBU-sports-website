// Read-only slot availability API.
// Every route requires a signed-in student. Phase 3 adds the booking routes.

const express = require('express');
const { z } = require('zod');
const slotService = require('../services/slot-service');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../utils/validate');

const router = express.Router();

const slotQuerySchema = z.object({
  facilityId: z.coerce
    .number({ error: 'Choose a facility.' })
    .int('Choose a facility.')
    .positive('Choose a facility.'),
  date: z
    .string({ error: 'Choose a date.' })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.')
});

// Returns the facility list plus the seven-day date window. The window is
// calculated on the server so the browser never decides what "today" means.
router.get('/facilities', requireAuth, (req, res) => {
  res.json(slotService.getFacilities());
});

// Returns availability for one facility on one date.
router.get('/slots', requireAuth, (req, res) => {
  const query = validate(slotQuerySchema, req.query || {});
  res.json(slotService.getSlotBoard({ ...query, userId: req.user.id }));
});

module.exports = router;
