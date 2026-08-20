// =============================================================================
// server.js  —  Webhook Verification Mini-Prototype
// Project   : The Meridian Pivot  (Northstar Retail Co. simulation)
// Purpose   : Receive, verify, and respond to signed inventory webhooks.
//             Also serves the browser dashboard from public/.
//
// Routes:
//   GET  /                     → Browser dashboard (public/index.html)
//   GET  /api/status           → Server health check { status: 'ok' }
//   GET  /api/events           → Server-Sent Events (live webhook feed)
//   POST /api/trigger          → Sign & fire a test webhook from the browser
//   POST /webhook/inventory    → Main webhook endpoint (HMAC verification)
// =============================================================================

import 'dotenv/config';
import express from 'express';
import crypto  from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';

// ─── Environment ─────────────────────────────────────────────────────────────
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT           = process.env.PORT || 3000;

if (!WEBHOOK_SECRET) {
  console.error('❌  WEBHOOK_SECRET is not set.  Create a .env file from .env.example.');
  process.exit(1);
}

// ─── In-memory event log & SSE clients ───────────────────────────────────────
// Keeps the last 100 webhook results so the dashboard shows history on load.
const eventLog   = [];
const sseClients = new Set();

function broadcastEvent(entry) {
  const msg = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch (_) { sseClients.delete(client); }
  }
}

function recordEvent(entry) {
  eventLog.unshift(entry);
  if (eventLog.length > 100) eventLog.pop();
  broadcastEvent(entry);
}

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();

// Serve the public/ directory as static files (dashboard HTML/CSS/JS)
const __dir = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dir, 'public')));

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

// ─── Route: GET /api/status — health check ───────────────────────────────────
// The dashboard polls this to show the SERVER ONLINE / SERVER OFFLINE badge.
app.get('/api/status', (_req, res) => {
  res.json({ status: 'ok', service: 'webhook-guard', timestamp: new Date().toISOString() });
});

// ─── Route: GET /api/events — Server-Sent Events stream ──────────────────────
// The browser connects once and the server pushes new webhook events in real
// time without the page needing to poll. SSE is a plain HTTP response that
// never closes; the server writes "data: ...\n\n" lines as events occur.
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Immediately send the existing event history so the page loads with data.
  res.write(`data: ${JSON.stringify({ type: 'snapshot', events: eventLog })}\n\n`);

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ─── Route: POST /api/trigger — sign & fire a webhook from the browser ────────
//
// The frontend MUST NOT have access to WEBHOOK_SECRET.
// This endpoint receives the payload fields from the dashboard form, builds the
// webhook body server-side, signs it (or deliberately mis-signs it), and POSTs
// it to /webhook/inventory — all without the secret ever leaving the server.
//
// Body parameters:
//   scenario     'valid' | 'invalid' | 'missing' — which test to run
//   product_id   string  (optional, defaults to 'SKU-001')
//   product_name string  (optional, defaults to 'Laptop')
//   quantity     number  (optional, defaults to 25)
//   event        string  (optional, defaults to 'inventory.updated')
//
app.post('/api/trigger', async (req, res) => {
  const {
    scenario     = 'valid',
    product_id   = 'SKU-001',
    product_name = 'Laptop',
    quantity     = 25,
    event        = 'inventory.updated',
  } = req.body || {};

  const payload = { event, product_id, product_name, quantity: Number(quantity) };
  const payloadStr = JSON.stringify(payload);

  let sig, bodyToSend = payloadStr, label;

  switch (scenario) {
    case 'invalid':
      // Sign with a deliberately wrong secret — secret never leaves the server
      sig   = crypto.createHmac('sha256', 'wrong-secret').update(payloadStr).digest('hex');
      label = 'Wrong secret — expect 401';
      break;
    case 'missing':
      sig   = null;
      label = 'No signature header — expect 401';
      break;
    default: // 'valid'
      sig   = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadStr).digest('hex');
      label = 'Correct signature — expect 200';
  }

  const headers = { 'Content-Type': 'application/json' };
  if (sig !== null) headers['X-Webhook-Signature'] = sig;

  const proto  = req.headers['x-forwarded-proto'] || 'http';
  const host   = req.headers.host || `localhost:${PORT}`;
  const target = `${proto}://${host}/webhook/inventory`;

  try {
    const r    = await fetch(target, { method: 'POST', headers, body: bodyToSend });
    const json = await r.json();
    res.json({
      ok:       true,
      scenario,
      label,
      status:   r.status,
      payload,
      response: json,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Route: POST /webhook/inventory ──────────────────────────────────────────
app.post('/webhook/inventory', (req, res) => {
  console.log('\n─────────────────────────────────────────');
  console.log('📦  Incoming webhook request received');

  // ── Step 1: Check for the signature header ──────────────────────────────
  const receivedSignature = req.headers['x-webhook-signature'];

  if (!receivedSignature) {
    console.log('✗  X-Webhook-Signature header is missing');
    recordEvent({ ts: new Date().toISOString(), result: 'rejected', reason: 'Missing signature header', status: 401, body: req.body });
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
    recordEvent({ ts: new Date().toISOString(), result: 'error', reason: 'Raw body unavailable', status: 400, body: req.body });
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
    recordEvent({ ts: new Date().toISOString(), result: 'rejected', reason: 'Signature mismatch', status: 401, body: req.body });
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

  recordEvent({ ts: new Date().toISOString(), result: 'accepted', reason: 'Signature valid', status: 200, body: req.body });
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
  console.log(`    Dashboard → http://localhost:${PORT}/`);
  console.log(`    Endpoint  → POST http://localhost:${PORT}/webhook/inventory`);
  console.log(`    WEBHOOK_SECRET loaded: ${'*'.repeat(WEBHOOK_SECRET.length)} (${WEBHOOK_SECRET.length} chars)\n`);
});
