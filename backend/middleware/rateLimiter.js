const rateLimit = require('express-rate-limit');

// ─── Reusable factory ────────────────────────────────────────────────────────
const make = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,   // Return RateLimit-* headers
    legacyHeaders: false,
    message: { error: message },
    // Key by IP. req.ip's trustworthiness depends entirely on the
    // `trust proxy` setting in server.js (controlled by TRUST_PROXY env var):
    // with no trusted proxy configured (the default), req.ip is the raw
    // socket address, which can't be spoofed via headers — safe to key on.
    // If TRUST_PROXY is set because a real reverse proxy sits in front and
    // sanitizes X-Forwarded-For, req.ip becomes the real client IP as
    // forwarded by that proxy. Only set TRUST_PROXY if that proxy is
    // actually there — otherwise this key becomes attacker-controlled and
    // every limiter below is trivially bypassable by spoofing the header.
    keyGenerator: (req) => req.ip,
  });

// ─── Auth routes ─────────────────────────────────────────────────────────────
// Tight limit: 10 attempts per 15 minutes per IP.
// Covers brute-force on /login and prevents /client/session spam.
const authLimiter = make(
  15 * 60 * 1000,   // 15 min window
  10,
  'Trop de tentatives de connexion. Réessayez dans 15 minutes.'
);

// ─── OCR / file upload ───────────────────────────────────────────────────────
// Tesseract is CPU-heavy. Allow 10 uploads per 10 minutes per IP.
const uploadLimiter = make(
  10 * 60 * 1000,   // 10 min window
  10,
  'Trop de soumissions. Réessayez dans 10 minutes.'
);

// ─── General API ─────────────────────────────────────────────────────────────
// Broad safety net for all other API calls.
const generalLimiter = make(
  60 * 1000,        // 1 min window
  120,
  'Trop de requêtes. Réessayez dans une minute.'
);

module.exports = { authLimiter, uploadLimiter, generalLimiter };