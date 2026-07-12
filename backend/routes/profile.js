const express = require('express');
const { body } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const posthog = require('../config/posthog');

const router = express.Router();

// Letters (incl. accented), spaces, hyphens and apostrophes only — covers
// French/Arabic-transliterated names without allowing markup or digits.
const NAME_REGEX = /^[\p{L}][\p{L}\s'-]{0,99}$/u;

const profileValidation = [
  body('first_name')
    .trim()
    .notEmpty().withMessage('First name is required')
    .isLength({ max: 100 }).withMessage('First name must be 100 characters or fewer')
    .matches(NAME_REGEX).withMessage('First name contains invalid characters'),

  body('last_name')
    .trim()
    .notEmpty().withMessage('Last name is required')
    .isLength({ max: 100 }).withMessage('Last name must be 100 characters or fewer')
    .matches(NAME_REGEX).withMessage('Last name contains invalid characters'),

  body('birthday')
    .trim()
    .notEmpty().withMessage('Birthday is required')
    .isISO8601().withMessage('Birthday must be a valid date (YYYY-MM-DD)')
    .custom((value) => {
      const parsed = new Date(value);
      const minDate = new Date('1900-01-01');
      if (parsed > new Date()) throw new Error('Birthday cannot be in the future');
      if (parsed < minDate) throw new Error('Birthday must be after 1900-01-01');
      return true;
    }),

  body('address')
    .trim()
    .notEmpty().withMessage('Address is required')
    .isLength({ max: 500 }).withMessage('Address must be 500 characters or fewer'),

  body('address_lat')
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: -90, max: 90 }).withMessage('address_lat must be between -90 and 90'),

  body('address_lng')
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: -180, max: 180 }).withMessage('address_lng must be between -180 and 180'),
];

// PUT /api/profile
router.put('/', authenticate, requireRole('client'), profileValidation, validate, async (req, res) => {
  try {
    const { first_name, last_name, birthday, address, address_lat, address_lng } = req.body;

    const { rows: existingRows } = await query(
      `SELECT id FROM client_profiles WHERE user_id = $1`,
      [req.user.id]
    );
    const existing = existingRows[0] || null;

    const lat = address_lat || null;
    const lng = address_lng || null;

    if (existing) {
      await query(
        `UPDATE client_profiles
         SET first_name = $1, last_name = $2, birthday = $3, address = $4,
             address_lat = $5, address_lng = $6, updated_at = NOW()
         WHERE user_id = $7`,
        [first_name, last_name, birthday, address, lat, lng, req.user.id]
      );
    } else {
      await query(
        `INSERT INTO client_profiles
           (first_name, last_name, birthday, address, address_lat, address_lng, user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [first_name, last_name, birthday, address, lat, lng, req.user.id]
      );
    }

    posthog.capture({
      distinctId: req.user.id,
      event: 'profile_saved',
      properties: { is_update: !!existing },
    });

    res.json({ message: 'Profile saved successfully' });
  } catch (err) {
    console.error('Profile save error:', err);
    posthog.captureException(err, req.user?.id, { endpoint: '/api/profile' });
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// GET /api/profile
router.get('/', authenticate, requireRole('client'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM client_profiles WHERE user_id = $1`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;