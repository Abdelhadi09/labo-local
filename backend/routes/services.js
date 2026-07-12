const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/services
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, code, name, description, price
       FROM analysis_services
       WHERE is_active = true
       ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error('Get services error:', err);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

module.exports = router;