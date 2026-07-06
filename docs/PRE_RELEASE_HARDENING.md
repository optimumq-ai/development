# Pre-Release Hardening — categorized working list

Security/hardening items known (without testing) to need work before full customer release. Split by whether implementing them **touches how the system processes requests**, so the second group can be deferred until the application is demo-ready.

**Demo strategy (Kevin):** once demo-ready, copy the application to a separate location (a different logical drive on the droplet, or a dedicated demo droplet) and demo from that copy. Category 2 items below do **not** need to be done for the demo copy — they don't affect demonstrating functionality. Build them in the "after demo, before full release" phase, or sooner if a circumstance compels it.

---

## Category 1 — Function-impacting (design carefully; touches request processing / search)
These affect the actual indexing/search/processing path, so they must be designed to preserve function. Consider around demo time since they shape the real architecture.

### 1.1 Vector-DB content-at-rest encryption
- **Why:** the internal document index (`embeddings` table) stores the embedded **text** alongside each vector, and for the internal index that text can include **unredacted / exempt content** — effectively a second plaintext copy of sensitive record text in the database. High-value target (a DB/backup/disk compromise reads exempt content directly, bypassing redaction).
- **Function constraint:** semantic search runs on the **vector** column; the sensitive text is a **separate payload** read only for display / the AI judge. Encrypt the **text payload** (decrypt on read) and **leave vectors searchable** → search keeps working. Encrypting the vectors themselves is what would break search — do NOT do that.
- **Design decision:** which encryption layer + key management; encrypt-on-write / decrypt-on-read in the indexing + retrieval code.

### 1.2 Internal-index minimization (prerequisite question)
- Before encrypting: does the internal index need to store full unredacted text, or only what search genuinely needs? Storing less raw text reduces the exempt-content exposure before encryption even applies. (Public-library embeddings are on cleared/published content — not sensitive; the exposure is specifically the internal/staff index.)

---

## Category 2 — Build after demo, before full release (no impact on request processing)
Defer until demo-ready. None of these change how requests are processed or how search works, so the demo copy runs fine without them.

### Access & identity
- **2.1 Authentication strength** — password policy; multi-factor (MFA/2FA) for staff login. A weak admin login bypasses all parsing/AI hardening.
- **2.2 Access-control granularity** — roles properly limit who can see unredacted originals vs. cleared copies.

### Data protection at rest / in transit
- **2.3 Secrets & credentials encryption at rest** (was BACKLOG R5) — Anthropic/Voyage/SMTP/Resend/Bedrock keys in `system_config` and connector creds in `record_repositories.config` are plaintext. Encrypt at rest (envelope encryption / secrets store).
- **2.4 Volume/disk encryption at rest** — transparent OS/cloud-level encryption of the DB volume (protects stolen disks / decommissioned hardware). Ops/deployment; app-transparent.
- **2.5 Backups** — encrypt DB backups and secure where they live (a backup carries the same exempt content; classic leak vector).
- **2.6 Data in transit (TLS)** — encrypt DB and internal service connections, not just the browser-facing side.

### Hygiene & monitoring
- **2.7 Logging hygiene** — ensure record text / PII / keys never land in application logs (often less protected than the DB).
- **2.8 Ops hardening (from BACKLOG R8)** — restrict outbound network egress; `unattended-upgrades` for parser packages; antivirus scan on upload (e.g. ClamAV); file-integrity monitoring; reduce the 1 GB upload cap.

---

## Already DONE (not deferred)
- **De-root** — app + parser subprocesses run as non-root `optimumq` (2026-07-05).
- **Prompt-injection first pass** — security preamble + untrusted-data sandboxing on the public agent, verified (2026-07-05).
- **Document-parsing audit** — safe patterns confirmed (no-shell execFileSync, isolated parsers, timeouts, no XXE); see `DOCUMENT_PROCESSING_SECURITY.md`.

## The independent bar (separate from all the above)
A professional third-party **penetration test** before production (police/CJIS records) — the internal self-assessment suite (when built) raises the floor but does not replace it. See `BUSINESS_LEGAL_IP_LOG.md` for the disclosure/liability reasoning.
