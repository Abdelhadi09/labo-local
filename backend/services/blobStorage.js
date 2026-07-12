const fs   = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { withTimeout } = require('../utils/withTimeout');

// Root of the storage tree, e.g. /var/lab-app/storage or ./storage in dev.
// Everything is written under here as:
//   <STORAGE_ROOT>/ordonnances/<YYYY>/<MM>/<uuid>.<ext>
// Date-partitioning by year/month costs nothing today and avoids ever
// having tens/hundreds of thousands of files in one flat directory as the
// app grows — some filesystems and backup tools slow down noticeably once
// a single folder passes a few tens of thousands of entries.
const STORAGE_ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(__dirname, '..', 'storage');

// The URL prefix this storage is served under (see server.js static mount
// added in this same ticket) — kept separate from STORAGE_ROOT so the disk
// layout and the public URL layout can diverge later if needed.
const PUBLIC_PREFIX = '/storage';

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/tiff': 'tiff',
};

const datePathParts = (date = new Date()) => [
  String(date.getUTCFullYear()),
  String(date.getUTCMonth() + 1).padStart(2, '0'),
];

/**
 * Given a public URL/path previously returned by uploadOrdonnance (e.g.
 * "/storage/ordonnances/2026/07/<uuid>.jpg"), resolve it to an absolute
 * filesystem path. Rejects anything that isn't a normal internal storage
 * path — including anything containing "..", so a value that ever ends up
 * user-influenced can't be used to escape STORAGE_ROOT.
 */
const resolveStoredPath = (publicPath) => {
  if (!publicPath || !publicPath.startsWith(`${PUBLIC_PREFIX}/`)) {
    throw new Error(`Not a recognized storage path: ${publicPath}`);
  }
  const relative = publicPath.slice(PUBLIC_PREFIX.length + 1); // strip "/storage/"
  if (relative.includes('..')) {
    throw new Error(`Refusing suspicious storage path: ${publicPath}`);
  }
  return path.join(STORAGE_ROOT, relative);
};

/**
 * Write a file buffer to local disk under ordonnances/<year>/<month>/,
 * with a collision-safe random filename. Returns a public URL path
 * (relative, e.g. "/storage/ordonnances/2026/07/<uuid>.jpg") that gets
 * stored in demands.ordonnance_url — same role Cloudinary's secure_url
 * played before.
 *
 * Kept the same signature and the same 30s timeout wrapper as the
 * Cloudinary version (disk writes are near-instant, but the safety net
 * costs nothing and keeps demands.js unchanged in this regard).
 */
const uploadOrdonnance = (fileBuffer, originalName, mimeType) => {
  const write = (async () => {
    const ext = EXTENSION_BY_MIME[mimeType];
    if (!ext) throw new Error(`Unsupported mime type for storage: ${mimeType}`);

    const [year, month] = datePathParts();
    const filename = `${crypto.randomUUID()}.${ext}`;
    const relativeDir = path.join('ordonnances', year, month);
    const absoluteDir = path.join(STORAGE_ROOT, relativeDir);

    await fs.mkdir(absoluteDir, { recursive: true });
    await fs.writeFile(path.join(absoluteDir, filename), fileBuffer);

    // Always forward slashes in the public path, regardless of host OS.
    return `${PUBLIC_PREFIX}/${[relativeDir, filename].join('/').split(path.sep).join('/')}`;
  })();

  return withTimeout(write, 30_000, 'Local file write');
};

/**
 * Delete a previously stored file given its public URL path. Fire-and-forget
 * semantics preserved from the Cloudinary version: errors are logged, never
 * thrown, since this is only ever called as best-effort cleanup.
 */
const deleteOrdonnance = async (publicPath) => {
  try {
    const absolutePath = resolveStoredPath(publicPath);
    await fs.unlink(absolutePath);
  } catch (err) {
    // ENOENT (already gone) is fine to ignore quietly; anything else, log it.
    if (err.code !== 'ENOENT') {
      console.error('Local file delete error:', err);
    }
  }
};

// Reverse of EXTENSION_BY_MIME, used to set an accurate Content-Type when
// streaming a file back out (extension on disk is the only signal we have —
// we don't re-sniff file bytes on every read).
const MIME_BY_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mime, ext]) => [ext, mime])
);

const mimeForStoredPath = (publicPath) => {
  const ext = path.extname(publicPath).slice(1).toLowerCase();
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
};

module.exports = {
  uploadOrdonnance,
  deleteOrdonnance,
  resolveStoredPath,
  mimeForStoredPath,
  STORAGE_ROOT,
  PUBLIC_PREFIX,
};