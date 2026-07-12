const crypto = require('crypto');

const GOOGLE_AUTH_URL     = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Builds a signed, self-verifying "state" value: a nonce + timestamp, HMAC'd
 * with OAUTH_STATE_SECRET. This is CSRF protection for the OAuth redirect
 * without needing server-side session storage — we verify it stateless on
 * the way back, the same way the app already treats JWTs as self-contained.
 */
const createState = () => {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const ts = Date.now().toString();
  const payload = `${nonce}.${ts}`;
  const sig = crypto.createHmac('sha256', process.env.OAUTH_STATE_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};

/**
 * Verifies a state value returned by Google. Rejects bad signatures
 * (tamper/forgery) and stale values (replay past STATE_TTL_MS).
 */
const verifyState = (state) => {
  if (typeof state !== 'string') return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;

  const [nonce, ts, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', process.env.OAUTH_STATE_SECRET)
    .update(`${nonce}.${ts}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  const age = Date.now() - parseInt(ts, 10);
  return Number.isFinite(age) && age >= 0 && age <= STATE_TTL_MS;
};

/**
 * Builds the URL to redirect the user to for Google's consent screen.
 */
const buildAuthUrl = (state) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
};

/**
 * Exchanges an authorization code for a verified Google profile.
 *
 * We don't verify the id_token's JWT signature ourselves (no JWKS handling
 * needed) — instead we call Google's userinfo endpoint directly with the
 * access_token we just received over HTTPS from Google's own token
 * endpoint. That direct server-to-server call IS the verification: only
 * someone holding a genuine access_token minted by Google for this
 * authorization code can get a response back.
 *
 * Returns { sub, email, email_verified, name } or throws on any failure.
 */
const exchangeCodeForProfile = async (code) => {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code,
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '');
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${detail}`);
  }

  const { access_token: accessToken } = await tokenRes.json();
  if (!accessToken) throw new Error('Google token exchange returned no access_token');

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!profileRes.ok) {
    const detail = await profileRes.text().catch(() => '');
    throw new Error(`Google userinfo request failed (${profileRes.status}): ${detail}`);
  }

  const profile = await profileRes.json();
  if (!profile.sub || !profile.email) {
    throw new Error('Google userinfo response missing sub/email');
  }

  return {
    sub: profile.sub,
    email: profile.email,
    email_verified: !!profile.email_verified,
    name: profile.name || null,
  };
};

module.exports = { createState, verifyState, buildAuthUrl, exchangeCodeForProfile };