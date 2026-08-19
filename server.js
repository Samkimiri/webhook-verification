// =============================================================================
// server.js  —  Webhook Verification Mini-Prototype
// Project   : The Meridian Pivot  (Northstar Retail Co. simulation)
// Purpose   : Receive, verify, and respond to signed inventory webhooks.
//
// This file is the entire server.  It does one focused job:
//   1. Listen for POST /webhook/inventory
//   2. Check that the request carries a valid HMAC-SHA256 signature
//   3. Accept legitimate webhooks (HTTP 200) and reject forged ones (HTTP 401)
// =============================================================================

import 'dotenv/config';
import express from 'express';
import crypto  from 'crypto';

// ─── Environment ─────────────────────────────────────────────────────────────
// The secret is loaded from .env so it never appears in source code.
// If the variable is missing we fail loudly at startup — better to crash now
// than to silently accept every webhook without verification.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT           = process.env.PORT || 3000;

if (!WEBHOOK_SECRET) {
  console.error('❌  WEBHOOK_SECRET is not set.  Create a .env file from .env.example.');
  process.exit(1);
}

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();

// ─── Raw-body capture middleware ──────────────────────────────────────────────
//
// WHY THIS MATTERS — the most important middleware in the file:
//
// HMAC signatures are computed against a specific sequence of bytes.
// The webhook sender (simulator) signs the raw JSON string it sends.
// If we let Express parse the JSON first and then re-serialize it with
// JSON.stringify(req.body), we might get a different byte sequence because:
//   • key ordering is not guaranteed
//   • whitespace can differ
//   • Unicode escape sequences may change
//
// Even one different byte produces a completely different HMAC digest, so
// verification would fail for perfectly legitimate requests.
//
// Solution: use Express's built-in JSON parser WITH a "verify" callback.
// The verify callback fires BEFORE the body is parsed and receives the
// raw Buffer.  We store it on req.rawBody for use in the route handler.
//
// After this middleware runs:
//   req.rawBody  → the exact bytes that were transmitted (used for HMAC)
//   req.body     → the parsed JavaScript object       (used for business logic)
//
app.use(
  express.json({
    verify: (req, _res, buf) => {
      // buf is a Node.js Buffer containing the unmodified request body bytes.
      req.rawBody = buf;
    },
  })
);

// ─── Signature verification helper ───────────────────────────────────────────
//
// Receives:
//   receivedSignature  — the hex string from the X-Webhook-Signature header
//   rawBody            — the Buffer stored by the middleware above
//
// Returns:
//   true  if the signatures match
//   false otherwise
//
function verifySignature(receivedSignature, rawBody) {
  // Compute the HMAC-SHA256 digest we expect, using our secret and the
  // exact raw bytes of the request body.
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // ── Timing-safe comparison ──────────────────────────────────────────────
  //
  // WHY NOT use  receivedSignature === expectedSignature  ?
  //
  // JavaScript's === operator short-circuits: it stops comparing characters
  // as soon as it finds a mismatch.  This means a string that starts with
  // many correct characters takes slightly longer to fail than one that
  // mismatches on the first character.
  //
  // An attacker can measure thousands of requests and gradually guess the
  // valid signature one character at a time (a "timing attack").
  //
  // crypto.timingSafeEqual() always takes the same amount of time regardless
  // of where the mismatch occurs, eliminating that information leak.
  //
  // timingSafeEqual() requires both Buffers to be the same length.
  // We guard against length differences explicitly so the function does not
  // throw and crash the server.
  //
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (receivedBuffer.length !== expectedBuffer.length) {
    // Lengths differ — cannot be equal, and we must not call timingSafeEqual
    // with unequal-length buffers (it throws a RangeError).
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

// ─── Route: POST /webhook/inventory ──────────────────────────────────────────
app.post('/webhook/inventory', (req, res) => {
  console.log('\n─────────────────────────────────────────');
  console.log('📦  Incoming webhook request received');

  // ── Step 1: Check for the signature header ──────────────────────────────
  const receivedSignature = req.headers['x-webhook-signature'];

  if (!receivedSignature) {
    console.log('✗  X-Webhook-Signature header is missing');
    return res.status(401).json({
      success: false,
      message: 'Missing webhook signature',
    });
  }

  // ── Step 2: Ensure we have a raw body to verify against ─────────────────
  // This should always be present if the middleware is configured correctly,
  // but we guard it defensively.
  if (!req.rawBody) {
    console.log('✗  Raw body is unavailable — cannot verify signature');
    return res.status(400).json({
      success: false,
      message: 'Unable to read request body for verification',
    });
  }

  // ── Step 3: Verify the signature ────────────────────────────────────────
  const isValid = verifySignature(receivedSignature, req.rawBody);

  if (!isValid) {
    console.log('✗  Signature verification FAILED');
    console.log('   Received :', receivedSignature);
    // NOTE: We deliberately do NOT log the expected signature here.
    //       Logging it would expose the secret value in server logs.
    return res.status(401).json({
      success: false,
      message: 'Invalid webhook signature',
    });
  }

  // ── Step 4: Signature is valid — process the event ──────────────────────
  console.log('✓  Signature verified');
  console.log('✓  Inventory event accepted');
  console.log('   Event payload:');
  console.log('  ', JSON.stringify(req.body, null, 2).replace(/\n/g, '\n   '));

  return res.status(200).json({
    success: true,
    message: 'Webhook verified and accepted',
  });
});

// ─── Global error handler for malformed JSON ─────────────────────────────────
// If Express's JSON parser encounters invalid JSON it throws a SyntaxError.
// This error handler catches it and returns a clean 400 instead of crashing.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    console.log('✗  Malformed JSON received');
    return res.status(400).json({
      success: false,
      message: 'Malformed JSON body',
    });
  }
  // Unknown errors — log and respond with 500
  console.error('Unhandled error:', err.message);
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

// ─── Start listening ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Webhook server running on http://localhost:${PORT}`);
  console.log(`    Listening for POST /webhook/inventory`);
  console.log(`    WEBHOOK_SECRET loaded: ${'*'.repeat(WEBHOOK_SECRET.length)} (${WEBHOOK_SECRET.length} chars)\n`);
});
