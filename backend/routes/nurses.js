const express = require('express');
const { body, param, query: queryParam } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// Nurses are a lab-managed roster, not user accounts — every route here
// is worker/admin-only. There is no nurse-facing login or self-service.
// Deliberately NOT branch-scoped: nurses are shared across all branches
// (see branchAssignment design) — any worker can see/manage the shared
// roster to assign nurses to their own branch's requests. GET /load in
// particular checks a nurse's capacity against ALL their visits regardless
// of branch, since a nurse's day only has so many hours no matter which
// branch dispatched them.

const nurseValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Le nom est requis')
    .isLength({ max: 150 }).withMessage('Le nom doit faire 150 caractères ou moins'),

  body('phone')
    .trim()
    .notEmpty().withMessage('Le téléphone est requis')
    .isLength({ max: 20 }).withMessage('Le téléphone doit faire 20 caractères ou moins'),

  body('zone')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 150 }).withMessage('La zone doit faire 150 caractères ou moins'),

  body('max_visits_per_day')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1, max: 50 }).withMessage('La capacité doit être un nombre entre 1 et 50'),
];

// GET /api/nurses — list roster (active by default; ?include_inactive=1 for all)
router.get('/', authenticate, requireRole('worker', 'admin'), async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === '1';
    const { rows } = await query(
      `SELECT id, name, phone, zone, max_visits_per_day, is_active, created_at
       FROM nurses
       ${includeInactive ? '' : 'WHERE is_active = true'}
       ORDER BY name ASC`
    );
    res.json({ data: rows });
  } catch (err) {
    console.error('List nurses error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// POST /api/nurses — add a nurse to the roster
router.post('/', authenticate, requireRole('worker', 'admin'), nurseValidation, validate, async (req, res) => {
  try {
    const { name, phone, zone, max_visits_per_day } = req.body;
    const { rows } = await query(
      `INSERT INTO nurses (name, phone, zone, max_visits_per_day)
       VALUES ($1, $2, $3, COALESCE($4, 6))
       RETURNING id, name, phone, zone, max_visits_per_day, is_active, created_at`,
      [name, phone, zone || null, max_visits_per_day || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create nurse error:', err);
    res.status(500).json({ error: "Erreur lors de l'ajout" });
  }
});

// PUT /api/nurses/:id — edit a nurse's info
router.put('/:id', authenticate, requireRole('worker', 'admin'), [param('id').isUUID(), ...nurseValidation], validate, async (req, res) => {
  try {
    const { name, phone, zone, max_visits_per_day } = req.body;
    const { rows } = await query(
      `UPDATE nurses SET name = $1, phone = $2, zone = $3, max_visits_per_day = COALESCE($4, max_visits_per_day) WHERE id = $5
       RETURNING id, name, phone, zone, max_visits_per_day, is_active, created_at`,
      [name, phone, zone || null, max_visits_per_day || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Infirmière introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update nurse error:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// PUT /api/nurses/:id/active — activate/deactivate (soft-delete)
// Deactivating keeps past nurse_requests assignments intact (FK is ON DELETE SET NULL,
// but we never hard-delete a nurse row from this route, only flip is_active).
router.put('/:id/active', authenticate, requireRole('worker', 'admin'), [
  param('id').isUUID(),
  body('is_active').isBoolean().withMessage('is_active doit être un booléen'),
], validate, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE nurses SET is_active = $1 WHERE id = $2 RETURNING id, name, phone, zone, max_visits_per_day, is_active, created_at`,
      [req.body.is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Infirmière introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Toggle nurse active error:', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// GET /api/nurses/load?date=YYYY-MM-DD — current assigned count vs capacity per
// nurse for that day. Counts requests already assigned (regardless of status,
// since a pending-but-assigned visit still occupies that nurse's day) split by
// slot. Used by the worker dashboard to warn before overloading someone.
router.get('/load', authenticate, requireRole('worker', 'admin'), [
  queryParam('date').isISO8601().withMessage('date invalide'),
], validate, async (req, res) => {
  try {
    const { date } = req.query;
    const { rows } = await query(
      `SELECT
         n.id, n.name, n.max_visits_per_day,
         COUNT(nr.id) FILTER (WHERE nr.preferred_slot = 'morning')   AS morning_count,
         COUNT(nr.id) FILTER (WHERE nr.preferred_slot = 'afternoon') AS afternoon_count,
         COUNT(nr.id) AS total_count
       FROM nurses n
       LEFT JOIN nurse_requests nr
         ON nr.assigned_nurse_id = n.id
         AND nr.preferred_date = $1
         AND nr.status NOT IN ('cancelled', 'no_show')
       WHERE n.is_active = true
       GROUP BY n.id, n.name, n.max_visits_per_day
       ORDER BY n.name ASC`,
      [date]
    );
    res.json({ data: rows });
  } catch (err) {
    console.error('Nurse load error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération de la charge' });
  }
});

module.exports = router;