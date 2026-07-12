const sharp = require('sharp');

// Magic bytes (file signatures) for allowed image types.
// These are the actual first bytes of the binary file — impossible to spoof
// by just renaming or changing the Content-Type header.
const MAGIC = {
  // JPEG: FF D8 FF
  jpeg: { bytes: [0xff, 0xd8, 0xff], offset: 0 },
  // PNG:  89 50 4E 47 0D 0A 1A 0A
  png:  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 },
  // WEBP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50  ("RIFF....WEBP")
  webp: { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },        // check "RIFF"
  webp2:{ bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },        // check "WEBP"
  // TIFF: 49 49 2A 00 (little-endian) or 4D 4D 00 2A (big-endian)
  tiffLE: { bytes: [0x49, 0x49, 0x2a, 0x00], offset: 0 },
  tiffBE: { bytes: [0x4d, 0x4d, 0x00, 0x2a], offset: 0 },
};

// ── Pixel-count ceiling (Finding 5.4.1) ─────────────────────────────────────
// The 10MB multer limit (routes/demands.js) only bounds compressed,
// on-the-wire size — not decoded pixel dimensions. A crafted PNG/TIFF can
// use a high compression ratio to encode a huge canvas while staying well
// under 10MB on disk (a "decompression bomb" / pixel-flood pattern). That
// buffer then goes straight into Tesseract.recognize(), whose CPU/RAM cost
// scales with pixel count, not file size — so a small file can still cause
// disproportionate resource consumption in a synchronous, in-request OCR
// call.
//
// 30 megapixels is generous for a photographed prescription (a 108MP phone
// photo would be ~30MP after typical downscaling; most uploads will be a
// few MP) while still blocking multi-gigapixel decompression bombs.
const MAX_PIXELS = 30_000_000; // 30 megapixels

/**
 * Returns true if `buffer` starts with the given byte sequence at `offset`.
 */
function matchesSignature(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

/**
 * Validates the actual magic bytes of an uploaded file buffer.
 * Returns the detected type string, or null if unrecognised.
 */
function detectImageType(buffer) {
  if (matchesSignature(buffer, MAGIC.jpeg.bytes))   return 'jpeg';
  if (matchesSignature(buffer, MAGIC.png.bytes))    return 'png';
  if (matchesSignature(buffer, MAGIC.tiffLE.bytes)) return 'tiff';
  if (matchesSignature(buffer, MAGIC.tiffBE.bytes)) return 'tiff';
  // WEBP needs both "RIFF" at 0 and "WEBP" at 8
  if (
    matchesSignature(buffer, MAGIC.webp.bytes,  MAGIC.webp.offset) &&
    matchesSignature(buffer, MAGIC.webp2.bytes, MAGIC.webp2.offset)
  ) return 'webp';
  return null;
}

/**
 * Express middleware — must be used AFTER multer so req.file is populated.
 * Rejects the request if:
 *   - No file was uploaded (pass-through; let route handle required-file logic)
 *   - Magic bytes don't match any allowed image type
 *   - Declared MIME type doesn't match the detected type (mismatch attack)
 *   - Decoded pixel count exceeds MAX_PIXELS (decompression-bomb guard)
 *
 * The dimension check uses sharp's metadata-only read (`sharp(buf).metadata()`),
 * which reads just the image header — it does NOT decode full pixel data, so
 * it stays cheap even for a file crafted to be enormous once decoded. This
 * runs BEFORE the buffer is ever handed to uploadOrdonnance/Tesseract.
 */
async function validateImageFile(req, res, next) {
  if (!req.file) return next(); // no file → let the route handle it

  const detected = detectImageType(req.file.buffer);

  if (!detected) {
    return res.status(400).json({
      error: 'Fichier invalide. Seuls les formats JPEG, PNG, WEBP et TIFF sont acceptés.',
    });
  }

  // Cross-check with the declared MIME type
  const mimeMap = {
    jpeg: 'image/jpeg',
    png:  'image/png',
    webp: 'image/webp',
    tiff: 'image/tiff',
  };
  const expectedMime = mimeMap[detected];
  if (req.file.mimetype !== expectedMime) {
    return res.status(400).json({
      error: `Le type de fichier déclaré (${req.file.mimetype}) ne correspond pas au contenu réel (${expectedMime}).`,
    });
  }

  // Pixel-dimension check — metadata-only, does not fully decode the image.
  try {
    const { width, height } = await sharp(req.file.buffer).metadata();
    if (!width || !height) {
      return res.status(400).json({
        error: 'Impossible de lire les dimensions de l\u2019image.',
      });
    }
    if (width * height > MAX_PIXELS) {
      return res.status(400).json({
        error: `Image trop grande (${width}x${height}). Merci d\u2019envoyer une photo standard d\u2019ordonnance.`,
      });
    }
  } catch (err) {
    // Malformed/corrupt image data that passed the magic-byte check but
    // sharp can't parse — reject rather than pass a bad buffer downstream.
    return res.status(400).json({
      error: 'Fichier image corrompu ou illisible.',
    });
  }

  // Attach detected type so routes can use it without re-detecting
  req.file.detectedType = detected;
  next();
}

module.exports = { validateImageFile, detectImageType };