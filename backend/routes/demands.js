const express = require('express');
const multer = require('multer');
const { body, param, query: queryValidator } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { validateImageFile } = require('../middleware/fileValidation');
const { validate } = require('../middleware/validate');
const fs = require('fs');
const { uploadOrdonnance, deleteOrdonnance, resolveStoredPath, mimeForStoredPath } = require('../services/blobStorage');
const { extractTextFromImage, matchServicesFromText } = require('../services/ocrService');
const { getDefaultBranchId } = require('../services/branchAssignment');
const { withTimeout } = require('../utils/withTimeout');
const posthog = require('../config/posthog');

const router = express.Router();

// Normalize the demand_items rows returned by our joined query into the
// same shape the old Supabase nested-select + mapItems() produced.
const mapItems = (rows) =>
  (rows || []).map(i => ({
    id:         i.item_id,
    price:      i.item_price,
    service_id: i.service_id,
    name:       i.service_name,
    code:       i.service_code,
  }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/tiff'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Images only (JPEG, PNG, WEBP, TIFF)'));
  },
});

// ─── POST /api/demands ────────────────────────────────────────────────────────
const createDemandValidation = [
  body('ordonnance_type')
    .trim()
    .isIn(['ocr', 'handwritten', 'manual']).withMessage('ordonnance_type must be "ocr", "handwritten" or "manual"'),

  body('idempotency_key')
    .optional()
    .isUUID().withMessage('idempotency_key must be a valid UUID'),

  body('service_ids')
    .optional()
    .custom((value) => {
      let ids = value;
      if (typeof value === 'string') {
        try {
          ids = JSON.parse(value);
        } catch {
          throw new Error('service_ids must be a valid JSON array');
        }
      }
      if (!Array.isArray(ids) || ids.length === 0)
        throw new Error('service_ids must be a non-empty array');
      if (ids.length > 50)
        throw new Error('service_ids cannot contain more than 50 items');
      if (!ids.every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
        throw new Error('service_ids must contain only valid UUIDs');
      return true;
    }),
];

router.post('/', authenticate, requireRole('client'), uploadLimiter, upload.single('ordonnance'), validateImageFile, createDemandValidation, validate, async (req, res) => {
  const { ordonnance_type, service_ids, idempotency_key } = req.body;
  let fileUrl = null;

  try {
    if (ordonnance_type !== 'manual' && !req.file)
      return res.status(400).json({ error: 'Ordonnance file is required' });

    // Check for duplicate by idempotency_key
    if (idempotency_key) {
      const { rows } = await query(
        `SELECT id, status FROM demands WHERE idempotency_key = $1`,
        [idempotency_key]
      );
      if (rows[0]) {
        return res.status(200).json({
          id: rows[0].id,
          status: rows[0].status,
          deduplicated: true,
          message: 'Demand already submitted (duplicate prevention)'
        });
      }
    }

    // Verify client has a profile
    const { rows: profileRows } = await query(
      `SELECT id FROM client_profiles WHERE user_id = $1`,
      [req.user.id]
    );
    if (!profileRows[0])
      return res.status(400).json({ error: 'Please complete your profile before submitting' });

    // Phase 1a: demands always go to the default branch (see
    // getDefaultBranchId's docstring) rather than a real ORS-based
    // assignment — that's Phase 1b. Resolved once here so both creation
    // paths below (manual and file-upload) use the same value.
    const branchId = await getDefaultBranchId();
    if (!branchId) {
      console.error('Demand creation failed: no active branches configured');
      return res.status(503).json({ error: "Aucune agence disponible pour le moment. Veuillez réessayer plus tard." });
    }

    // ── Manual mode ────────────────────────────────────────────────────────
    if (ordonnance_type === 'manual') {
      if (!service_ids) return res.status(400).json({ error: 'service_ids is required for manual submission' });

      const ids = Array.isArray(service_ids) ? service_ids : JSON.parse(service_ids);
      const { rows: selectedServices } = await query(
        `SELECT * FROM analysis_services WHERE id = ANY($1::uuid[]) AND is_active = true`,
        [ids]
      );
      if (!selectedServices || selectedServices.length !== ids.length)
        return res.status(400).json({ error: 'One or more services not found or inactive' });

      const totalPrice = selectedServices.reduce((sum, s) => sum + parseFloat(s.price), 0);
      const itemsJson = JSON.stringify(selectedServices.map(s => ({ service_id: s.id, price: s.price })));

      const { rows: demandRows } = await query(
        `SELECT * FROM create_demand_with_items($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [req.user.id, 'manual', 'manual', 'processed', null, totalPrice, itemsJson, idempotency_key || null, branchId]
      );
      const demand = demandRows[0].create_demand_with_items; // jsonb result: { id }

      posthog.capture({
        distinctId: req.user.id,
        event: 'demand_submitted',
        properties: {
          ordonnance_type: 'manual',
          service_count: selectedServices.length,
          total_price: totalPrice,
        },
      });

      return res.status(201).json({
        id: demand.id, status: 'processed', ordonnance_type: 'manual',
        matched_services: selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price })),
        total_price: totalPrice,
        message: `Demande enregistrée. Total: ${totalPrice} DA`,
      });
    }

    // ── File upload (with timeout) — unchanged, still Cloudinary for now (Epic 2) ──
    fileUrl = await withTimeout(
      uploadOrdonnance(req.file.buffer, req.file.originalname, req.file.mimetype),
      30_000,
      'Cloudinary upload'
    );

    let ocrText = null;
    let matchedServices = [];
    let totalPrice = null;
    let status = 'pending';

    if (ordonnance_type === 'ocr') {
      // Synchronous OCR — unchanged, still calling Tesseract inline (Epic 3 confirms this stays)
      ocrText = await withTimeout(
        extractTextFromImage(req.file.buffer),
        60_000,
        'OCR processing'
      );

      const { rows: allServices } = await query(
        `SELECT * FROM analysis_services WHERE is_active = true`
      );

      matchedServices = matchServicesFromText(ocrText, allServices || []);
      totalPrice = matchedServices.reduce((sum, s) => sum + parseFloat(s.price), 0);
      status = matchedServices.length > 0 ? 'ocr_processed' : 'ocr_no_match';
    }

    // ── DB insert (with file cleanup on failure) ────────────────────────────
    const itemsJson = JSON.stringify(matchedServices.map(s => ({ service_id: s.id, price: s.price })));
    const { rows: demandRows } = await query(
      `SELECT * FROM create_demand_with_items($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [req.user.id, fileUrl, ordonnance_type, status, ocrText, totalPrice, itemsJson, idempotency_key || null, branchId]
    );
    const demand = demandRows[0].create_demand_with_items;

    if (ordonnance_type === 'ocr') {
      const ocrEvent = matchedServices.length > 0 ? 'demand_ocr_matched' : 'demand_ocr_no_match';
      posthog.capture({
        distinctId: req.user.id,
        event: ocrEvent,
        properties: {
          matched_service_count: matchedServices.length,
          total_price: totalPrice,
        },
      });
    }

    posthog.capture({
      distinctId: req.user.id,
      event: 'demand_submitted',
      properties: {
        ordonnance_type,
        service_count: matchedServices.length,
        total_price: totalPrice,
        status,
      },
    });

    res.status(201).json({
      id: demand.id, status, ordonnance_type,
      matched_services: matchedServices.map(s => ({ id: s.id, name: s.name, price: s.price })),
      total_price: totalPrice, ocr_text: ocrText,
      message: ordonnance_type === 'ocr'
        ? matchedServices.length > 0
          ? `Trouvé ${matchedServices.length} analyse(s). Total: ${totalPrice} DA`
          : "Aucune analyse reconnue. Un technicien va examiner l'ordonnance."
        : 'Ordonnance soumise. Un technicien la traitera sous peu.',
    });
  } catch (err) {
    // Cleanup: delete orphaned file if it was uploaded
    if (fileUrl) {
      deleteOrdonnance(fileUrl).catch(delErr => {
        console.error('Failed to clean up orphaned Cloudinary file:', { fileUrl, delErr });
      });
    }
    console.error('Submit demand error:', err);
    posthog.captureException(err, req.user?.id, { endpoint: '/api/demands', method: 'POST' });
    res.status(500).json({ error: err.message || 'Failed to submit demand' });
  }
});

// ─── GET /api/demands ─────────────────────────────────────────────────────────
// Query params: page (1-based, default 1), limit (default 20, max 100)
const listDemandsValidation = [
  queryValidator('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  // Admin-only: narrow the "all branches" overview to one specific branch.
  // Ignored for non-admins (a branch-scoped worker already can't see past
  // their own branch, so their own branch_id "wins" regardless of what's
  // passed here — see below).
  queryValidator('branch_id').optional().isUUID().withMessage('branch_id must be a valid UUID'),
];

router.get('/', authenticate, listDemandsValidation, validate, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // Demand items joined + aggregated as JSON, one row per demand (avoids
    // duplicate demand rows from a plain item-level join — mirrors the
    // nested-array shape Supabase's relational select produced).
    const itemsAgg = `
      COALESCE(
        (SELECT json_agg(json_build_object(
            'item_id', di.id, 'item_price', di.price,
            'service_id', asv.id, 'service_name', asv.name, 'service_code', asv.code
          ))
         FROM demand_items di
         JOIN analysis_services asv ON asv.id = di.service_id
         WHERE di.demand_id = d.id
        ), '[]'::json
      ) AS items_raw`;

    let rows, countRows;

    if (req.user.role === 'worker' || req.user.role === 'admin') {
      const isAdmin = req.user.role === 'admin';
      // Worker: always their own branch, no matter what's in the query
      // string — the query param only ever narrows an admin's view, it
      // can't be used to escape a worker's own branch scoping.
      const effectiveBranchId = isAdmin ? (req.query.branch_id || null) : req.user.branch_id;
      const branchClause = effectiveBranchId ? `WHERE d.branch_id = $3` : '';
      const params = effectiveBranchId ? [limit, offset, effectiveBranchId] : [limit, offset];

      ({ rows } = await query(
        `SELECT d.*, ${itemsAgg},
                u.username,
                cp.first_name, cp.last_name, cp.birthday, cp.address,
                b.name AS branch_name
         FROM demands d
         LEFT JOIN users u ON u.id = d.client_id
         LEFT JOIN client_profiles cp ON cp.user_id = u.id
         LEFT JOIN branches b ON b.id = d.branch_id
         ${branchClause}
         ORDER BY d.created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      ));
      ({ rows: countRows } = await query(
        effectiveBranchId
          ? `SELECT COUNT(*)::int AS count FROM demands WHERE branch_id = $1`
          : `SELECT COUNT(*)::int AS count FROM demands`,
        effectiveBranchId ? [effectiveBranchId] : []
      ));
    } else {
      ({ rows } = await query(
        `SELECT d.*, ${itemsAgg}
         FROM demands d
         WHERE d.client_id = $1
         ORDER BY d.created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ));
      ({ rows: countRows } = await query(
        `SELECT COUNT(*)::int AS count FROM demands WHERE client_id = $1`,
        [req.user.id]
      ));
    }

    const count = countRows[0].count;

    const demands = rows.map(d => {
      const { items_raw, username, first_name, last_name, birthday, address, ...rest } = d;
      const base = { ...rest, items: mapItems(items_raw) };
      return (req.user.role === 'worker' || req.user.role === 'admin')
        ? { ...base, username, first_name, last_name, birthday, address }
        : base;
    });

    res.json({
      data:        demands,
      total:       count ?? 0,
      page,
      limit,
      total_pages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    console.error('Get demands error:', err);
    res.status(500).json({ error: 'Failed to fetch demands' });
  }
});

// ─── GET /api/demands/:id ─────────────────────────────────────────────────────
router.get('/:id', authenticate, param('id').isUUID().withMessage('id must be a valid UUID'), validate, async (req, res) => {
  try {
    const itemsAgg = `
      COALESCE(
        (SELECT json_agg(json_build_object(
            'item_id', di.id, 'item_price', di.price,
            'service_id', asv.id, 'service_name', asv.name, 'service_code', asv.code
          ))
         FROM demand_items di
         JOIN analysis_services asv ON asv.id = di.service_id
         WHERE di.demand_id = d.id
        ), '[]'::json
      ) AS items_raw`;

    let rows;
    if (req.user.role === 'worker') {
      ({ rows } = await query(
        `SELECT d.*, ${itemsAgg},
                u.username,
                cp.first_name, cp.last_name, cp.birthday, cp.address,
                b.name AS branch_name
         FROM demands d
         LEFT JOIN users u ON u.id = d.client_id
         LEFT JOIN client_profiles cp ON cp.user_id = u.id
         LEFT JOIN branches b ON b.id = d.branch_id
         WHERE d.id = $1 AND d.branch_id = $2`,
        [req.params.id, req.user.branch_id]
      ));
    } else if (req.user.role === 'admin') {
      ({ rows } = await query(
        `SELECT d.*, ${itemsAgg},
                u.username,
                cp.first_name, cp.last_name, cp.birthday, cp.address,
                b.name AS branch_name
         FROM demands d
         LEFT JOIN users u ON u.id = d.client_id
         LEFT JOIN client_profiles cp ON cp.user_id = u.id
         LEFT JOIN branches b ON b.id = d.branch_id
         WHERE d.id = $1`,
        [req.params.id]
      ));
    } else {
      ({ rows } = await query(
        `SELECT d.*, ${itemsAgg}
         FROM demands d
         WHERE d.id = $1 AND d.client_id = $2`,
        [req.params.id, req.user.id]
      ));
    }

    const data = rows[0];
    if (!data) return res.status(404).json({ error: 'Demand not found' });

    const { items_raw, username, first_name, last_name, birthday, address, ...rest } = data;
    const demand = (req.user.role === 'worker' || req.user.role === 'admin')
      ? { ...rest, username, first_name, last_name, birthday, address, items: mapItems(items_raw) }
      : { ...rest, items: mapItems(items_raw) };

    res.json(demand);
  } catch (err) {
    console.error('Get demand error:', err);
    res.status(500).json({ error: 'Failed to fetch demand' });
  }
});

// ─── GET /api/demands/:id/ordonnance ──────────────────────────────────────────
// Streams the prescription image for one demand. This is the ONLY way the
// file on disk is reachable — there is no static/public mount for
// STORAGE_ROOT (see server.js). Ownership check mirrors GET /:id exactly:
// workers can view any demand's file, clients only their own.
router.get('/:id/ordonnance', authenticate, param('id').isUUID().withMessage('id must be a valid UUID'), validate, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'worker') {
      ({ rows } = await query(
        `SELECT ordonnance_url FROM demands WHERE id = $1 AND branch_id = $2`,
        [req.params.id, req.user.branch_id]
      ));
    } else if (req.user.role === 'admin') {
      ({ rows } = await query(`SELECT ordonnance_url FROM demands WHERE id = $1`, [req.params.id]));
    } else {
      ({ rows } = await query(
        `SELECT ordonnance_url FROM demands WHERE id = $1 AND client_id = $2`,
        [req.params.id, req.user.id]
      ));
    }

    const demand = rows[0];
    // 404 (not 403) whether the demand doesn't exist or isn't owned by this
    // client — same "don't reveal existence" behavior as GET /:id.
    if (!demand) return res.status(404).json({ error: 'Demand not found' });

    const { ordonnance_url } = demand;
    if (!ordonnance_url || ordonnance_url === 'manual') {
      return res.status(404).json({ error: 'No ordonnance file for this demand' });
    }

    let absolutePath;
    try {
      absolutePath = resolveStoredPath(ordonnance_url);
    } catch {
      return res.status(404).json({ error: 'Ordonnance file not found' });
    }

    fs.stat(absolutePath, (statErr, stats) => {
      if (statErr || !stats.isFile()) {
        return res.status(404).json({ error: 'Ordonnance file not found' });
      }

      res.setHeader('Content-Type', mimeForStoredPath(ordonnance_url));
      res.setHeader('Content-Length', stats.size);
      // Private + no-store: this is a patient's medical document, it must
      // never be cached by shared/intermediate caches or retained by the
      // browser disk cache beyond the authenticated session.
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', 'inline');

      const stream = fs.createReadStream(absolutePath);
      stream.on('error', (streamErr) => {
        console.error('Ordonnance stream error:', streamErr);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to read ordonnance file' });
      });
      stream.pipe(res);
    });
  } catch (err) {
    console.error('Get ordonnance error:', err);
    res.status(500).json({ error: 'Failed to fetch ordonnance' });
  }
});

// ─── PUT /api/demands/:id/process ─────────────────────────────────────────────
const processDemandValidation = [
  param('id').isUUID().withMessage('id must be a valid UUID'),
  body('service_ids')
    .isArray({ min: 1, max: 50 }).withMessage('service_ids array is required (1-50 items)'),
  body('service_ids.*')
    .isUUID().withMessage('Each service id must be a valid UUID'),
  body('notes')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 1000 }).withMessage('notes must be 1000 characters or fewer'),
];

router.put('/:id/process', authenticate, requireRole('worker', 'admin'), processDemandValidation, validate, async (req, res) => {
  try {
    const { service_ids, notes } = req.body;

    const { rows: demandRows } = await query(`SELECT * FROM demands WHERE id = $1`, [req.params.id]);
    const demand = demandRows[0];
    if (!demand) return res.status(404).json({ error: 'Demand not found' });

    // Same "don't reveal existence outside your branch" pattern as the
    // nurse request mutation routes.
    if (req.user.role === 'worker' && demand.branch_id !== req.user.branch_id) {
      return res.status(404).json({ error: 'Demand not found' });
    }

    if (!['pending','ocr_no_match'].includes(demand.status))
      return res.status(400).json({ error: 'Demand has already been processed' });

    const { rows: selectedServices } = await query(
      `SELECT * FROM analysis_services WHERE id = ANY($1::uuid[]) AND is_active = true`,
      [service_ids]
    );
    if (!selectedServices || selectedServices.length !== service_ids.length)
      return res.status(400).json({ error: 'One or more services not found or inactive' });

    const totalPrice = selectedServices.reduce((sum, s) => sum + parseFloat(s.price), 0);
    const itemsJson = JSON.stringify(selectedServices.map(s => ({ service_id: s.id, price: s.price })));

    await query(
      `SELECT * FROM process_demand_with_items($1, $2, $3, $4::jsonb)`,
      [demand.id, totalPrice, notes || null, itemsJson]
    );

    posthog.capture({
      distinctId: req.user.id,
      event: 'demand_processed',
      properties: {
        demand_id: demand.id,
        client_id: demand.client_id,
        service_count: selectedServices.length,
        total_price: totalPrice,
        previous_status: demand.status,
      },
    });

    res.json({
      message: 'Demand processed successfully',
      total_price: totalPrice,
      services: selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price })),
    });
  } catch (err) {
    console.error('Process demand error:', err);
    posthog.captureException(err, req.user?.id, { endpoint: `/api/demands/${req.params.id}/process` });
    res.status(500).json({ error: 'Failed to process demand' });
  }
});

module.exports = router;