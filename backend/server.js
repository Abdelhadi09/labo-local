require('dotenv').config();
const fs = require('fs/promises');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { setupExpressRequestContext, setupExpressErrorHandler } = require('posthog-node');
const posthog = require('./config/posthog');
const { initializeDatabase } = require('./config/database');
const { authLimiter, uploadLimiter, generalLimiter } = require('./middleware/rateLimiter');
const { STORAGE_ROOT } = require('./services/blobStorage');


const app = express();
const PORT = process.env.PORT || 5000;

// ── Trust proxy configuration ───────────────────────────────────────────────
// express-rate-limit (and anything else reading req.ip) trusts whatever
// Express's trust-proxy setting says is trustworthy. Previously this was
// hardcoded to `app.set('trust proxy', 1)` unconditionally — which tells
// Express "trust the first hop's X-Forwarded-For entry as the real client
// IP" even when there is no actual reverse proxy sanitizing that header
// (e.g. running locally, or deployed without Nginx/Azure App Service in
// front). In that state, any client can send
// `X-Forwarded-For: 1.2.3.4` (a new value per request) and every IP-keyed
// rate limiter (login brute-force, upload limiter, general limiter) sees a
// different "IP" each time and never triggers.
//
// Fix: make this explicit and opt-in via TRUST_PROXY, defaulting to `false`
// (don't trust any forwarded header — use the actual socket address) unless
// the deployment genuinely sits behind a trusted proxy. Set TRUST_PROXY to:
//   - unset / "false"     → no proxy (default; correct for local/dev or
//                            directly-exposed deployments)
//   - a number, e.g. "1"  → trust exactly that many hops closest to the
//                            server (correct for a single reverse proxy like
//                            Nginx or Azure App Service terminating TLS)
//   - a specific value express supports (CIDR, IP, "loopback", etc.) → passed
//                            through as-is for finer-grained trust
const trustProxySetting = (() => {
  const raw = process.env.TRUST_PROXY;
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  const asNumber = Number(raw);
  return Number.isInteger(asNumber) ? asNumber : raw; // e.g. "loopback", a CIDR, etc.
})();
app.set('trust proxy', trustProxySetting);
if (trustProxySetting === false) {
  console.log('ℹ️  trust proxy disabled (TRUST_PROXY unset) — req.ip uses the raw socket address, X-Forwarded-For is ignored. Set TRUST_PROXY=1 if this deployment sits behind a real reverse proxy.');
}

// ── Security headers (Helmet) ─────────────────────────────────────────────────
// This is a pure JSON API — no HTML, no inline scripts, no iframes — so we can
// apply a strict posture without breaking anything.
app.use(helmet({
  // Content-Security-Policy: lock down to same-origin only.
  // API responses are JSON so there's nothing to load (no scripts, styles,
  // images, frames). This stops a misconfigured response from being rendered
  // as HTML and executing injected content.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],   // block everything by default
      frameAncestors: ["'none'"], // equivalent to X-Frame-Options: DENY
    },
  },

  // HTTP Strict Transport Security: tell browsers to only use HTTPS.
  // 1 year max-age is the recommended value. Remove includeSubDomains if
  // you have non-HTTPS subdomains you don't control.
  hsts: {
    maxAge: 31536000,       // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },

  // X-Content-Type-Options: nosniff — prevents browsers from MIME-sniffing
  // a response away from the declared Content-Type. Stops e.g. a JSON
  // response being treated as HTML/script.
  noSniff: true,

  // X-Frame-Options: DENY — belt-and-suspenders alongside CSP frameAncestors.
  // Protects older browsers that don't support CSP.
  xFrameOptions: { action: 'deny' },

  // Referrer-Policy: no-referrer — API requests should never leak the
  // Referer header to third-party services (e.g. Supabase, Cloudinary).
  referrerPolicy: { policy: 'no-referrer' },

  // X-DNS-Prefetch-Control: off — no benefit for an API, and disabling it
  // prevents the browser from pre-resolving hostnames found in responses.
  dnsPrefetchControl: { allow: false },

  // Permissions-Policy (formerly Feature-Policy): explicitly disable browser
  // features that an API server will never use.
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },

  // Cross-Origin-Opener-Policy: isolate this origin from other browsing
  // contexts opened from it.
  crossOriginOpenerPolicy: { policy: 'same-origin' },

  // Cross-Origin-Resource-Policy: only allow same-origin fetches.
  // Prevents other origins from embedding API responses.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));        // tightened from 50mb — files go via multipart
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Local file storage (replaces Cloudinary) ────────────────────────────────
// Prescription images (ordonnances) are NOT served as static files here.
// They contain sensitive medical data (medication names, dosages,
// prescribing physician), so serving STORAGE_ROOT unauthenticated via
// express.static would let anyone who obtains/guesses a /storage/... URL
// view a patient's prescription forever, with no way to revoke access.
//
// Instead, files are streamed through the authenticated, ownership-checked
// GET /api/demands/:id/ordonnance route in routes/demands.js, which reuses
// the same access-control logic as the rest of the demands API.

// PostHog: reads x-posthog-session-id and x-posthog-distinct-id headers from the frontend
setupExpressRequestContext(posthog, app);

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api', generalLimiter);                  // broad safety net on all API routes
app.use('/api/auth', authLimiter);                // tighter limit on auth (brute-force)
// uploadLimiter is applied per-route in demands.js (only on the POST endpoint)

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/services', require('./routes/services'));
app.use('/api/demands', require('./routes/demands'));
app.use('/api/nurse', require('./routes/nurse'));
// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// PostHog: capture Express errors to error tracking (register after routes)
setupExpressErrorHandler(posthog, app);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
const start = async () => {
  try {
    await initializeDatabase();
    await fs.mkdir(STORAGE_ROOT, { recursive: true });
    console.log(`✅ Storage directory ready: ${STORAGE_ROOT}`);
    // Bind to loopback only — Nginx (nginx-config/lab-app.conf) is the only
    // thing that should ever reach this process directly. Binding to all
    // interfaces (the default with no host argument) would make port 5000
    // reachable directly from any device on the LAN, bypassing Nginx
    // entirely — and since TRUST_PROXY=1 tells Express to trust one hop of
    // X-Forwarded-For, a client hitting this port directly (with no real
    // proxy in front sanitizing that header) could spoof it and bypass
    // every IP-keyed rate limiter. If this ever needs to be reachable from
    // another machine (e.g. Nginx running on a different host), that's a
    // deliberate choice — change HOST below, not this default.
    const HOST = process.env.HOST || '127.0.0.1';
    app.listen(PORT, HOST, () => {
      console.log(`🚀 Server running on ${HOST}:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
};

start();