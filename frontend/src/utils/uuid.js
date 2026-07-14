/**
 * Generates a v4-ish UUID for use as a client-side idempotency key.
 *
 * crypto.randomUUID() only exists in "secure contexts" (HTTPS, or
 * localhost) — browsers intentionally hide it on plain HTTP over a LAN
 * IP. That's the actual cause of demand submission silently never leaving
 * the browser: the ReferenceError/TypeError from calling a missing
 * function throws synchronously, before the fetch/axios call ever runs.
 *
 * This value is only ever used as a dedup key the backend checks against
 * a unique DB column (demands.idempotency_key) — it is NOT a security
 * token, so a fallback that isn't cryptographically random is a
 * completely safe trade-off here. The real, permanent fix is serving the
 * app over HTTPS (Cloudflare Tunnel handles that) — this fallback exists
 * so LAN/plain-HTTP testing works in the meantime, and it keeps working
 * unchanged once HTTPS is in place (the crypto.randomUUID() branch just
 * starts being the one that runs).
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    // RFC 4122 v4 via getRandomValues, which — unlike randomUUID — is
    // available in some environments even without a fully secure context.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last-resort fallback (Math.random()-based). Fine for a dedup key.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}