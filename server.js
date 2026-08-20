// =============================================================================
// server.js  —  Webhook Verification Mini-Prototype
// Project   : The Meridian Pivot  (Northstar Retail Co. simulation)
// Purpose   : Receive, verify, and respond to signed inventory webhooks.
//             Also serves a browser dashboard for live interaction and learning.
//
// Routes:
//   GET  /                     → Browser dashboard UI
//   GET  /api/events           → Server-Sent Events (live webhook feed)
//   POST /api/trigger          → Fire a test scenario from the browser
//   POST /webhook/inventory    → Main webhook endpoint (HMAC verification)
// =============================================================================

import 'dotenv/config';
import express from 'express';
import crypto  from 'crypto';

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

// ─── Route: POST /api/trigger — fire a test from the browser ─────────────────
// Lets the dashboard buttons send all four test scenarios without a terminal.
app.post('/api/trigger', async (req, res) => {
  const { scenario = 'valid' } = req.body || {};

  const base = {
    event:        'inventory.updated',
    product_id:   'SKU-001',
    product_name: 'Laptop',
    quantity:     25,
  };
  const payloadStr = JSON.stringify(base);

  let sig, body = payloadStr, label;

  switch (scenario) {
    case 'invalid':
      sig   = crypto.createHmac('sha256', 'wrong-secret').update(payloadStr).digest('hex');
      label = 'Wrong secret — expect 401';
      break;
    case 'missing':
      sig   = null;
      label = 'No signature header — expect 401';
      break;
    case 'tampered':
      sig   = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadStr).digest('hex');
      body  = JSON.stringify({ ...base, quantity: 999 });
      label = 'Tampered body (qty 999) — expect 401';
      break;
    default:
      sig   = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadStr).digest('hex');
      label = 'Correct signature — expect 200';
  }

  const headers = { 'Content-Type': 'application/json' };
  if (sig !== null) headers['X-Webhook-Signature'] = sig;

  const proto  = req.headers['x-forwarded-proto'] || 'http';
  const host   = req.headers.host || `localhost:${PORT}`;
  const target = `${proto}://${host}/webhook/inventory`;

  try {
    const r    = await fetch(target, { method: 'POST', headers, body });
    const json = await r.json();
    res.json({ ok: true, scenario, label, status: r.status, response: json });
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

// ─── Route: GET / — Dashboard UI ─────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
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

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
// Fully self-contained — no external CSS/JS/fonts. Works offline.
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Webhook Verification — The Meridian Pivot</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg:#f4f6f9;
  --surface:#ffffff;
  --border:#dde1e7;
  --text:#1c2127;
  --muted:#6b7685;
  --accent:#2563eb;
  --green:#16a34a;
  --red:#dc2626;
  --amber:#d97706;
  --purple:#7c3aed;
  --radius:10px;
}

body{
  font-family:-apple-system,"Segoe UI",system-ui,sans-serif;
  background:var(--bg);
  color:var(--text);
  font-size:14px;
  line-height:1.6;
}

/* ── Header ── */
header{
  background:var(--surface);
  border-bottom:1px solid var(--border);
  padding:0 28px;
  height:58px;
  display:flex;
  align-items:center;
  gap:14px;
  position:sticky;
  top:0;
  z-index:20;
}
.hdr-dot{
  width:9px;height:9px;border-radius:50%;
  background:var(--green);flex-shrink:0;
  animation:blink 2.4s ease-in-out infinite;
}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.hdr-title{font-size:15px;font-weight:700;letter-spacing:-.01em}
.hdr-sub{font-size:12px;color:var(--muted);margin-left:2px}
.hdr-sep{flex:1}
.hdr-badge{
  font-size:11px;font-weight:600;
  background:#dbeafe;color:var(--accent);
  padding:3px 10px;border-radius:20px;
}

/* ── Layout ── */
main{
  max-width:980px;
  margin:0 auto;
  padding:28px 20px 72px;
  display:grid;
  gap:22px;
}

/* ── Stats strip ── */
.stats{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  background:var(--border);
  border:1px solid var(--border);
  border-radius:var(--radius);
  overflow:hidden;
  gap:1px;
}
.stat{
  background:var(--surface);
  padding:18px 20px;
  text-align:center;
}
.stat-val{font-size:30px;font-weight:800;line-height:1}
.stat-lbl{font-size:11px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:.06em}
.stat.total  .stat-val{color:var(--accent)}
.stat.ok     .stat-val{color:var(--green)}
.stat.fail   .stat-val{color:var(--red)}

/* ── Card ── */
.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--radius);
  overflow:hidden;
}
.card-head{
  padding:14px 20px;
  border-bottom:1px solid var(--border);
  display:flex;
  align-items:center;
  gap:8px;
}
.card-head h2{
  font-size:12px;font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);
}
.card-body{padding:22px}

/* ── Polling vs Webhooks comparison ── */
.compare{
  display:grid;
  grid-template-columns:1fr 36px 1fr;
  gap:14px;
  align-items:start;
}
@media(max-width:620px){
  .compare{grid-template-columns:1fr}
  .vs-col{display:none}
}
.model-box{
  border-radius:8px;
  padding:18px;
  border:1px solid var(--border);
}
.model-box.polling{background:#fffbeb;border-color:#fcd34d}
.model-box.webhook{background:#f0fdf4;border-color:#86efac}
.model-title{
  font-size:13px;font-weight:800;
  margin-bottom:6px;
  display:flex;align-items:center;gap:7px;
}
.model-box.polling .model-title{color:var(--amber)}
.model-box.webhook .model-title{color:var(--green)}
.model-desc{font-size:12px;color:var(--muted);margin-bottom:14px}

.steps{display:flex;flex-direction:column;gap:7px}
.step{
  display:flex;align-items:flex-start;gap:8px;
  font-size:12px;line-height:1.45;
}
.step-num{
  flex-shrink:0;
  width:18px;height:18px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;
  margin-top:1px;
}
.polling .step-num{background:#fef3c7;color:#92400e}
.webhook .step-num{background:#dcfce7;color:#166534}

.waste-row{margin-top:14px}
.waste-label{font-size:11px;font-weight:600;margin-bottom:5px}
.polling .waste-label{color:var(--amber)}
.webhook .waste-label{color:var(--green)}
.waste-bar{
  height:22px;border-radius:4px;overflow:hidden;
  display:flex;font-size:11px;font-weight:700;
}
.waste-bar .empty{background:#fca5a5;color:#7f1d1d;flex:9;display:flex;align-items:center;justify-content:center}
.waste-bar .used {background:#86efac;color:#14532d;flex:1;display:flex;align-items:center;justify-content:center}
.waste-bar .full {background:#86efac;color:#14532d;flex:1;display:flex;align-items:center;justify-content:center;border-radius:4px}

.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}
.tag{
  font-size:11px;font-weight:600;
  padding:2px 9px;border-radius:20px;
}
.tag-red   {background:#fee2e2;color:var(--red)}
.tag-amber {background:#fef9c3;color:var(--amber)}
.tag-green {background:#dcfce7;color:var(--green)}
.tag-blue  {background:#dbeafe;color:var(--accent)}
.tag-purple{background:#ede9fe;color:var(--purple)}

.vs-col{
  display:flex;align-items:flex-start;justify-content:center;
  padding-top:30px;
}
.vs-circle{
  width:34px;height:34px;border-radius:50%;
  background:var(--bg);border:1px solid var(--border);
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:800;color:var(--muted);
}

/* ── Verification pipeline ── */
.pipeline{
  display:flex;align-items:center;
  justify-content:center;
  flex-wrap:wrap;
  gap:0;
  padding:6px 0 16px;
}
.pipe-node{
  display:flex;flex-direction:column;align-items:center;
  gap:5px;min-width:88px;
}
.pipe-icon{
  width:50px;height:50px;border-radius:12px;
  border:1px solid var(--border);background:var(--bg);
  display:flex;align-items:center;justify-content:center;
  font-size:20px;
}
.pipe-name{font-size:11px;color:var(--muted);text-align:center;max-width:84px;line-height:1.3}
.pipe-detail{font-size:10px;color:var(--accent);text-align:center;max-width:84px;font-weight:600;line-height:1.3}
.pipe-arr{
  font-size:20px;color:var(--border);
  padding:0 2px;padding-bottom:22px;
}

.concepts{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
  gap:12px;
  margin-top:18px;
}
.concept{
  border:1px solid var(--border);border-radius:8px;
  padding:14px;
}
.concept-title{
  font-size:11px;font-weight:700;
  color:var(--accent);
  text-transform:uppercase;letter-spacing:.05em;
  margin-bottom:6px;
}
.concept-text{font-size:12px;color:var(--muted);line-height:1.5}

/* ── Test buttons ── */
.test-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
  gap:12px;
}
.test-btn{
  text-align:left;
  padding:15px 16px;
  border:1px solid var(--border);
  border-radius:8px;
  background:var(--surface);
  cursor:pointer;
  transition:box-shadow .15s,border-color .15s,transform .1s;
  position:relative;
  overflow:hidden;
}
.test-btn::before{
  content:'';
  position:absolute;left:0;top:0;bottom:0;width:3px;
}
.test-btn.valid::before  {background:var(--green)}
.test-btn.invalid::before{background:var(--red)}
.test-btn.missing::before{background:var(--amber)}
.test-btn.tamper::before {background:var(--purple)}
.test-btn:hover{
  border-color:var(--accent);
  box-shadow:0 0 0 3px rgba(37,99,235,.1);
}
.test-btn:active{transform:scale(.98)}
.test-btn:disabled{opacity:.55;cursor:default;transform:none}
.btn-title{font-size:13px;font-weight:700;margin-bottom:4px}
.btn-desc {font-size:12px;color:var(--muted);line-height:1.4}
.btn-expect{
  display:inline-block;
  margin-top:8px;
  font-size:10px;font-weight:700;
  padding:2px 7px;border-radius:10px;
  text-transform:uppercase;letter-spacing:.04em;
}
.valid   .btn-expect{background:#dcfce7;color:#166534}
.invalid .btn-expect{background:#fee2e2;color:#991b1b}
.missing .btn-expect{background:#fef9c3;color:#92400e}
.tamper  .btn-expect{background:#ede9fe;color:#5b21b6}

#trigger-status{
  margin-top:12px;
  min-height:22px;
  font-size:12px;
  color:var(--muted);
  font-weight:500;
}

/* ── Event log ── */
#event-log{
  display:flex;flex-direction:column;gap:8px;
  max-height:460px;overflow-y:auto;
  padding-right:2px;
}
.ev{
  display:grid;
  grid-template-columns:auto 68px 1fr auto;
  align-items:start;
  gap:10px;
  padding:10px 14px;
  border:1px solid var(--border);border-radius:8px;
  font-size:12px;
  animation:drop .22s ease-out;
}
@keyframes drop{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.ev.accepted{border-left:3px solid var(--green);background:#f0fdf4}
.ev.rejected{border-left:3px solid var(--red);background:#fff5f5}
.ev.error   {border-left:3px solid var(--amber);background:#fffbeb}
.ev-icon{font-size:16px;line-height:1}
.ev-time{color:var(--muted);white-space:nowrap;font-size:11px;padding-top:1px}
.ev-body{min-width:0}
.ev-reason{font-weight:700;margin-bottom:2px}
.ev-payload{
  color:var(--muted);word-break:break-all;
  font-family:"Cascadia Code","Fira Mono","Consolas",monospace;
  font-size:11px;margin-top:2px;
}
.ev-status{flex-shrink:0}

.pill{
  display:inline-block;
  font-size:11px;font-weight:700;
  padding:2px 8px;border-radius:20px;
}
.pill-green {background:#dcfce7;color:#166534}
.pill-red   {background:#fee2e2;color:#991b1b}

.empty{
  text-align:center;padding:36px;
  color:var(--muted);font-size:13px;
}
.empty-icon{font-size:36px;margin-bottom:10px}

/* ── Log clear btn ── */
.log-clear-btn{
  margin-left:auto;
  font-size:11px;color:var(--muted);
  background:none;border:1px solid var(--border);
  border-radius:5px;padding:3px 10px;cursor:pointer;
}
.log-clear-btn:hover{border-color:var(--red);color:var(--red)}
</style>
</head>
<body>

<header>
  <div class="hdr-dot" id="conn-dot"></div>
  <div>
    <div class="hdr-title">Webhook Verification Dashboard</div>
    <div class="hdr-sub">The Meridian Pivot — Northstar Retail Co.</div>
  </div>
  <div class="hdr-sep"></div>
  <div class="hdr-badge">POST /webhook/inventory</div>
</header>

<main>

  <!-- Stats -->
  <div class="stats">
    <div class="stat total">
      <div class="stat-val" id="s-total">0</div>
      <div class="stat-lbl">Total Received</div>
    </div>
    <div class="stat ok">
      <div class="stat-val" id="s-ok">0</div>
      <div class="stat-lbl">Accepted</div>
    </div>
    <div class="stat fail">
      <div class="stat-val" id="s-fail">0</div>
      <div class="stat-lbl">Rejected</div>
    </div>
  </div>

  <!-- Polling vs Webhooks -->
  <div class="card">
    <div class="card-head">
      <h2>📖 Polling vs Webhooks — The Meridian Pivot</h2>
    </div>
    <div class="card-body">
      <p style="font-size:13px;color:var(--muted);margin-bottom:18px">
        Northstar Retail Co. originally synchronised inventory by <strong>polling</strong> the warehouse API on a timer.
        The mid-project pivot required replacing it with a <strong>webhook push model</strong> within 48 hours.
        Here is why that change matters:
      </p>

      <div class="compare">

        <div class="model-box polling">
          <div class="model-title">⏱ Polling <span style="font-size:11px;font-weight:400;color:var(--amber)">(old model — discontinued)</span></div>
          <p class="model-desc">Your server repeatedly asks the warehouse: <em>"Any updates yet?"</em> — whether or not anything changed.</p>
          <div class="steps">
            <div class="step"><div class="step-num">1</div><span>Retail server sends <code>GET /inventory</code> every 30 s</span></div>
            <div class="step"><div class="step-num">2</div><span>Warehouse server receives the request</span></div>
            <div class="step"><div class="step-num">3</div><span>Response: <em>"Nothing new."</em> — empty payload</span></div>
            <div class="step"><div class="step-num">4</div><span>Wait 30 s, then repeat from step 1&hellip; forever</span></div>
          </div>
          <div class="waste-row">
            <div class="waste-label">REQUEST WASTE — 120 polls per hour</div>
            <div class="waste-bar">
              <span class="empty">~95% empty responses</span>
              <span class="used">5%</span>
            </div>
          </div>
          <div class="tags">
            <span class="tag tag-red">Up to 30 s delay</span>
            <span class="tag tag-red">Wasted bandwidth</span>
            <span class="tag tag-amber">Server load</span>
          </div>
        </div>

        <div class="vs-col">
          <div class="vs-circle">VS</div>
        </div>

        <div class="model-box webhook">
          <div class="model-title">⚡ Webhooks <span style="font-size:11px;font-weight:400;color:var(--green)">(new model — active)</span></div>
          <p class="model-desc">The warehouse <em>calls you</em> the instant something changes. No asking — just instant notification.</p>
          <div class="steps">
            <div class="step"><div class="step-num">1</div><span>Inventory changes in the warehouse system</span></div>
            <div class="step"><div class="step-num">2</div><span>Warehouse signs the event with a shared secret (HMAC)</span></div>
            <div class="step"><div class="step-num">3</div><span>Warehouse POSTs the signed event to this server</span></div>
            <div class="step"><div class="step-num">4</div><span>Server verifies the signature and accepts or rejects</span></div>
          </div>
          <div class="waste-row">
            <div class="waste-label">REQUEST EFFICIENCY</div>
            <div class="waste-bar">
              <span class="full" style="flex:1;border-radius:4px">100% meaningful events</span>
            </div>
          </div>
          <div class="tags">
            <span class="tag tag-green">Instant / real-time</span>
            <span class="tag tag-green">Zero wasted requests</span>
            <span class="tag tag-blue">Event-driven</span>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- How verification works -->
  <div class="card">
    <div class="card-head">
      <h2>🔐 How Webhook Verification Works</h2>
    </div>
    <div class="card-body">
      <div class="pipeline">
        <div class="pipe-node">
          <div class="pipe-icon">🏭</div>
          <div class="pipe-name">Warehouse System</div>
          <div class="pipe-detail">Signs with HMAC-SHA256</div>
        </div>
        <div class="pipe-arr">→</div>
        <div class="pipe-node">
          <div class="pipe-icon">📨</div>
          <div class="pipe-name">HTTP POST Request</div>
          <div class="pipe-detail">X-Webhook-Signature header</div>
        </div>
        <div class="pipe-arr">→</div>
        <div class="pipe-node">
          <div class="pipe-icon">🧱</div>
          <div class="pipe-name">Raw-Body Middleware</div>
          <div class="pipe-detail">Captures exact bytes before parsing</div>
        </div>
        <div class="pipe-arr">→</div>
        <div class="pipe-node">
          <div class="pipe-icon">🔑</div>
          <div class="pipe-name">HMAC Verification</div>
          <div class="pipe-detail">timingSafeEqual()</div>
        </div>
        <div class="pipe-arr">→</div>
        <div class="pipe-node">
          <div class="pipe-icon">✅</div>
          <div class="pipe-name">200 Accepted</div>
          <div class="pipe-detail">or 401 Rejected</div>
        </div>
      </div>

      <div class="concepts">
        <div class="concept">
          <div class="concept-title">Shared Secret</div>
          <div class="concept-text">Both sides know a secret string that is <strong>never transmitted</strong>. It is only used locally to compute and check the HMAC digest.</div>
        </div>
        <div class="concept">
          <div class="concept-title">Raw Body</div>
          <div class="concept-text">The signature covers the <strong>exact bytes on the wire</strong>. Re-serialising the parsed JSON object could silently change whitespace or key order, breaking the signature check for legitimate requests.</div>
        </div>
        <div class="concept">
          <div class="concept-title">HMAC-SHA256</div>
          <div class="concept-text"><code>HMAC(secret, rawBody) → hex</code>. The same secret + body always give the same digest. Changing even one byte produces a completely different output.</div>
        </div>
        <div class="concept">
          <div class="concept-title">Timing-Safe Compare</div>
          <div class="concept-text"><code>timingSafeEqual()</code> always takes the same time to run, no matter where strings differ. A plain <code>===</code> short-circuits and leaks timing information an attacker can exploit.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Fire a test -->
  <div class="card">
    <div class="card-head">
      <h2>🧪 Fire a Test Webhook</h2>
    </div>
    <div class="card-body">
      <div class="test-grid">

        <button class="test-btn valid" onclick="fire('valid')">
          <div class="btn-title">✅ Valid Signature</div>
          <div class="btn-desc">Correct secret used to sign. Server should accept the event.</div>
          <span class="btn-expect">HTTP 200</span>
        </button>

        <button class="test-btn invalid" onclick="fire('invalid')">
          <div class="btn-title">❌ Wrong Secret</div>
          <div class="btn-desc">Signed with a different secret. Signature won't match.</div>
          <span class="btn-expect">HTTP 401</span>
        </button>

        <button class="test-btn missing" onclick="fire('missing')">
          <div class="btn-title">⚠️ No Signature Header</div>
          <div class="btn-desc">X-Webhook-Signature header is omitted entirely.</div>
          <span class="btn-expect">HTTP 401</span>
        </button>

        <button class="test-btn tamper" onclick="fire('tampered')">
          <div class="btn-title">🔀 Tampered Body</div>
          <div class="btn-desc">Original signature but quantity changed to 999. Body no longer matches what was signed.</div>
          <span class="btn-expect">HTTP 401</span>
        </button>

      </div>
      <div id="trigger-status"></div>
    </div>
  </div>

  <!-- Live event log -->
  <div class="card">
    <div class="card-head">
      <h2>📋 Live Event Log</h2>
      <button class="log-clear-btn" onclick="clearLog()">Clear</button>
    </div>
    <div class="card-body" style="padding:14px">
      <div id="event-log">
        <div class="empty">
          <div class="empty-icon">📭</div>
          No events yet. Click a test button above or run <code>node simulator.js</code> in a terminal.
        </div>
      </div>
    </div>
  </div>

</main>

<script>
  /* ── Counters ── */
  let counts = {total:0, ok:0, fail:0};
  function bump(result) {
    counts.total++;
    if (result === 'accepted') counts.ok++; else counts.fail++;
    document.getElementById('s-total').textContent = counts.total;
    document.getElementById('s-ok').textContent    = counts.ok;
    document.getElementById('s-fail').textContent  = counts.fail;
  }

  /* ── Render one event row ── */
  function renderRow(e) {
    const div  = document.createElement('div');
    div.className = 'ev ' + (e.result || 'error');

    const icon  = e.result === 'accepted' ? '✅' : e.result === 'rejected' ? '❌' : '⚠️';
    const time  = new Date(e.ts).toLocaleTimeString();
    const pill  = e.result === 'accepted'
      ? '<span class="pill pill-green">200 OK</span>'
      : '<span class="pill pill-red">' + (e.status || '4xx') + '</span>';

    const payload = (e.body && Object.keys(e.body).length)
      ? '<div class="ev-payload">' + JSON.stringify(e.body) + '</div>'
      : '';

    div.innerHTML =
      '<span class="ev-icon">' + icon + '</span>' +
      '<span class="ev-time">' + time + '</span>' +
      '<div class="ev-body">' +
        '<div class="ev-reason">' + (e.reason || '') + '</div>' +
        payload +
      '</div>' +
      '<div class="ev-status">' + pill + '</div>';

    return div;
  }

  /* ── Add to log ── */
  function addRow(e, prepend) {
    const log   = document.getElementById('event-log');
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    const row = renderRow(e);
    prepend ? log.insertBefore(row, log.firstChild) : log.appendChild(row);
    bump(e.result);
  }

  /* ── SSE connection ── */
  const dot = document.getElementById('conn-dot');

  function connect() {
    const es = new EventSource('/api/events');

    es.onopen  = () => { dot.style.background = 'var(--green)'; };
    es.onerror = () => {
      dot.style.background = 'var(--red)';
      es.close();
      setTimeout(connect, 3000);
    };

    es.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.type === 'snapshot') {
        /* Reload history cleanly */
        if (msg.events && msg.events.length) {
          counts = {total:0, ok:0, fail:0};
          ['s-total','s-ok','s-fail'].forEach(id => document.getElementById(id).textContent = 0);
          const log = document.getElementById('event-log');
          log.innerHTML = '';
          msg.events.forEach(e => addRow(e, false));
        }
      } else {
        addRow(msg, true);
      }
    };
  }

  connect();

  /* ── Fire test scenario ── */
  async function fire(scenario) {
    const el = document.getElementById('trigger-status');
    el.style.color = 'var(--muted)';
    el.textContent = 'Sending…';

    /* Disable all buttons while in-flight */
    document.querySelectorAll('.test-btn').forEach(b => b.disabled = true);

    try {
      const r    = await fetch('/api/trigger', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ scenario }),
      });
      const json = await r.json();
      const ok   = json.status === 200;
      el.style.color = ok ? 'var(--green)' : 'var(--red)';
      el.textContent = (ok ? '✅ ' : '❌ ') + json.label + ' → HTTP ' + json.status;
    } catch (err) {
      el.style.color = 'var(--amber)';
      el.textContent = '⚠️ Request failed: ' + err.message;
    } finally {
      document.querySelectorAll('.test-btn').forEach(b => b.disabled = false);
    }
  }

  /* ── Clear log display ── */
  function clearLog() {
    document.getElementById('event-log').innerHTML =
      '<div class="empty"><div class="empty-icon">📭</div>Log cleared.</div>';
    counts = {total:0, ok:0, fail:0};
    ['s-total','s-ok','s-fail'].forEach(id => document.getElementById(id).textContent = 0);
  }
</script>
</body>
</html>`;

// ─── Start listening ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Webhook server running on http://localhost:${PORT}`);
  console.log(`    Dashboard → http://localhost:${PORT}/`);
  console.log(`    Endpoint  → POST http://localhost:${PORT}/webhook/inventory`);
  console.log(`    WEBHOOK_SECRET loaded: ${'*'.repeat(WEBHOOK_SECRET.length)} (${WEBHOOK_SECRET.length} chars)\n`);
});
