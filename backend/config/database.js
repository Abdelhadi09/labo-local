const { Pool } = require('pg');

let pool = null;

/**
 * Returns the shared pg Pool instance. Lazily created on first call.
 *
 * Replaces the old Supabase client singleton. Kept the same function name
 * (getPool) so every route file's import line (`const { getPool } = require(...)`)
 * stays valid — only what's returned, and how it's used, changes.
 */
const getPool = () => {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL must be set');

    pool = new Pool({
      connectionString,
      // Mirrors the old Supabase client's 10s per-request timeout as closely
      // as pg allows: statement_timeout aborts any single query that runs
      // longer than this, server-side.
      statement_timeout: 10_000,
      connectionTimeoutMillis: 10_000,
      max: 10, // sensible default for a single-instance app; tune later
    });

    pool.on('error', (err) => {
      // Errors on idle clients in the pool — log, don't crash the process.
      console.error('Unexpected PG pool error:', err);
    });

    console.log('✅ PostgreSQL pool initialized');
  }
  return pool;
};

/**
 * Run a query against the pool. Thin wrapper kept mainly so call sites read
 * like `const { rows } = await query('SELECT ...', [params])` instead of
 * reaching into getPool() everywhere.
 */
const query = (text, params) => getPool().query(text, params);

/**
 * Run a callback inside a transaction. Checks out a dedicated client,
 * BEGINs, runs the callback (which receives that client and must use it
 * for every query so they all share the transaction), COMMITs on success,
 * ROLLBACKs on any thrown error, and always releases the client back to
 * the pool.
 *
 * Not strictly required for create_demand_with_items/process_demand_with_items
 * since those are called as single Postgres function invocations (the
 * function body is already atomic on its own) — but it's here for any
 * future multi-statement operation that needs the same guarantee.
 */
const withTransaction = async (callback) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const initializeDatabase = async () => {
  // Actually verify connectivity now, instead of just logging (the old
  // Supabase version couldn't do this — there was nothing to "connect" to
  // ahead of time since every call was a standalone HTTPS request).
  await query('SELECT 1');
  console.log('✅ Database ready (PostgreSQL)');
};

module.exports = { getPool, query, withTransaction, initializeDatabase };