const express = require('express');
const { body, param } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const posthog = require('../config/posthog');

const router = express.Router();

// Algerian-style or generic international phone numbers: optional leading +,
// 8-15 digits, allowing spaces/dashes/parens for readability.
const PHONE_REGEX = /^\+?[0-9\s().-]{8,20}$/;

const nurseRequestValidation = [
  body('demand_id')
    .trim()
    .notEmpty().withMessage('demand_id is required')
    .isUUID().withMessage('demand_id must be a valid UUID'),

  body('phone')
    .trim()
    .notEmpty().withMessage('Phone is required')
    .isLength({ max: 20 }).withMessage('Phone must be 20 characters or fewer')
    .matches(PHONE_REGEX).withMessage('Phone number format is invalid'),

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

// POST /api/nurse — client requests a nurse visit
router.post('/', authenticate, requireRole('client'), nurseRequestValidation, validate, async (req, res) => {
  try {
    const { demand_id, phone, address, address_lat, address_lng } = req.body;

    // Verify demand belongs to this client and is processed
    const { rows: demandRows } = await query(
      `SELECT id, status, client_id FROM demands WHERE id = $1 AND client_id = $2`,
      [demand_id, req.user.id]
    );
    const demand = demandRows[0];
    if (!demand) return res.status(404).json({ error: 'Demande introuvable' });

    if (!['processed', 'ocr_processed'].includes(demand.status))
      return res.status(400).json({ error: 'La demande doit être traitée avant de demander une infirmière' });

    // Check not already requested
    const { rows: existingRows } = await query(
      `SELECT id FROM nurse_requests WHERE demand_id = $1`,
      [demand_id]
    );
    if (existingRows[0])
      return res.status(409).json({ error: "Une demande d'infirmière existe déjà pour cette analyse" });

    const { rows: inserted } = await query(
      `INSERT INTO nurse_requests (demand_id, client_id, phone, address, address_lat, address_lng)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [demand_id, req.user.id, phone, address, address_lat || null, address_lng || null]
    );

    posthog.capture({
      distinctId: req.user.id,
      event: 'nurse_visit_requested',
      properties: { demand_id, nurse_request_id: inserted[0].id },
    });

    res.status(201).json({ id: inserted[0].id, message: "Demande d'infirmière soumise avec succès" });
  } catch (err) {
    console.error('Nurse request error:', err);
    posthog.captureException(err, req.user?.id, { endpoint: '/api/nurse' });
    res.status(500).json({ error: 'Erreur lors de la soumission' });
  }
});

// GET /api/nurse — worker sees nurse requests (paginated)
// Query params: page (1-based, default 1), limit (default 20, max 100)
router.get('/', authenticate, requireRole('worker'), async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // Same nesting depth as the original Supabase relational select:
    // nurse_requests -> demands -> demand_items -> analysis_services,
    // plus demands -> users -> client_profiles. Flattened at the SQL
    // level via joins + a lateral array_agg, instead of in JS afterward,
    // but the OUTPUT SHAPE below matches the old .map() exactly.
    const { rows } = await query(
      `SELECT
         nr.*,
         d.total_price      AS demand_total,
         d.ordonnance_type  AS demand_type,
         u.username,
         cp.first_name,
         cp.last_name,
         COALESCE(svc.analyses, ARRAY[]::text[]) AS analyses
       FROM nurse_requests nr
       JOIN demands d          ON d.id = nr.demand_id
       LEFT JOIN users u       ON u.id = d.client_id
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT array_agg(asv.name) AS analyses
         FROM demand_items di
         JOIN analysis_services asv ON asv.id = di.service_id
         WHERE di.demand_id = d.id
       ) svc ON true
       ORDER BY nr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS count FROM nurse_requests`);
    const count = countRows[0].count;

    res.json({
      data:        rows,
      total:       count ?? 0,
      page,
      limit,
      total_pages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    console.error('Get nurse requests error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// PUT /api/nurse/:id/status — worker updates status
const nurseStatusValidation = [
  param('id').isUUID().withMessage('id must be a valid UUID'),
  body('status')
    .trim()
    .isIn(['pending', 'confirmed', 'done']).withMessage('Status invalide'),
];

router.put('/:id/status', authenticate, requireRole('worker'), nurseStatusValidation, validate, async (req, res) => {
  try {
    const { status } = req.body;

    await query(
      `UPDATE nurse_requests SET status = $1 WHERE id = $2`,
      [status, req.params.id]
    );

    posthog.capture({
      distinctId: req.user.id,
      event: 'nurse_request_status_updated',
      properties: { nurse_request_id: req.params.id, status },
    });

    res.json({ message: 'Statut mis à jour' });
  } catch (err) {
    console.error('Update nurse status error:', err);
    posthog.captureException(err, req.user?.id, { endpoint: `/api/nurse/${req.params.id}/status` });
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

module.exports = router;