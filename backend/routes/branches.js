const express = require('express');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/branches — list active branches. Worker/admin only: this powers
// the admin "all branches" switcher in the dashboard, and there's no
// client-facing use for a raw branch list today (clients see their
// assigned branch's name/address inline on their own requests instead,
// via the join already in GET /api/nurse/mine).
router.get('/', authenticate, requireRole('worker', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, address, lat, lng FROM branches WHERE is_active = true ORDER BY name ASC`
    );
    res.json({ data: rows });
  } catch (err) {
    console.error('List branches error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des agences' });
  }
});

module.exports = router;