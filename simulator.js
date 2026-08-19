// =============================================================================
// simulator.js  —  Fake Warehouse System / Webhook Simulator
// Project   : The Meridian Pivot  (Northstar Retail Co. simulation)
// Purpose   : Simulate a warehouse system sending signed inventory webhooks.
//
// This file acts as the OTHER side of the webhook pipeline.
// It creates a payload, signs it with the shared secret, and POSTs it to
// the running server — exactly as a real warehouse system would.
//
// Two test modes are supported:
//   node simulator.js          → runs all four tests automatically
//   node simulator.js valid    → sends a single valid webhook
//   node simulator.js invalid  → sends a single forged webhook
// =============================================================================

import crypto from 'crypto';
import 'dotenv/config';

// ─── Configuration ────────────────────────────────────────────────────────────
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET;
const SERVER_URL      = `http://localhost:${process.env.PORT || 3000}/webhook/inventory`;

if (!WEBHOOK_SECRET) {
  console.error('❌  WEBHOOK_SECRET is not set.  Create a .env file from .env.example.');
  process.exit(1);
}

// ─── Shared inventory payload ─────────────────────────────────────────────────
// This represents a real inventory update event from the warehouse system.
const inventoryPayload = {
  event:        'inventory.updated',
  product_id:   'SKU-001',
  product_name: 'Laptop',
  quantity:     25,
};

// ─── Helper: sign a payload string ───────────────────────────────────────────
//
// The sender must sign the EXACT same byte sequence that will be transmitted
// in the HTTP request body.  We call JSON.stringify once and reuse that string
// so that the bytes in transit match the bytes we signed.
//
function signPayload(secret, payloadString) {
  return crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
}

// ─── Helper: send one webhook request ────────────────────────────────────────
async function sendWebhook({ label, payloadString, signature }) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`🧪  Test: ${label}`);
  console.log(`    URL    : ${SERVER_URL}`);
  console.log(`    Body   : ${payloadString}`);
  console.log(`    Sig    : ${signature}`);

  let response;
  let responseBody;

  try {
    response = await fetch(SERVER_URL, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-Webhook-Signature': signature,
      },
      body: payloadString,
    });

    responseBody = await response.json();
  } catch (err) {
    console.error(`    ❌  Network or parse error: ${err.message}`);
    console.error(`    Is the server running?  (npm start)`);
    return;
  }

  const statusIcon = response.status === 200 ? '✅' : '❌';
  console.log(`\n    ${statusIcon}  HTTP ${response.status}`);
  console.log(`    Response: ${JSON.stringify(responseBody)}`);
}

// ─── Test definitions ─────────────────────────────────────────────────────────

// The exact string that will travel over the wire.
// Both tests use the same payload but one uses a wrong secret to sign it.
const validPayloadString = JSON.stringify(inventoryPayload);

// ── Test 1: Valid signature ────────────────────────────────────────────────
// Signs the payload with the CORRECT shared secret.
// Expected: HTTP 200 — server accepts the event.
async function testValid() {
  const signature = signPayload(WEBHOOK_SECRET, validPayloadString);
  await sendWebhook({
    label:         'Valid signature  →  expect HTTP 200',
    payloadString: validPayloadString,
    signature,
  });
}

// ── Test 2: Invalid signature (wrong secret) ───────────────────────────────
// Signs the payload with an INCORRECT secret.
// Expected: HTTP 401 — server rejects the event.
async function testInvalidSignature() {
  const wrongSecret = 'this-is-definitely-the-wrong-secret';
  const badSignature = signPayload(wrongSecret, validPayloadString);
  await sendWebhook({
    label:         'Invalid signature (wrong secret)  →  expect HTTP 401',
    payloadString: validPayloadString,
    signature:     badSignature,
  });
}

// ── Test 3: Missing signature header ──────────────────────────────────────
// Sends the payload with NO X-Webhook-Signature header at all.
// Expected: HTTP 401 — server rejects because the header is absent.
async function testMissingSignature() {
  console.log(`\n${'─'.repeat(50)}`);
  console.log('🧪  Test: Missing X-Webhook-Signature header  →  expect HTTP 401');

  let response;
  let responseBody;

  try {
    response = await fetch(SERVER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // Intentionally NO X-Webhook-Signature header
      body: validPayloadString,
    });
    responseBody = await response.json();
  } catch (err) {
    console.error(`    ❌  Network error: ${err.message}`);
    return;
  }

  const statusIcon = response.status === 200 ? '✅' : '❌';
  console.log(`\n    ${statusIcon}  HTTP ${response.status}`);
  console.log(`    Response: ${JSON.stringify(responseBody)}`);
}

// ── Test 4: Modified body (tampered payload) ───────────────────────────────
// Signs the ORIGINAL payload, then transmits a DIFFERENT payload.
// The signature was generated for quantity:25 but the body now says quantity:999.
// Expected: HTTP 401 — the received body no longer matches what was signed.
async function testTamperedBody() {
  // Signature is computed against the original (legitimate) payload
  const originalSignature = signPayload(WEBHOOK_SECRET, validPayloadString);

  // Attacker modifies the body before sending
  const tamperedPayload = JSON.stringify({
    ...inventoryPayload,
    quantity: 999,   // ← tampered value
  });

  await sendWebhook({
    label:         'Tampered body (original sig, modified quantity)  →  expect HTTP 401',
    payloadString: tamperedPayload,
    signature:     originalSignature, // signature no longer matches the new body
  });
}

// ─── Main: run selected test(s) ───────────────────────────────────────────────
const mode = process.argv[2]; // e.g.  node simulator.js valid

console.log('═'.repeat(50));
console.log('  Webhook Simulator  —  The Meridian Pivot');
console.log(`  Target: ${SERVER_URL}`);
console.log('═'.repeat(50));

if (mode === 'valid') {
  await testValid();
} else if (mode === 'invalid') {
  await testInvalidSignature();
} else {
  // Default: run ALL four tests sequentially
  console.log('\n  Running all four tests...\n');
  await testValid();
  await testInvalidSignature();
  await testMissingSignature();
  await testTamperedBody();
  console.log(`\n${'═'.repeat(50)}`);
  console.log('  All tests complete.');
  console.log('═'.repeat(50));
}
