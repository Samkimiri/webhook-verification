# Webhook Verification Mini-Prototype

---

## 1. Assignment Context

This is a mini-prototype built for **The Meridian Pivot** — a working industry simulation in which the client, **Northstar Retail Co.**, requires a live inventory synchronisation service.

The simulation introduces a non-negotiable mid-project pivot: the initial polling model is discontinued and the team must transition to a **webhook push model** within 48 hours.

My individually assigned unfamiliar tool for Days 1–2 is **Webhook Verification** — specifically, how a server proves that an incoming webhook was sent by a trusted source and that its payload was not tampered with in transit.

This prototype is the learning artefact that demonstrates I independently researched and implemented that tool.

---

## 2. Objective

Demonstrate, in working code, how a Node.js/Express server can:

- Receive an HTTP POST webhook carrying a JSON inventory event
- Read the **raw request body** (not a re-serialised copy) for cryptographic verification
- Extract the `X-Webhook-Signature` header sent by the webhook source
- Recompute the expected **HMAC-SHA256** signature using a shared secret
- Compare signatures with **`crypto.timingSafeEqual()`** to prevent timing attacks
- Return **HTTP 200** for a valid, verified webhook
- Return **HTTP 401** for a missing, invalid, or forged signature
- Return **HTTP 400** for malformed JSON
- Never crash or expose the shared secret in logs or responses

---

## 3. Architecture

```
Warehouse Simulator  (simulator.js)
         |
         |  POST /webhook/inventory
         |  Body : { "event": "inventory.updated", ... }
         |  Header: X-Webhook-Signature: <hmac-hex>
         v
  Webhook Server  (server.js)
         |
         v
  Raw-body capture middleware
  (stores exact bytes on req.rawBody before JSON parsing)
         |
         v
  POST /webhook/inventory handler
         |
         v
  Header present? ──── NO  ──→  401 Missing signature
         |
        YES
         |
         v
  HMAC-SHA256(WEBHOOK_SECRET, req.rawBody) → expectedSignature
         |
         v
  timingSafeEqual(received, expected)?
         |
    ┌────┴────┐
   YES       NO
    |          |
    v          v
  HTTP 200   HTTP 401
  Accept     Reject
  Log event
```

---

## 4. Technologies

| Technology | Role |
|---|---|
| **Node.js** (v18+) | Runtime — required for native `fetch()` |
| **Express.js** | HTTP server and routing |
| **dotenv** | Load `.env` secrets without hardcoding |
| **Node.js `crypto`** | Built-in HMAC-SHA256 and `timingSafeEqual()` |
| **Native `fetch()`** | HTTP client in `simulator.js` (no extra library) |
| **HMAC-SHA256** | Cryptographic signature algorithm |
| **JSON / REST** | Wire format and protocol |

---

## 5. How Webhook Verification Works

### Shared secret
Both the sender (warehouse system) and the receiver (this server) know a secret string called the **webhook secret**. It is never transmitted in any request. Think of it as a password that both sides memorised in advance.

### Raw request body
Before signing, the sender serialises the JSON payload to an exact string — say `{"event":"inventory.updated","product_id":"SKU-001","quantity":25}`. Those exact bytes are what get signed. The receiver must verify against those same bytes; re-serialising the parsed object could produce a different byte sequence and break verification.

### HMAC-SHA256
**HMAC** (Hash-based Message Authentication Code) is a cryptographic function that takes a secret key and a message and produces a fixed-length digest. **SHA-256** is the hash function used internally. The same secret + the same message always produce the same digest. A different secret or a different message produces a completely different digest.

### Signature
The sender computes:
```
signature = HMAC-SHA256(webhookSecret, rawBody)
```
and encodes the result as a hexadecimal string. This is placed in the `X-Webhook-Signature` request header.

### Verification
The server independently computes the same formula using its own copy of the secret and the raw body it received. If the two hex strings match, the payload was signed with the correct secret and was not modified.

### Why forged requests fail
An attacker who does not know the secret cannot compute a valid HMAC for any payload. If they modify the payload (e.g., change `quantity` from 25 to 9999), the HMAC of the modified payload will not match the HMAC that was included in the header. The server detects this and rejects the request.

---

## 6. Installation

```bash
# 1. Clone or download the project
cd webhook-verification

# 2. Install dependencies
npm install

# 3. Create your .env file
#    Copy the example file and fill in your own secret
copy .env.example .env       # Windows
# cp .env.example .env       # macOS / Linux

# 4. Open .env and set a real secret value:
#    WEBHOOK_SECRET=replace-this-with-a-long-random-string
```

---

## 7. Configuration

Create a `.env` file in the project root (never commit this file):

```
WEBHOOK_SECRET=your-super-secret-key-here
PORT=3000
```

| Variable | Required | Description |
|---|---|---|
| `WEBHOOK_SECRET` | **Yes** | Shared secret used for HMAC signing and verification |
| `PORT` | No | Port to listen on (default: 3000) |

> **⚠️ Security:** `.env` is listed in `.gitignore`. Never push it to GitHub. Use `.env.example` (which contains no real secrets) for sharing the configuration template.

---

## 8. Running the Server

```bash
npm start
```

Expected output:
```
🚀  Webhook server running on http://localhost:3000
    Listening for POST /webhook/inventory
    WEBHOOK_SECRET loaded: ************************ (24 chars)
```

---

## 9. Running the Simulator

Open a **second terminal** (keep the server running in the first).

```bash
# Run all four tests automatically
npm run simulate

# Run only the valid test
node simulator.js valid

# Run only the invalid test
node simulator.js invalid
```

---

## 10. Testing

### Prerequisites
- Server is running (`npm start` in Terminal 1)
- `.env` is configured with `WEBHOOK_SECRET`
- Open Terminal 2 for the simulator commands

---

### Test 1 — Valid signature → accepted

**What is being tested:** A correctly signed webhook is accepted by the server.

**Command:**
```bash
node simulator.js valid
```

**Expected HTTP status:** `200`

**Expected server response:**
```json
{ "success": true, "message": "Webhook verified and accepted" }
```

**Server log:**
```
✓  Signature verified
✓  Inventory event accepted
   Event payload: { "event": "inventory.updated", ... }
```

**What this proves:** The HMAC verification pipeline works end-to-end. A webhook signed with the correct secret is accepted.

---

### Test 2 — Invalid signature → rejected

**What is being tested:** A webhook signed with the wrong secret is rejected.

**Command:**
```bash
node simulator.js invalid
```

**Expected HTTP status:** `401`

**Expected server response:**
```json
{ "success": false, "message": "Invalid webhook signature" }
```

**What this proves:** The server correctly detects a signature mismatch and refuses to process the event. An attacker who does not know the real secret cannot forge a valid request.

---

### Test 3 — Missing signature → rejected

**What is being tested:** A request with no `X-Webhook-Signature` header is rejected.

**Command:**
```bash
npm run simulate
# (the full test suite includes the missing-signature test)
```

Or, to isolate it, send a curl request with no signature header:
```bash
curl -s -X POST http://localhost:3000/webhook/inventory \
  -H "Content-Type: application/json" \
  -d '{"event":"inventory.updated","product_id":"SKU-001","product_name":"Laptop","quantity":25}'
```

**Expected HTTP status:** `401`

**Expected server response:**
```json
{ "success": false, "message": "Missing webhook signature" }
```

**What this proves:** Unauthenticated requests (no header at all) are rejected immediately without any cryptographic work being done.

---

### Test 4 — Modified body → rejected

**What is being tested:** An attacker intercepts a valid webhook, modifies the quantity to 999, and re-sends it with the original (now invalid) signature.

**Command:**
```bash
npm run simulate
# (the full test suite includes the tampered-body test)
```

**Expected HTTP status:** `401`

**Expected server response:**
```json
{ "success": false, "message": "Invalid webhook signature" }
```

**What this proves:** The HMAC signature is computed over the exact bytes of the body. Changing even one character produces a completely different digest, so the original signature no longer matches. Payload tampering is detected reliably.

---

## 11. Security Considerations

| Topic | Detail |
|---|---|
| **Secret management** | `WEBHOOK_SECRET` lives only in `.env` and is never hardcoded. The server redacts it from all logs (only the length is shown at startup). |
| **Raw body verification** | The signature is verified against `req.rawBody` (the original bytes), not a re-serialised copy of the parsed object. Re-serialisation could silently alter whitespace or key order and cause verification to fail for legitimate requests. |
| **Timing-safe comparison** | `crypto.timingSafeEqual()` prevents timing side-channel attacks. A standard `===` comparison leaks information about how many characters matched. |
| **HTTPS in production** | This prototype uses HTTP for local development. In production, all webhook traffic must be sent over **HTTPS** to prevent the payload from being read in transit (TLS encrypts the body; HMAC ensures it was not modified). |
| **Reject before processing** | Invalid or unverified webhooks are rejected immediately. The inventory event is never read or acted upon until verification succeeds. |
| **No secret in responses** | Neither the expected signature nor the secret are included in any response body or log line. |

---

## 12. Limitations

This is a **learning prototype**, not a production-ready webhook platform.

It does not include:

- Replay attack protection (e.g., timestamp + nonce validation)
- HTTPS termination
- Rate limiting
- A database or persistent inventory store
- Retry logic for failed webhook deliveries
- Multiple secret rotation support
- Authentication beyond HMAC (e.g., OAuth, mTLS)
- Deployment configuration (Docker, cloud, etc.)

These features would be required before using this pattern in a real production system.

---

## 13. Project File Reference

| File | Purpose |
|---|---|
| `server.js` | Express HTTP server. Receives webhooks, verifies HMAC signatures, returns appropriate responses. |
| `simulator.js` | Fake warehouse system. Builds payloads, signs them, and POSTs them to the server. Includes four test scenarios. |
| `package.json` | npm manifest. Declares dependencies (`express`, `dotenv`) and scripts (`start`, `simulate`). |
| `.env.example` | Template for the required environment variables. Safe to commit — contains no real secrets. |
| `.gitignore` | Prevents `node_modules/` and `.env` from being committed to version control. |
| `README.md` | This file. Full project documentation. |
| `BLOCKER_JOURNAL.md` | Learning and Blocker Journal. Documents the real experience of learning webhook verification. |
