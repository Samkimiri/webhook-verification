# WEBHOOK VERIFICATION SYSTEM

## BLOCKER / DEVELOPMENT JOURNAL

**Project:** Webhook Verification System
**Project URL:** https://webhook-verification.vercel.app/
**Development Period:** Wednesday – Thursday
**Duration:** 2 Days

---

## 1. PROJECT OVERVIEW

The project involved designing and developing a **Webhook Verification System** that demonstrates how webhook requests can be received, inspected and verified before they are trusted or processed.

The main objective was to create a functional and user-friendly web application that demonstrates the importance of webhook security. Webhooks are HTTP endpoints that receive event notifications, commonly through POST requests, and verification helps ensure that incoming requests originate from a trusted source and have not been tampered with.

I started working on the project on **Wednesday evening** and completed the working prototype on **Thursday**, deploying it to Vercel once it was finished. The development process involved planning, building the verification server, building a browser dashboard to observe results, restructuring the codebase once the first approach stopped being workable, fixing a real verification bug, polishing the UI, and finally deploying.

---

# 2. DEVELOPMENT JOURNAL

## DAY 1 – WEDNESDAY

### Goals for the Day

* Understand how webhook signature verification actually works before writing any code.
* Build a working Express server that can receive a webhook and verify its signature.
* Build a simulator that could send both valid and invalid webhook requests, so I had something real to test against.

### Project Planning and Core Build

I started by researching how webhook verification works — specifically how a sender and receiver share a secret, how the receiver recomputes a signature from the incoming payload, and how that gets compared against the signature the sender included in the request headers.

Once I understood the approach, I went straight into building rather than just planning on paper, since I wanted a working core before stopping for the day.

### Activities Completed

* Researched webhook verification and HMAC signature concepts.
* Set up the project (Express server, `simulator.js`, `.env.example`, `package.json`).
* Built the raw-body capture middleware needed before signature verification.
* Implemented HMAC-SHA256 signature generation and comparison.
* Used a timing-safe comparison for checking the signature instead of a plain equality check.
* Built `simulator.js` to send four scenarios: a valid webhook, an invalid signature, a missing signature header, and a tampered payload.

### Blockers / Challenges

The main challenge was understanding that Express parses the JSON body before your own code sees it — so if you try to verify the signature against the already-parsed body, the bytes you're hashing aren't necessarily the same bytes the sender actually signed. I had to capture the raw body specifically before parsing happened, or verification would never line up correctly.

### Solution

I added a `verify` callback inside the `express.json()` middleware to capture the raw request body before it was parsed, and computed the HMAC-SHA256 signature against those raw bytes rather than the parsed object.

### Outcome

By the end of Wednesday, the core verification logic worked: the server could correctly accept a validly signed request and reject a tampered or incorrectly signed one when tested against the simulator.

---

## DAY 2 – THURSDAY

### Goals for the Day

* Add a browser dashboard so verification results could be watched live instead of only reading terminal output.
* Make valid and invalid results impossible to confuse at a glance.
* Track down and fix a real bug where a legitimate webhook was being incorrectly rejected.
* Get the project deployed and usable outside of my own machine.

### Dashboard Build, Restructuring, Bug Fixing, UI Polish and Deployment

I started by adding a live dashboard directly into `server.js`, alongside an explainer of polling vs. webhooks. It worked, but I'd written it as one large file mixing the verification logic with a big block of inline HTML/CSS/JS — and it very quickly became difficult to keep working with.

### Activities Completed

* Added a live browser dashboard with a polling-vs-webhooks explainer.
* Restructured the codebase — split the dashboard out of `server.js` into separate `public/app.js`, `public/index.html`, and `public/styles.css` files, served statically, once the single-file approach stopped being workable.
* Rebuilt the dashboard as a clean interface and fixed a real verification bug (below).
* Strengthened the valid/invalid colour coding so results were unambiguous.
* Rewrote the UI copy in plain English so it made sense to a non-technical viewer, not just a developer.
* Added a real webhook info card exposing the live endpoint so an external sender could hit it directly, not just the simulator.
* Deployed the finished project to Vercel.

### Blockers / Challenges

**1. The dashboard refused to stay maintainable as one file.**
Once the dashboard code was mixed into `server.js` as inline markup and scripts, it became hard to edit safely — I couldn't easily tell the verification logic apart from the UI code, and small UI tweaks risked touching the parts of the file that actually mattered for security. I had to stop and restructure it into separate files before continuing, rather than keep building on top of it.

**2. A legitimate webhook was being rejected as invalid.**
This was the real bug of the project. Testing with a quantity of `0` caused the request to fail verification. Tracing it back, the form was reading the quantity with `Number(qty) || 25` — and because `Number(0)` is falsy in JavaScript, the `||` silently replaced a valid `0` with the fallback value of `25`. On top of that, the Event field was a freely editable text input, so it could accidentally be changed away from `inventory.updated`, which also broke the signature match. Both looked like a "verification bug" at first, but were actually input-handling bugs upstream of the verification logic itself.

**3. Valid and invalid results weren't visually distinct enough.**
Early on, a rejected webhook and an accepted one looked too similar on the dashboard (an outline-only red vs. a solid green), so it wasn't obvious at a glance which was which.

### Solution

* Split the dashboard into `public/app.js`, `public/index.html`, and `public/styles.css`, leaving `server.js` to handle only the verification logic — this made the restructuring worth the extra step.
* Replaced `Number(qty) || 25` with an explicit empty-string check so a real `0` is preserved, and changed the Event field to a locked, non-editable hidden field so it can no longer desync from what's actually signed. Added basic form validation with a clear inline error.
* Made the invalid state a solid red fill matching the valid state's weight, and added colour-tinted cards and row highlighting so success/failure is unmistakable.
* Once everything was verified working locally, deployed the project to Vercel.

### Outcome

By the end of Thursday, the dashboard was working, the verification bug was fixed and confirmed with a real `0`-quantity test, the UI clearly distinguished valid from invalid results, and the project was live at **https://webhook-verification.vercel.app/**.

---

# 3. KEY CHALLENGES ENCOUNTERED

### 1. Understanding Raw Body Verification

Learning that the signature has to be verified against the raw, unparsed request body — not the parsed JSON object — was the first real conceptual hurdle.

### 2. Restructuring the Code After It Stopped Working Well

Building the dashboard directly inside `server.js` worked initially but became unmanageable almost immediately — mixing UI markup with verification logic made the file hard to reason about safely. I had to stop and split it into separate files before continuing.

### 3. A Real Valid-Webhook Rejection Bug

A legitimate request with `quantity = 0` was being rejected because of a `Number(qty) || 25` fallback bug, compounded by an editable Event field that could desync from the signed payload. This was the most time-consuming issue to trace, since it surfaced as a signature mismatch rather than an obvious error.

### 4. Making Verification Results Visually Unambiguous

Getting the UI to clearly show valid vs. invalid results took a dedicated pass on colour and layout after the core logic already worked correctly.

### 5. Deployment

Moving from a working local prototype to a live Vercel deployment required a final round of testing to confirm nothing broke outside the local environment.

---

# 4. HOW I SOLVED THE BLOCKERS

I solved the challenges through:

* Researching how webhook signature verification actually works before implementing it.
* Capturing the raw request body before parsing, instead of trusting the parsed object.
* Recognising when a single-file approach had stopped being workable and restructuring rather than continuing to patch around it.
* Tracing the valid-webhook rejection bug back to its actual source in the form-handling code, rather than assuming the verification logic itself was wrong.
* Testing repeatedly after each fix, including the specific edge case (`quantity = 0`) that had originally exposed the bug.
* Making a dedicated UI pass once the underlying logic was confirmed correct.
* Testing the deployed Vercel version before considering the project finished.

---

# 5. SKILLS AND KNOWLEDGE GAINED

Through the project, I gained practical experience in:

* Webhook architecture and HMAC-SHA256 signature verification.
* Raw-body handling in Express.
* Timing-safe comparison for security-sensitive checks.
* Recognising when code needs restructuring rather than more patching.
* Debugging a bug that looked like a security/verification issue but was actually an input-handling issue.
* Frontend/backend integration.
* UI design for clearly communicating success/failure states.
* Deployment to Vercel.

---

# 6. FINAL PROJECT STATUS

The project was successfully completed after two days of development.

### Timeline

| Day               | Main Activity                                                              | Status    |
| ----------------- | --------------------------------------------------------------------------- | --------- |
| Wednesday         | Research, core Express server, HMAC verification, raw-body middleware, simulator | Completed |
| Thursday          | Dashboard build, restructuring, valid-webhook bug fix, UI polish, Vercel deployment | Completed |

---

# 7. CONCLUSION

The two-day development process took the project from understanding webhook signature verification to a functional, deployed application.

The most important lesson from the project was that the biggest issues weren't always where I expected them. The signature verification logic itself was correct from early on — the real blocker turned out to be a JavaScript falsy-value bug in how the form read a quantity of `0`, which looked like a verification failure but had nothing to do with cryptography at all. I also learned to recognise when a file had stopped being maintainable and needed restructuring, rather than continuing to build on top of it.

By the end of Thursday, the project was complete, verified working with both valid and invalid webhook scenarios, and deployed to production at **https://webhook-verification.vercel.app/**.

**Final Project:** Webhook Verification System
**Status:** COMPLETED
**Deployment:** Vercel
**Completion Day:** Thursday
