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

  body('preferred_date')
    .trim()
    .notEmpty().withMessage('La date souhaitée est requise')
    .isISO8601().withMessage('Date invalide')
    .custom(value => {
      // Compare calendar days only (not time-of-day) so "today" is always valid
      // regardless of what time the client submits the request.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const requested = new Date(value);
      requested.setHours(0, 0, 0, 0);
      if (requested < today) throw new Error('La date souhaitée ne peut pas être dans le passé');
      return true;
    }),

  body('preferred_slot')
    .trim()
    .isIn(['morning', 'afternoon']).withMessage('Créneau invalide'),

  // Fasting-test visits need to go out early; a same-day morning request
  // submitted mid-afternoon can't realistically be staffed. This mirrors an
  // operational cutoff, not just a UX nicety — the lab needs lead time to
  // assign and dispatch a nurse for the next morning round.
  body().custom(({ preferred_date, preferred_slot }) => {
    if (!preferred_date || !preferred_slot) return true; // let the individual field validators report those errors
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requested = new Date(preferred_date);
    requested.setHours(0, 0, 0, 0);
    const isToday = requested.getTime() === today.getTime();
    const currentHour = new Date().getHours();
    if (isToday && preferred_slot === 'morning' && currentHour >= 12) {
      throw new Error("Trop tard pour réserver le créneau du matin aujourd'hui — choisissez demain ou l'après-midi");
    }
    return true;
  }),
];

// POST /api/nurse — client requests a nurse visit
router.post('/', authenticate, requireRole('client'), nurseRequestValidation, validate, async (req, res) => {
  try {
    const { demand_id, phone, address, address_lat, address_lng, preferred_date, preferred_slot } = req.body;

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

    // If the client submitted coordinates (map-picker path), use those.
    // Otherwise they used their saved profile address — pull its lat/lng so
    // the request is still placeable on the worker's map instead of silently
    // having no coordinates at all.
    let finalLat = address_lat || null;
    let finalLng = address_lng || null;
    if (finalLat == null || finalLng == null) {
      const { rows: profileRows } = await query(
        `SELECT address_lat, address_lng FROM client_profiles WHERE user_id = $1`,
        [req.user.id]
      );
      if (profileRows[0]) {
        finalLat = profileRows[0].address_lat ?? finalLat;
        finalLng = profileRows[0].address_lng ?? finalLng;
      }
    }

    const { rows: inserted } = await query(
      `INSERT INTO nurse_requests (demand_id, client_id, phone, address, address_lat, address_lng, preferred_date, preferred_slot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [demand_id, req.user.id, phone, address, finalLat, finalLng, preferred_date, preferred_slot]
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

// GET /api/nurse/mine?demand_ids=id1,id2 — client fetches their own nurse
// request(s), keyed by demand. Used by the client dashboard to show real
// status (and offer cancel) instead of a local "requested" flag that can't
// reflect confirmation, assignment, or cancellation.
router.get('/mine', authenticate, requireRole('client'), async (req, res) => {
  try {
    const demandIds = (req.query.demand_ids || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const { rows } = await query(
      demandIds.length > 0
        ? `SELECT nr.id, nr.demand_id, nr.status, nr.preferred_date, nr.preferred_slot,
                  nr.cancelled_by, nr.cancelled_reason, n.name AS assigned_nurse_name
           FROM nurse_requests nr
           LEFT JOIN nurses n ON n.id = nr.assigned_nurse_id
           WHERE nr.client_id = $1 AND nr.demand_id = ANY($2::uuid[])`
        : `SELECT nr.id, nr.demand_id, nr.status, nr.preferred_date, nr.preferred_slot,
                  nr.cancelled_by, nr.cancelled_reason, n.name AS assigned_nurse_name
           FROM nurse_requests nr
           LEFT JOIN nurses n ON n.id = nr.assigned_nurse_id
           WHERE nr.client_id = $1`,
      demandIds.length > 0 ? [req.user.id, demandIds] : [req.user.id]
    );

    res.json({ data: rows });
  } catch (err) {
    console.error('Get own nurse requests error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération' });
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
         n.name              AS assigned_nurse_name,
         n.phone             AS assigned_nurse_phone,
         n.zone              AS assigned_nurse_zone,
         COALESCE(svc.analyses, ARRAY[]::text[]) AS analyses
       FROM nurse_requests nr
       JOIN demands d          ON d.id = nr.demand_id
       LEFT JOIN users u       ON u.id = d.client_id
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       LEFT JOIN nurses n      ON n.id = nr.assigned_nurse_id
       LEFT JOIN LATERAL (
         SELECT array_agg(asv.name) AS analyses
         FROM demand_items di
         JOIN analysis_services asv ON asv.id = di.service_id
         WHERE di.demand_id = d.id
       ) svc ON true
       ORDER BY nr.preferred_date ASC, nr.created_at DESC
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
    .isIn(['pending', 'confirmed', 'done', 'cancelled', 'no_show']).withMessage('Status invalide'),
  body('reason')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 300 }).withMessage('Le motif doit faire 300 caractères ou moins'),
];

const TERMINAL_STATUSES = ['done', 'cancelled', 'no_show'];

router.put('/:id/status', authenticate, requireRole('worker'), nurseStatusValidation, validate, async (req, res) => {
  try {
    const { status, reason } = req.body;

    const { rows: currentRows } = await query(
      `SELECT status, assigned_nurse_id FROM nurse_requests WHERE id = $1`,
      [req.params.id]
    );
    const current = currentRows[0];
    if (!current) return res.status(404).json({ error: "Demande d'infirmière introuvable" });

    // Dead end by design: once a visit is done, cancelled, or a no-show,
    // nothing reopens it — the client submits a fresh request instead.
    // This keeps the history honest instead of a status flip-flopping.
    if (TERMINAL_STATUSES.includes(current.status)) {
      return res.status(409).json({ error: 'Cette demande est déjà clôturée et ne peut plus être modifiée' });
    }

    // A request can't be "confirmed" without an actual nurse behind that
    // promise — this is the check that turns confirmation into something real.
    if (status === 'confirmed' && !current.assigned_nurse_id) {
      return res.status(400).json({ error: 'Assignez une infirmière avant de confirmer la demande' });
    }

    const isTerminalNegative = status === 'cancelled' || status === 'no_show';
    await query(
      `UPDATE nurse_requests
       SET status = $1,
           cancelled_by = ${isTerminalNegative ? `'worker'` : 'NULL'},
           cancelled_reason = $2,
           cancelled_at = ${isTerminalNegative ? 'now()' : 'NULL'}
       WHERE id = $3`,
      [status, isTerminalNegative ? (reason || null) : null, req.params.id]
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

// PUT /api/nurse/:id/cancel — client cancels their own request
// Allowed only while pending or confirmed — once a nurse has actually gone
// (done) or the lab already closed it out (cancelled/no_show), there's
// nothing left for the client to cancel.
router.put('/:id/cancel', authenticate, requireRole('client'), [
  param('id').isUUID().withMessage('id must be a valid UUID'),
], validate, async (req, res) => {
  try {
    const { rows: currentRows } = await query(
      `SELECT status FROM nurse_requests WHERE id = $1 AND client_id = $2`,
      [req.params.id, req.user.id]
    );
    const current = currentRows[0];
    if (!current) return res.status(404).json({ error: "Demande d'infirmière introuvable" });

    if (!['pending', 'confirmed'].includes(current.status)) {
      return res.status(409).json({ error: 'Cette demande ne peut plus être annulée' });
    }

    await query(
      `UPDATE nurse_requests
       SET status = 'cancelled', cancelled_by = 'client', cancelled_reason = NULL, cancelled_at = now()
       WHERE id = $1`,
      [req.params.id]
    );

    posthog.capture({
      distinctId: req.user.id,
      event: 'nurse_request_cancelled_by_client',
      properties: { nurse_request_id: req.params.id },
    });

    res.json({ message: 'Demande annulée' });
  } catch (err) {
    console.error('Client cancel nurse request error:', err);
    posthog.captureException(err, req.user?.id, { endpoint: `/api/nurse/${req.params.id}/cancel` });
    res.status(500).json({ error: "Erreur lors de l'annulation" });
  }
});

// PUT /api/nurse/:id/assign — worker assigns (or reassigns) a nurse to a request
// Separate from the status endpoint: assigning who's going and confirming that
// the visit will happen are different decisions a worker can make independently.
const nurseAssignValidation = [
  param('id').isUUID().withMessage('id must be a valid UUID'),
  body('nurse_id')
    .optional({ nullable: true })
    .isUUID().withMessage('nurse_id must be a valid UUID'), // null/omitted clears the assignment
  body('force')
    .optional()
    .isBoolean().withMessage('force must be a boolean'), // explicit override past capacity
];

router.put('/:id/assign', authenticate, requireRole('worker'), nurseAssignValidation, validate, async (req, res) => {
  try {
    const nurseId = req.body.nurse_id || null;
    const force = req.body.force === true;

    if (nurseId) {
      const { rows: nurseRows } = await query(
        `SELECT id, max_visits_per_day FROM nurses WHERE id = $1 AND is_active = true`,
        [nurseId]
      );
      const nurse = nurseRows[0];
      if (!nurse) return res.status(400).json({ error: 'Infirmière introuvable ou inactive' });

      // Capacity check: how many visits is this nurse already assigned on the
      // SAME preferred_date as the request being assigned (not "today" —
      // the day the visit will actually happen). Excludes the request itself
      // in case it's a reassignment being confirmed again.
      const { rows: reqRows } = await query(
        `SELECT preferred_date FROM nurse_requests WHERE id = $1`,
        [req.params.id]
      );
      if (!reqRows[0]) return res.status(404).json({ error: "Demande d'infirmière introuvable" });
      const { preferred_date } = reqRows[0];

      const { rows: loadRows } = await query(
        `SELECT COUNT(*)::int AS count FROM nurse_requests
         WHERE assigned_nurse_id = $1 AND preferred_date = $2 AND id != $3
           AND status NOT IN ('cancelled', 'no_show')`,
        [nurseId, preferred_date, req.params.id]
      );
      const currentLoad = loadRows[0].count;

      if (!force && currentLoad >= nurse.max_visits_per_day) {
        return res.status(409).json({
          error: `Cette infirmière a déjà ${currentLoad} visite(s) prévue(s) ce jour-là (limite : ${nurse.max_visits_per_day})`,
          code: 'CAPACITY_EXCEEDED',
          current_load: currentLoad,
          max_visits_per_day: nurse.max_visits_per_day,
        });
      }
    }

    const { rows } = await query(
      `UPDATE nurse_requests SET assigned_nurse_id = $1 WHERE id = $2 RETURNING id`,
      [nurseId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Demande d'infirmière introuvable" });

    posthog.capture({
      distinctId: req.user.id,
      event: 'nurse_request_assigned',
      properties: { nurse_request_id: req.params.id, nurse_id: nurseId },
    });

    res.json({ message: nurseId ? 'Infirmière assignée' : 'Assignation retirée' });
  } catch (err) {
    console.error('Assign nurse error:', err);
    posthog.captureException(err, req.user?.id, { endpoint: `/api/nurse/${req.params.id}/assign` });
    res.status(500).json({ error: "Erreur lors de l'assignation" });
  }
});

module.exports = router;