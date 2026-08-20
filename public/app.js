/* ════════════════════════════════════════════════════════════
   Webhook Guard — Dashboard Application Logic
   public/app.js

   Responsibilities:
     1. Poll /api/status to show SERVER ONLINE / OFFLINE
     2. Connect to /api/events (SSE) for live event history
     3. Handle form submit → POST /api/trigger (secret stays on server)
     4. Render verification status card (idle / loading / result / error)
     5. Render verification result detail table
     6. Maintain and render the recent events table
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ── Session-scoped event history ─────────────────────────── */
let sessionEvents = [];   // newest first

/* ══════════════════════════════════════════════════════════
   1. SERVER STATUS — polls /api/status every 8 s
   ══════════════════════════════════════════════════════════ */
async function checkServerStatus() {
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');

  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (r.ok) {
      dot.className   = 'status-dot online';
      label.className = 'status-label online';
      label.textContent = 'SERVER ONLINE';
    } else {
      throw new Error('non-ok');
    }
  } catch {
    dot.className   = 'status-dot offline';
    label.className = 'status-label offline';
    label.textContent = 'SERVER OFFLINE';
  }
}

checkServerStatus();
setInterval(checkServerStatus, 8000);

/* ══════════════════════════════════════════════════════════
   2. SERVER-SENT EVENTS — live webhook feed
   ══════════════════════════════════════════════════════════ */
function connectSSE() {
  const es = new EventSource('/api/events');

  es.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'snapshot') {
      /* Replace in-memory history with server history on connect */
      if (msg.events && msg.events.length) {
        sessionEvents = [...msg.events];
        rebuildEventsTable();
      }
    } else {
      /* A new live event arrived — prepend and re-render table */
      sessionEvents.unshift(msg);
      if (sessionEvents.length > 100) sessionEvents.pop();
      rebuildEventsTable();
    }
  };

  es.onerror = () => {
    es.close();
    setTimeout(connectSSE, 4000);   // reconnect quietly
  };
}

connectSSE();

/* ══════════════════════════════════════════════════════════
   3. FORM SUBMISSION
   ══════════════════════════════════════════════════════════ */
function getFormValues() {
  return {
    event:        document.getElementById('f-event').value.trim() || 'inventory.updated',
    product_id:   document.getElementById('f-pid').value.trim()   || 'SKU-001',
    product_name: document.getElementById('f-pname').value.trim() || 'Laptop',
    quantity:     Number(document.getElementById('f-qty').value)  || 25,
  };
}

function setFormDisabled(disabled) {
  ['f-event','f-pid','f-pname','f-qty','btn-valid','btn-invalid']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
}

async function sendWebhook(scenario) {
  /* Show loading state */
  setFormDisabled(true);
  showState('loading');
  document.getElementById('sending-state').textContent = 'Verifying webhook…';

  const body = { scenario, ...getFormValues() };

  try {
    const r    = await fetch('/api/trigger', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!r.ok && r.status >= 500) {
      throw new Error(`Server error ${r.status}`);
    }

    const data = await r.json();
    handleTriggerResponse(data);
    document.getElementById('sending-state').textContent = '';

  } catch (err) {
    showState('error');
    document.getElementById('sending-state').textContent = '⚠ ' + err.message;
  } finally {
    setFormDisabled(false);
  }
}

/* ══════════════════════════════════════════════════════════
   4. STATUS CARD STATES
   ══════════════════════════════════════════════════════════ */
function showState(state) {
  ['idle','loading','result','error'].forEach(s => {
    const el = document.getElementById('status-' + s);
    if (el) el.classList.toggle('hidden', s !== state);
  });
}

function handleTriggerResponse(data) {
  const accepted = data.status === 200;

  /* ── Main status card ── */
  showState('result');

  const iconEl    = document.getElementById('result-icon');
  const verdictEl = document.getElementById('result-verdict');
  const linesEl   = document.getElementById('result-lines');
  const httpEl    = document.getElementById('result-http');

  if (accepted) {
    iconEl.textContent      = '✓';
    iconEl.style.color      = 'var(--green)';
    verdictEl.textContent   = 'VERIFIED';
    verdictEl.className     = 'result-verdict verified';
    linesEl.innerHTML       = 'Signature matched<br>Webhook accepted';
    httpEl.textContent      = 'HTTP STATUS: 200';
    httpEl.className        = 'result-http http-200';
  } else {
    iconEl.textContent      = '✕';
    iconEl.style.color      = 'var(--red)';
    verdictEl.textContent   = 'REJECTED';
    verdictEl.className     = 'result-verdict rejected';

    const reason = data.response?.message || 'Webhook rejected';
    if (reason.toLowerCase().includes('missing')) {
      linesEl.innerHTML = 'Missing webhook signature<br>Webhook rejected';
    } else {
      linesEl.innerHTML = 'Signature verification failed<br>Webhook rejected';
    }
    httpEl.textContent  = `HTTP STATUS: ${data.status}`;
    httpEl.className    = 'result-http http-4xx';
  }

  /* ── Detail table ── */
  renderDetailTable(data, accepted);
}

/* ══════════════════════════════════════════════════════════
   5. RESULT DETAIL TABLE
   ══════════════════════════════════════════════════════════ */
function renderDetailTable(data, accepted) {
  const card  = document.getElementById('result-detail-card');
  const tbody = document.getElementById('result-table');

  card.classList.remove('hidden');

  const p = data.payload || {};

  if (accepted) {
    tbody.innerHTML = row('Signature', 'Verified', 'ok') +
      row('HTTP Status', data.status, 'num') +
      row('Event',       p.event        || '—') +
      row('Product',     p.product_id   || '—') +
      row('Name',        p.product_name || '—') +
      row('Quantity',    p.quantity != null ? p.quantity : '—');
  } else {
    tbody.innerHTML = row('Signature', 'Invalid', 'fail') +
      row('HTTP Status', data.status, 'num') +
      row('Event',       'Rejected');
  }
}

function row(label, value, cls) {
  const valClass = cls === 'ok'   ? 'result-val-ok'
                 : cls === 'fail' ? 'result-val-fail'
                 : cls === 'num'  ? 'result-val-num'
                 : '';
  return `<tr>
    <td>${label}</td>
    <td class="${valClass}">${value}</td>
  </tr>`;
}

/* ══════════════════════════════════════════════════════════
   6. EVENTS TABLE
   ══════════════════════════════════════════════════════════ */
function rebuildEventsTable() {
  const tbody = document.getElementById('events-tbody');

  if (!sessionEvents.length) {
    tbody.innerHTML = `<tr class="events-empty-row" id="events-empty">
      <td colspan="5">No events yet — send a test webhook above.</td>
    </tr>`;
    return;
  }

  tbody.innerHTML = sessionEvents.map(ev => {
    const accepted  = ev.result === 'accepted';
    const rowClass  = accepted ? 'ev-row-ok' : 'ev-row-fail';
    const time      = new Date(ev.ts).toLocaleTimeString();
    const product   = ev.body?.product_id   || '—';
    const eventType = ev.body?.event        || '—';
    const status    = accepted ? '✓ Verified'  : '✕ Rejected';
    const statusCls = accepted ? 'ev-status-ok' : 'ev-status-fail';
    const httpCls   = accepted ? 'ev-http-ok'   : 'ev-http-fail';

    return `<tr class="${rowClass}">
      <td class="ev-time">${time}</td>
      <td class="ev-product">${esc(product)}</td>
      <td class="ev-event">${esc(eventType)}</td>
      <td class="${statusCls}">${status}</td>
      <td class="${httpCls}">${ev.status}</td>
    </tr>`;
  }).join('');
}

function clearEvents() {
  sessionEvents = [];
  rebuildEventsTable();
}

/* ── HTML escape helper ── */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
