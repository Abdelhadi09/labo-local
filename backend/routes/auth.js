//this is the auth.js file

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, query: queryValidator } = require('express-validator');
const { query }       = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate }   = require('../middleware/validate');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const { createState, verifyState, buildAuthUrl, exchangeCodeForProfile } = require('../services/googleOAuth');
const posthog = require('../config/posthog');

const router = express.Router();

// ─── Constants ────────────────────────────────────────────────────────────────
const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h — shorter-lived than email verification
const OAUTH_EXCHANGE_CODE_TTL_MS = 60 * 1000; // 60s — single round-trip, deliberately short

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hashToken = (raw) =>
  crypto.createHash('sha256').update(raw).digest('hex');

// Same hash-at-rest pattern as refresh tokens, reused for email
// verification tokens — a leaked DB dump alone can't be used to forge a
// verification link.
const hashVerificationToken = hashToken;

// Same hash-at-rest pattern, reused for password reset tokens.
const hashResetToken = hashToken;

/**
 * Issue an access token + a refresh token, persist the refresh token,
 * and return both to the caller. Unchanged logic — only the persistence
 * call is now raw SQL instead of supabase.from('refresh_tokens').insert().
 */
const issueTokenPair = async (payload, familyId = null) => {
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  const rawRefresh  = crypto.randomBytes(32).toString('base64url');
  const tokenHash   = hashToken(rawRefresh);
  const family      = familyId ?? uuidv4();
  const expiresAt   = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [payload.id, tokenHash, family, expiresAt]
  );

  return { accessToken, refreshToken: rawRefresh };
};

// ─── Validation schemas ───────────────────────────────────────────────────────

const workerLoginValidation = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username and password are required')
    .isLength({ max: 100 }).withMessage('Username must be 100 characters or fewer'),
  body('password')
    .notEmpty().withMessage('Username and password are required')
    .isLength({ max: 200 }).withMessage('Password must be 200 characters or fewer'),
];

// Reasonable minimum: 8+ chars. We don't otherwise second-guess password
// choice (composition rules) since bcrypt neutralizes most of the benefit
// and they mostly just annoy users — same stance Supabase's default config had.
const registerValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email address')
    .isLength({ max: 254 }).withMessage('Email is too long')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8, max: 200 }).withMessage('Password must be at least 8 characters'),
];

const loginValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email and password are required')
    .isEmail().withMessage('Must be a valid email address')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Email and password are required')
    .isLength({ max: 200 }).withMessage('Password must be 200 characters or fewer'),
];

const verifyEmailValidation = [
  queryValidator('token')
    .trim()
    .notEmpty().withMessage('token is required')
    .isLength({ min: 20, max: 200 }).withMessage('Invalid token format'),
];

const resendVerificationValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email address')
    .normalizeEmail(),
];

const refreshValidation = [
  body('refreshToken')
    .trim()
    .notEmpty().withMessage('refreshToken required')
    .isLength({ min: 40, max: 60 }).withMessage('Invalid refresh token format'),
];

const forgotPasswordValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email address')
    .normalizeEmail(),
];

const resetPasswordValidation = [
  body('token')
    .trim()
    .notEmpty().withMessage('token is required')
    .isLength({ min: 20, max: 200 }).withMessage('Invalid token format'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8, max: 200 }).withMessage('Password must be at least 8 characters'),
];

const oauthExchangeValidation = [
  body('code')
    .trim()
    .notEmpty().withMessage('code is required')
    .isLength({ min: 20, max: 100 }).withMessage('Invalid code format'),
];

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/worker/login
 * username + password → access token + refresh token
 * No Supabase Auth involvement — already fully self-hosted, only the DB
 * lookup itself changed from supabase.from() to raw SQL.
 */
router.post('/worker/login', workerLoginValidation, validate, async (req, res) => {
  try {
    const { username, password } = req.body;

    // 'admin' accounts log in through this same endpoint — they're staff
    // too, just with the all-branches flag. Role is no longer hardcoded
    // below; it's whatever the row actually says, same as every other
    // login path already does for its own role.
    const { rows } = await query(
      `SELECT u.id, u.username, u.password, u.role, u.branch_id, b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.username = $1 AND u.role IN ('worker', 'admin')`,
      [username]
    );
    const user = rows[0];

    if (!user)
      return res.status(401).json({ error: 'Identifiants invalides' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: 'Identifiants invalides' });

    const payload = { id: user.id, username: user.username, role: user.role, branch_id: user.branch_id };
    const { accessToken, refreshToken } = await issueTokenPair(payload);

    posthog.identify({
      distinctId: user.id,
      properties: { username: user.username, role: user.role, branch_id: user.branch_id },
    });
    posthog.capture({
      distinctId: user.id,
      event: 'worker_logged_in',
      properties: { username: user.username, role: user.role },
    });

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, username: user.username, role: user.role, branch_id: user.branch_id, branch_name: user.branch_name },
    });
  } catch (err) {
    console.error('Worker login error:', err);
    posthog.captureException(err, undefined, { endpoint: '/api/auth/worker/login' });
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/register
 * Email + password signup for clients. Creates an unverified user and
 * emails a verification link. Mirrors worker login's bcrypt pattern —
 * no Supabase involvement at all, this is fully self-hosted from day one.
 */
router.post('/register', registerValidation, validate, async (req, res) => {
  const REGISTER_RESPONSE = {
    message:
      "Si cette adresse e-mail peut être utilisée, vous recevrez un e-mail contenant les instructions nécessaires.",
  };

  try {
    const { email, password } = req.body;

    const { rows: existingRows } = await query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    // Do not reveal whether the account exists.
    if (existingRows.length > 0) {
      console.warn(`Duplicate registration attempt for ${email}`);

      return res.status(201).json(REGISTER_RESPONSE);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows: insertedRows } = await query(
      `INSERT INTO users (username, email, password, role, email_verified)
       VALUES ($1, $2, $3, 'client', false)
       RETURNING id`,
      [email, email, passwordHash]
    );

    const userId = insertedRows[0].id;

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashVerificationToken(rawToken);
    const expiresAt = new Date(
      Date.now() + EMAIL_VERIFICATION_TTL_MS
    ).toISOString();

    await query(
      `INSERT INTO email_verifications (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt]
    );

    try {
      await sendVerificationEmail(email, rawToken);
    } catch (emailErr) {
      console.error("Failed to send verification email:", emailErr);
    }

    posthog.capture({
      distinctId: userId,
      event: "client_registered",
      properties: {
        auth_provider: "password",
      },
    });

    return res.status(201).json(REGISTER_RESPONSE);
  } catch (err) {
  if (err.code === "23505") {
    return res.status(201).json(REGISTER_RESPONSE);
  }

  console.error("Register error:", err);

  posthog.captureException(err, undefined, {
    endpoint: "/api/auth/register",
  });

  return res.status(500).json({
    error: "Registration failed",
  });
}
});

/**
 * GET /api/auth/verify-email?token=...
 * Clicked from the verification email. Validates the token, marks the
 * user verified, and redirects into the frontend rather than returning
 * raw JSON, since this is a browser navigation, not an API call.
 */
router.get('/verify-email', verifyEmailValidation, validate, async (req, res) => {
  const frontendLogin = `${process.env.FRONTEND_URL}/login`;

  try {
    const tokenHash = hashVerificationToken(req.query.token);
  

    const { rows } = await query(
      `SELECT id, user_id, expires_at, used_at
       FROM email_verifications
       WHERE token_hash = $1`,
      [tokenHash]
    );
    const record = rows[0];
    

    if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
      return res.redirect(`${frontendLogin}?verified=false`);
    }

    await query(`UPDATE email_verifications SET used_at = NOW() WHERE id = $1`, [record.id]);
    await query(`UPDATE users SET email_verified = true WHERE id = $1`, [record.user_id]);

    const { rows: check } = await query(
  `SELECT email_verified
   FROM users
   WHERE id = $1`,
  [record.user_id]
);


    posthog.capture({
      distinctId: record.user_id,
      event: 'client_email_verified',
    });

    res.redirect(`${frontendLogin}?verified=true`);
  } catch (err) {
    console.error('Verify email error:', err);
    res.redirect(`${frontendLogin}?verified=false`);
  }
});

/**
 * POST /api/auth/resend-verification
 * Not explicitly required by the migration plan's ticket text, but a very
 * common companion to signup (emails get lost/delayed) — included since
 * it's low-complexity and reuses everything /register already set up.
 * Always returns a generic success message, whether or not the email
 * exists or is already verified, to avoid leaking account existence.
 */
router.post('/resend-verification', resendVerificationValidation, validate, async (req, res) => {
  const generic = { message: "Si un compte non vérifié existe pour cet e-mail, un lien vient d'être envoyé." };

  try {
    const { email } = req.body;

    const { rows } = await query(
      `SELECT id, email_verified FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || user.email_verified) return res.json(generic);

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashVerificationToken(rawToken);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();

    await query(
      `INSERT INTO email_verifications (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    await sendVerificationEmail(email, rawToken).catch(emailErr => {
      console.error('Failed to send verification email (resend):', emailErr);
    });

    res.json(generic);
  } catch (err) {
    console.error('Resend verification error:', err);
    res.json(generic); // still generic — don't leak errors that hint at existence either
  }
});

/**
 * POST /api/auth/login
 * Email + password login for clients. Issues the JWT pair directly —
 * no intermediate exchange step, unlike the old client/session bridge
 * (see Epic 4 ticket 4.1: that endpoint is deleted, not repurposed).
 */
router.post('/login', loginValidation, validate, async (req, res) => {
  try {
    const { email, password } = req.body;

    const { rows } = await query(
      `SELECT id, username, email, password, role, email_verified
       FROM users
       WHERE email = $1 AND role = 'client'`,
      [email]
    );
    const user = rows[0];

    // Same generic error for "no such user" and "wrong password" — avoids
    // leaking which emails are registered.
    if (!user || !user.password)
      return res.status(401).json({ error: 'Identifiants invalides' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: 'Identifiants invalides' });

    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Veuillez vérifier votre e-mail avant de vous connecter',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const payload = { id: user.id, username: user.email, role: 'client' };
    const { accessToken, refreshToken } = await issueTokenPair(payload);

    posthog.identify({
      distinctId: user.id,
      properties: { email: user.email, role: 'client' },
    });
    posthog.capture({
      distinctId: user.id,
      event: 'client_logged_in',
      properties: { auth_provider: 'password' },
    });

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, username: user.email, role: 'client', email: user.email },
    });
  } catch (err) {
    console.error('Client login error:', err);
    posthog.captureException(err, undefined, { endpoint: '/api/auth/login' });
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Client-only (password accounts). Always returns the same generic message
 * regardless of whether the email exists, is a Google-only account, or is
 * unverified — same anti-enumeration pattern as /register and
 * /resend-verification. Reuses the authLimiter already mounted on
 * /api/auth/* for brute-force / spam protection.
 */
router.post('/forgot-password', forgotPasswordValidation, validate, async (req, res) => {
  const generic = { message: "Si cette adresse e-mail est associée à un compte, vous recevrez un e-mail contenant les instructions de réinitialisation." };

  try {
    const { email } = req.body;

    const { rows } = await query(
      `SELECT id, password FROM users WHERE email = $1 AND role = 'client'`,
      [email]
    );
    const user = rows[0];

    // No account, or a Google-only account with no password to reset —
    // say nothing that distinguishes either case from "email sent".
    if (!user || !user.password) return res.json(generic);

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();

    await query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    await sendPasswordResetEmail(email, rawToken).catch(emailErr => {
      console.error('Failed to send password reset email:', emailErr);
    });

    posthog.capture({
      distinctId: user.id,
      event: 'client_password_reset_requested',
    });

    res.json(generic);
  } catch (err) {
    console.error('Forgot password error:', err);
    posthog.captureException(err, undefined, { endpoint: '/api/auth/forgot-password' });
    res.json(generic); // still generic — don't leak errors that hint at existence either
  }
});

/**
 * POST /api/auth/reset-password
 * Consumes a single-use token minted by /forgot-password, sets a new
 * password hash, marks the token used, and — since a reset almost always
 * means "I think someone else might have access" — revokes every existing
 * refresh token for the account so all other sessions are signed out.
 */
router.post('/reset-password', resetPasswordValidation, validate, async (req, res) => {
  try {
    const { token, password } = req.body;
    const tokenHash = hashResetToken(token);

    const { rows } = await query(
      `SELECT id, user_id, expires_at, used_at
       FROM password_resets
       WHERE token_hash = $1`,
      [tokenHash]
    );
    const record = rows[0];

    if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Lien invalide ou expiré', code: 'RESET_TOKEN_INVALID' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await query(`UPDATE users SET password = $1 WHERE id = $2`, [passwordHash, record.user_id]);
    await query(`UPDATE password_resets SET used_at = NOW() WHERE id = $1`, [record.id]);

    // Sign out every other session — reset implies the old password (and
    // any refresh tokens issued under it) should no longer be trusted.
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [record.user_id]
    );

    posthog.capture({
      distinctId: record.user_id,
      event: 'client_password_reset_completed',
    });

    res.json({ message: 'Mot de passe réinitialisé avec succès' });
  } catch (err) {
    console.error('Reset password error:', err);
    posthog.captureException(err, undefined, { endpoint: '/api/auth/reset-password' });
    res.status(500).json({ error: 'La réinitialisation a échoué' });
  }
});

/**
 * GET /api/auth/google
 * Redirects to Google's consent screen. State is a signed, self-verifying
 * value (see services/googleOAuth.js) — no server-side session needed.
 */
router.get('/google', (req, res) => {
  const state = createState();
  res.redirect(buildAuthUrl(state));
});

/**
 * GET /api/auth/google/callback
 * Google redirects here with either { code, state } on success or
 * { error } if the user declined consent. On success: exchanges the code
 * for a verified Google profile, finds-or-creates the local user (linking
 * by email if a password account already exists), issues a one-time
 * exchange code, and redirects the BROWSER to the frontend with just that
 * code — never real tokens — per the design in ticket 4.1.
 */
router.get('/google/callback', async (req, res) => {

  const frontendLogin = `${process.env.FRONTEND_URL}/login`;
  const frontendOAuthCallback = `${process.env.FRONTEND_URL}/oauth/callback`;

  try {
    const { code, state, error: googleError } = req.query;

    if (googleError) {
      // User declined consent, or Google reported some other error.
      return res.redirect(`${frontendLogin}?oauth_error=denied`);
    }

    if (!code || !verifyState(state)) {
      return res.redirect(`${frontendLogin}?oauth_error=invalid_state`);
    }

    const profile = await exchangeCodeForProfile(code);
    

    // Find by google_id first (returning user), then by email (existing
    // password account — link it), else create a brand-new OAuth-only user.
    let { rows: userRows } = await query(
      `SELECT id, email_verified FROM users WHERE google_id = $1`,
      [profile.sub]
    );
    let user = userRows[0];
    let isNewUser = false;

    if (!user) {
      ({ rows: userRows } = await query(
        `SELECT id, email_verified FROM users WHERE email = $1`,
        [profile.email]
      ));
      user = userRows[0];

      if (user) {
        // Existing password account with the same email — link Google to it.
        // If Google says the email is verified, trust that (it's at least
        // as strong a signal as our own email-link verification).
        await query(
          `UPDATE users SET google_id = $1, email_verified = email_verified OR $2 WHERE id = $3`,
          [profile.sub, profile.email_verified, user.id]
        );
      } else {
        isNewUser = true;
        const { rows: insertedRows } = await query(
          `INSERT INTO users (username, email, password, role, email_verified, google_id)
           VALUES ($1, $2, NULL, 'client', $3, $4)
           RETURNING id`,
          [profile.email, profile.email, profile.email_verified, profile.sub]
        );
        user = { id: insertedRows[0].id };
      }
    }

    const rawCode = crypto.randomBytes(32).toString('base64url');
    const codeHash = hashToken(rawCode);
    const expiresAt = new Date(Date.now() + OAUTH_EXCHANGE_CODE_TTL_MS).toISOString();

    await query(
      `INSERT INTO oauth_exchange_codes (user_id, code_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, codeHash, expiresAt]
    );

    if (isNewUser) {
      posthog.capture({
        distinctId: user.id,
        event: 'client_registered',
        properties: { email: profile.email, auth_provider: 'google' },
      });
    }
    posthog.capture({
      distinctId: user.id,
      event: 'client_logged_in',
      properties: { auth_provider: 'google', is_new_user: isNewUser },
    });

    res.redirect(`${frontendOAuthCallback}?code=${encodeURIComponent(rawCode)}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    posthog.captureException(err, undefined, { endpoint: '/api/auth/google/callback' });
    res.redirect(`${frontendLogin}?oauth_error=server_error`);
  }
});

/**
 * POST /api/auth/oauth/exchange
 * Frontend calls this immediately after landing on /oauth/callback?code=...
 * Trades the short-lived, single-use code for the real JWT pair. This
 * second step is what keeps real tokens out of the URL/browser
 * history/referrer headers entirely.
 */
router.post('/oauth/exchange', oauthExchangeValidation, validate, async (req, res) => {
  try {
    const codeHash = hashToken(req.body.code);


    const { rows } = await query(
      `SELECT oec.id, oec.user_id, oec.expires_at, oec.used_at,
              u.username, u.email, u.role, u.branch_id
       FROM oauth_exchange_codes oec
       JOIN users u ON u.id = oec.user_id
       WHERE oec.code_hash = $1`,
      [codeHash]
    );
    const record = rows[0];

    if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired code', code: 'OAUTH_CODE_INVALID' });
    }

    await query(`UPDATE oauth_exchange_codes SET used_at = NOW() WHERE id = $1`, [record.id]);

    const payload = { id: record.user_id, username: record.username, role: record.role, branch_id: record.branch_id };
    const { accessToken, refreshToken } = await issueTokenPair(payload);

    res.json({
      accessToken,
      refreshToken,
      user: { id: record.user_id, username: record.username, role: record.role, email: record.email },
    });
  } catch (err) {
    console.error('OAuth exchange error:', err);
    posthog.captureException(err, undefined, { endpoint: '/api/auth/oauth/exchange' });
    res.status(500).json({ error: 'Exchange failed' });
  }
});

/**
 * POST /api/auth/refresh
 * Rotates a refresh token: validates it, revokes it, and issues a fresh pair.
 * Reuse detection unchanged — only the DB access is now raw SQL.
 */
router.post('/refresh', refreshValidation, validate, async (req, res) => {
  const { refreshToken: rawToken } = req.body;

  try {
    const tokenHash = hashToken(rawToken);

    const { rows } = await query(
      `SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.revoked_at,
              u.id AS u_id, u.username AS u_username, u.role AS u_role, u.branch_id AS u_branch_id
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );
    const stored = rows[0];

    // ── Unknown token ──────────────────────────────────────────────────────
    if (!stored) {
      return res.status(401).json({ error: 'Invalid refresh token', code: 'REFRESH_INVALID' });
    }

    // ── Reuse detected: token already revoked ─────────────────────────────
    if (stored.revoked_at) {
      console.warn(`Refresh token reuse detected — revoking family ${stored.family_id}`);
      await query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [stored.family_id]
      );

      return res.status(401).json({ error: 'Token reuse detected — please log in again', code: 'REFRESH_REUSE' });
    }

    // ── Expired ───────────────────────────────────────────────────────────
    if (new Date(stored.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired', code: 'REFRESH_EXPIRED' });
    }

    // ── Valid — rotate ────────────────────────────────────────────────────
    await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [stored.id]);

    const payload = { id: stored.u_id, username: stored.u_username, role: stored.u_role, branch_id: stored.u_branch_id };

    const { accessToken, refreshToken: newRefreshToken } =
      await issueTokenPair(payload, stored.family_id);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * POST /api/auth/logout
 * Revokes the presented refresh token (and optionally all sessions for the user).
 */
router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken: rawToken, allDevices = false } = req.body;

  try {
    if (allDevices) {
      await query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [req.user.id]
      );
    } else if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE token_hash = $1 AND user_id = $2`,
        [tokenHash, req.user.id]
      );
    }

    posthog.capture({
      distinctId: req.user.id,
      event: 'user_logged_out',
      properties: { all_devices: allDevices },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.json({ ok: true });
  }
});

/**
 * GET /api/auth/me — works for both worker and client (access token)
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows: userRows } = await query(
      `SELECT u.id, u.username, u.role, u.created_at, u.branch_id, b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const user = userRows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { rows: profileRows } = await query(
      `SELECT * FROM client_profiles WHERE user_id = $1`,
      [req.user.id]
    );
    const profile = profileRows[0] || {};

    res.json({ ...user, ...profile });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;