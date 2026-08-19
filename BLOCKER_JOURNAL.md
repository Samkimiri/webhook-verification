# Learning & Blocker Journal
## Webhook Verification Mini-Prototype — The Meridian Pivot

---

> **Instructions for use:**
> Fill in each entry with your real, actual experience as you work through the prototype.
> Do NOT fabricate errors, solutions, or time spent.
> The assignment values genuine troubleshooting — an honest record of a dead end is worth more than a polished invented one.
> Placeholder text is marked with `[  ]` brackets. Replace every placeholder with your own words.

---

## How to Use This Journal

- Create a new entry every time you hit a blocker, make a discovery, or spend meaningful time on a problem.
- You do not need to document steps that just worked first try — focus on friction points and learning moments.
- Include actual error messages by copy-pasting them from your terminal.
- Record what you expected to happen and what actually happened.

---

## Entry Template

Copy this block for each new entry.

```
─────────────────────────────────────────────────────────
Date / Time   : [e.g. 2025-07-14  14:30]
Topic / Area  : [e.g. Raw body middleware, dotenv setup, HMAC mismatch]

Problem or Blocker
  [Describe the specific problem you encountered.
   What were you trying to do? What went wrong?]

What I Tried
  [List each thing you attempted, in order.
   Include searches, documentation you read, code changes you made.]

Error or Result
  [Paste the actual error message or describe the unexpected result.
   Copy from your terminal — do not paraphrase if you can avoid it.]

What I Learned
  [In your own words: what does this error mean?
   What did you understand differently after solving it?]

Solution
  [Describe exactly what fixed the problem.
   If you are still blocked, write "UNRESOLVED" and describe your next step.]

Time Spent   : [e.g. 45 minutes]
Final Status : [Resolved / Unresolved / Partially resolved]
─────────────────────────────────────────────────────────
```

---

## Journal Entries

### Entry 1

```
─────────────────────────────────────────────────────────
Date / Time   : [Record the actual date and time here]
Topic / Area  : [e.g. Initial setup — installing dependencies]

Problem or Blocker
  [Record your actual experience setting up the project here.
   Did npm install work first try? Did you hit a Node.js version issue?]

What I Tried
  [Record what you actually did here.]

Error or Result
  [Paste any actual error output here, or write "No errors — worked first try."]

What I Learned
  [Record what you learned here.]

Solution
  [Record what you did to resolve it here.]

Time Spent   : [Record the actual time spent here]
Final Status : [Resolved / Unresolved / Partially resolved]
─────────────────────────────────────────────────────────
```

---

### Entry 2

```
─────────────────────────────────────────────────────────
Date / Time   : [Record the actual date and time here]
Topic / Area  : [e.g. Understanding raw body capture]

Problem or Blocker
  [Record your actual experience here.
   For example: did you initially try to verify against req.body instead of req.rawBody?
   Did the signature always fail until you understood why?]

What I Tried
  [Record what you actually tried here.]

Error or Result
  [Paste any actual error output here, or describe what unexpected behaviour you saw.]

What I Learned
  [Record what this taught you about raw body vs parsed body.]

Solution
  [Record how you resolved it.]

Time Spent   : [Record the actual time spent here]
Final Status : [Resolved / Unresolved / Partially resolved]
─────────────────────────────────────────────────────────
```

---

### Entry 3

```
─────────────────────────────────────────────────────────
Date / Time   : [Record the actual date and time here]
Topic / Area  : [e.g. crypto.timingSafeEqual() — length error]

Problem or Blocker
  [Record your actual experience here.
   For example: did you encounter the RangeError when buffers are different lengths?
   Did you have to look up why timingSafeEqual requires equal-length buffers?]

What I Tried
  [Record what you actually tried here.]

Error or Result
  [Paste the actual error message here if you encountered one.
   Example: "RangeError: Input buffers must have the same byte length"]

What I Learned
  [Record what this taught you about timing-safe comparison.]

Solution
  [Record how you resolved it — e.g. adding the length check before calling timingSafeEqual.]

Time Spent   : [Record the actual time spent here]
Final Status : [Resolved / Unresolved / Partially resolved]
─────────────────────────────────────────────────────────
```

---

### Entry 4

```
─────────────────────────────────────────────────────────
Date / Time   : [Record the actual date and time here]
Topic / Area  : [Record the topic of your fourth learning moment here]

Problem or Blocker
  [Record your actual experience here.]

What I Tried
  [Record what you actually tried here.]

Error or Result
  [Paste any actual error output here.]

What I Learned
  [Record what you learned here.]

Solution
  [Record how you resolved it.]

Time Spent   : [Record the actual time spent here]
Final Status : [Resolved / Unresolved / Partially resolved]
─────────────────────────────────────────────────────────
```

---

## Running Summary

> Fill this in at the end of your work session.

| Area | Status | Notes |
|---|---|---|
| Project setup & npm install | [ ] Complete / [ ] Blocked | [Your notes] |
| `server.js` — raw body middleware | [ ] Complete / [ ] Blocked | [Your notes] |
| `server.js` — HMAC verification | [ ] Complete / [ ] Blocked | [Your notes] |
| `server.js` — timing-safe comparison | [ ] Complete / [ ] Blocked | [Your notes] |
| `simulator.js` — valid test | [ ] Complete / [ ] Blocked | [Your notes] |
| `simulator.js` — invalid test | [ ] Complete / [ ] Blocked | [Your notes] |
| `simulator.js` — missing header test | [ ] Complete / [ ] Blocked | [Your notes] |
| `simulator.js` — tampered body test | [ ] Complete / [ ] Blocked | [Your notes] |

---

## Key Concepts — In My Own Words

> Write brief explanations in your own words after completing the prototype.
> This section helps consolidate your learning and is useful for the presentation.

**What is a webhook?**
[Write your own explanation here after completing the prototype.]

**What is webhook verification?**
[Write your own explanation here.]

**Why does the raw body matter?**
[Write your own explanation here.]

**What is HMAC-SHA256 doing?**
[Write your own explanation here.]

**What is a timing attack and why does it matter here?**
[Write your own explanation here.]

---

## Total Time Spent

| Day | Hours | Focus |
|---|---|---|
| Day 1 | [Record actual hours] | [What you focused on] |
| Day 2 | [Record actual hours] | [What you focused on] |
| **Total** | [Record actual total] | |

---

*This journal documents my real individual learning experience with webhook verification as part of The Meridian Pivot simulation.*
