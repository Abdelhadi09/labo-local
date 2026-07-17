const { query } = require('../config/database');

const ORS_MATRIX_URL = 'https://api.openrouteservice.org/v2/matrix/driving-car';
const ORS_TIMEOUT_MS = 5000; // fail fast — a slow ORS response shouldn't hang a client's submission

/**
 * Great-circle distance in kilometers between two lat/lng points.
 * Used only as a fallback when ORS is unavailable — it ignores roads
 * entirely, but it's dependency-free and always available, so a request
 * never gets stuck on a third-party outage.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Picks the nearest branch by straight-line distance. Pure function over an
 * already-fetched branch list — no I/O — so it's trivial to unit test and
 * safe to call from the ORS failure path without any extra setup.
 */
function nearestByHaversine(lat, lng, branches) {
  let best = null;
  let bestDist = Infinity;
  for (const b of branches) {
    const d = haversineKm(lat, lng, b.lat, b.lng);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return { branch: best, distanceKm: bestDist };
}

/**
 * Asks ORS for driving distance from the client point to every candidate
 * branch in one matrix call, and returns the branch with the shortest route
 * distance. Throws on any failure (network error, timeout, non-2xx, or a
 * malformed response) — the caller is responsible for falling back.
 */
async function nearestByRoute(lat, lng, branches) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) throw new Error('ORS_API_KEY is not configured');

  // ORS expects [lng, lat] ordering, source first, then all destinations.
  const locations = [[lng, lat], ...branches.map(b => [b.lng, b.lat])];
  const destinations = branches.map((_, i) => i + 1); // skip index 0 (the source itself)

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORS_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ORS_MATRIX_URL, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locations,
        sources: [0],
        destinations,
        metrics: ['distance'],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`ORS matrix request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const distances = data?.distances?.[0]; // one row: distances from source 0 to each destination
  if (!Array.isArray(distances) || distances.length !== branches.length) {
    throw new Error('ORS matrix response shape was unexpected');
  }

  let bestIdx = -1;
  let bestDist = Infinity;
  distances.forEach((d, i) => {
    if (typeof d === 'number' && d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  });

  if (bestIdx === -1) throw new Error('ORS matrix returned no usable distances');

  return { branch: branches[bestIdx], distanceKm: bestDist / 1000 };
}

/**
 * Assigns the branch closest to (lat, lng) among active branches.
 *
 * Tries ORS route distance first; if that fails for any reason (missing
 * API key, network error, timeout, unexpected response), falls back to
 * straight-line distance so submission is never blocked by a third-party
 * outage. Returns which method actually decided the assignment so it can
 * be logged/stored — worth knowing how often the fallback fires.
 *
 * Returns null if there are no active branches at all (shouldn't happen
 * once branches are seeded, but the caller should handle it rather than
 * this function throwing on an empty candidate list).
 */
async function assignBranch(lat, lng) {
  const { rows: branches } = await query(
    `SELECT id, name, lat, lng FROM branches WHERE is_active = true`
  );
  if (branches.length === 0) return null;

  try {
    const { branch, distanceKm } = await nearestByRoute(lat, lng, branches);
    return { branchId: branch.id, branchName: branch.name, distanceKm, method: 'ors' };
  } catch (err) {
    console.error('ORS assignment failed, falling back to haversine:', err.message);
    const { branch, distanceKm } = nearestByHaversine(lat, lng, branches);
    return { branchId: branch.id, branchName: branch.name, distanceKm, method: 'haversine' };
  }
}

/**
 * Phase 1a: demands don't get real ORS-based assignment yet — every demand
 * goes to whichever branch is flagged is_default (see the migration for
 * why this is an explicit flag rather than "oldest branch by created_at":
 * seeding branches in one INSERT gives them all the same timestamp, since
 * now() is stable per-transaction, which made "oldest" non-deterministic
 * in practice, not just in theory — caught by testing against a real
 * seeded database, not just reasoning about it).
 *
 * Phase 1b swaps the call site that uses this for a call to assignBranch()
 * instead — this function itself can stay as-is or be removed then.
 *
 * Falls back to the oldest active branch if no branch is explicitly
 * flagged (e.g. someone cleared the flag) — better to route somewhere
 * deterministic than to 503 every demand submission over a misconfigured
 * flag. Returns null only if there are no active branches at all.
 */
async function getDefaultBranchId() {
  const { rows } = await query(
    `SELECT id FROM branches WHERE is_active = true AND is_default = true LIMIT 1`
  );
  if (rows[0]) return rows[0].id;

  const { rows: fallbackRows } = await query(
    `SELECT id FROM branches WHERE is_active = true ORDER BY created_at ASC, id ASC LIMIT 1`
  );
  return fallbackRows[0]?.id ?? null;
}

module.exports = { assignBranch, haversineKm, nearestByHaversine, nearestByRoute, getDefaultBranchId };