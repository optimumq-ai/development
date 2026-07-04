# Deployment & Implementation Strategy

**Status:** working strategy — to refine. Captured from design discussion.
**Owner:** Kevin Hargrove
**Purpose:** How Optimum Q is implemented at a customer, and how that implementation itself becomes a differentiator rather than the usual "consultants on site, data conversion, this phase takes N months, blah blah."

---

## 1. The core idea: front-load history during an extended setup window

The central proposition:

> Process the **entire history** of records into the public-ready library **during** an extended setup phase, so that at go-live the historical corpus is already searchable and downloadable with **zero per-request labor**.

This inverts the usual govtech onboarding. The typical pitch is "install and go, then labor continues forever." Ours is **"invest heavily up front, then labor drops permanently."** A long setup window (~4 months as a working figure) is not a weakness to apologize for — it *is* the value proposition:

> "We want to push your go-live date out far enough to convert your records from System A, System B, System C, etc. to public-ready, so that on day one a large share of requests are self-service, with zero staff hours and zero redaction labor per request."

Cities are paying a lot of money for so-called public-record libraries that are only daily dumps from a small subset of systems, with no mass redaction of PDFs and an archaic, hard-to-use interface. The front-loaded, all-systems, AI-redacted approach is a genuinely stronger story.

### The payoff — stated cleanly (three wins)

1. **Zero per-request redaction labor** for anything already in the library.
2. **Near-zero fulfillment time** — instant download.
3. **Fewer requests reaching staff at all.**

**Correction / caution:** Do **not** tie the payoff to "no records closed for non-payment because the requestor pays in full to download." That payment/closure benefit is a property of the **self-service library model generally**, not of the setup-window front-loading specifically. Keep the two arguments separate so the front-loading case stays airtight.

---

## 2. The connector question — set expectations honestly

"Connector" is a **spectrum, not a binary.** The "just enter a location and credentials, done" experience is real for *some* systems and a fantasy for others. Over-promising here is the fastest way to a damaged reputation.

### What determines whether a connector is plug-and-play

1. **Does the source have a usable API?** Modern cloud systems (M365 email via Graph, Google Workspace) do. Many govtech systems (CAD, RMS, legacy county systems) do not — they are export-only, or hide behind a proprietary/SOAP interface.
2. **Is the auth standard?** OAuth / API key is easy. A service account the *source admin* must provision with specific read scopes is a one-time human step in **every** case — never zero.
3. **Is the schema standard, or per-install?** The hidden one. Even a "prebuilt" connector usually needs someone to map *this* customer's fields to our model. Connector **depth** matters more than connector count.

### The three tiers — sell connectors this way

- **Turnkey** — enter credentials, map a couple of fields, done. Standard-API cloud systems.
- **Configured** — API exists but needs field mapping / setup; no code, but expert-guided. Most established govtech systems with an API.
- **Custom or export-based** — no usable API, proprietary, or on-prem behind a firewall. Needs either a built connector (real engineering / professional services) *or* the export/drop-folder pattern.

### The universal fallback: export / drop-folder (push)

The **export/drop-folder pattern works with virtually any system that can export a file.** No API required, no standing credentials for us to hold, customer stays in control of what leaves their system. This is the honest "we can *always* integrate you" claim — even a decades-old CAD system can be scheduled to drop a nightly CSV somewhere we watch.

### What NOT to promise

- Do **not** promise that every source is a credentials-and-go connector.
- Do **not** promise that no configuration or expertise is ever involved.

The safe, always-deliverable claim is about **pattern coverage**, not universal plug-and-play:

> "We integrate through standard patterns — a direct connection where your system supports it, or a simple scheduled export where it doesn't — so we can work with essentially any system."

### Our honest edge: AI-assisted mapping

The field-mapping/schema step is the hidden labor in *every* integration. Our **AI-assisted schema discovery** (auto-discovery + approval queue) directly reduces that labor. The honest framing: **not "no work," but "the tedious mapping work is AI-accelerated and human-approved."**

---

## 3. What an AI agent can (and cannot) do for connectors

Friends' "an AI agent set up the API/connector and it was trivial" experiences are real — but they were almost certainly connecting to **popular, modern, well-documented cloud APIs** (Stripe, Google Sheets, etc.): clean REST, abundant public docs and code examples the model trained on, standard OAuth. The AI wasn't doing magic — it was pattern-matching a well-trodden path.

**Govtech systems are the opposite on all three counts:** little/no public API documentation, few or zero public code examples, proprietary or SOAP interfaces, per-install quirks. The thing that made the friends' experience magical — abundant public precedent — is exactly what's missing here.

**Headline:** AI genuinely simplifies connector work, but the amount of simplification is proportional to how public and standard the target system is. Govtech sits at the hard end.

### Where AI helps a lot
- **Schema discovery & field mapping** — once data is *reachable*, AI is excellent at inferring what unfamiliar fields mean (`CALL_TYP`, `RP_ADDR`, etc.) and which are PII. This is our real, durable advantage.
- **Configuration assistance** — given a system's docs, AI can guide an admin through what to configure and what permissions to request.
- **Error diagnosis** — reading an error/payload and proposing the fix.

### Where AI helps less than the hype implies
- It **cannot conjure an API that doesn't exist** → fall back to export/drop-folder.
- It **cannot grant itself credentials** → the source admin must provision access, every time.
- It **cannot safely improvise against an undocumented proprietary system** → with no examples to learn from, a guessing AI is a liability.

### The reframe that favors us
**Export/drop-folder + AI-assisted mapping is a strong combination for govtech specifically.** Almost any system can export a file, and AI is very good at making sense of an unfamiliar exported file:

> "Even if your system has no modern API, have it export a nightly file, and our AI will figure out the fields and set up the redaction and publishing automatically."

Careful: the pitch is that **AI accelerates the mapping/setup once connected** — not that "AI configures the connector itself" for the hard-tier systems.

---

## 4. The 911 example, worked through

- Choosing **push (nightly CAD export)** means **no connector needed for the ongoing daily flow.**
- But the daily push only handles records **going forward.** The **historical back-catalog** (years of prior calls) still has to get in.
- If the CAD admin can export the **entire history as a large file (or a few files)** we process during setup, we **never need a live connector at all** — history via a big one-time export, daily deltas via nightly push.
- If history **can't** be exported that way, a connector becomes necessary to pull the back-catalog.

**General rule:** *Connector-vs-no-connector is decided by whether the system can bulk-export its history, not by the daily flow.*

### The lag gap (real, and fine)
There is an unavoidable window between "record created in CAD" and "record live in the public library" (export lag + processing time, on the order of ~a day). A request landing in that window simply flows through normal processing; because the record hits the library within roughly a day anyway, the lag is immaterial. **Daily** push cadence keeps the gap to ~a day; a weekly export would widen it — so cadence is part of the SLA story.

### Pull vs. push — offer both; let the customer's politics decide
Upper management likes control. A director who can **own** their extract will prefer that over depending on another department — **unless** offloading frees significant labor.

- **Control-preferring customer → push model:** *they* own the export job, on *their* schedule, from *their* system; they drop a file where we can see it. Minimum friction for their IT security (we never touch their system).
- **Labor-offloading customer → pull model:** they grant us read access once; we do the extracting forever. More convenient, but requires giving an outside system standing credentials.

Either way there is a **one-time access grant** — pull requires read credentials we hold; push requires them to grant their own export job rights + a drop location. The difference is *who holds the standing credential.*

**Product preference:** build **pull from our side where possible** as a capability, but design the seam to accept **either** pull or push. That flexibility is itself a selling point.

> Implemented in the demo: the 911 emulator now models the CAD system as its own accumulating store and Optimum Q pulls only the delta since a stored **watermark/checkpoint** — the same seam a real pull connector or a watched export drop plugs into.

---

## 5. Data records vs. documents — the most important technical split

### Structured data records (911 CAD, most database-backed systems) — fast & cheap
Fielded data (CSV / DB export), exempt values in **known columns**, born-redacted structured redaction drops those columns deterministically. Huge volumes process quickly as single or few jobs. **This is the category where "process the entire history during setup" is very realistic.**

**Correction — structured ≠ automatically safe.** Structured systems frequently include a **narrative / comments / notes** free-text field (our own 911 generator has a `narrative` column) that can contain names, addresses, or other exempt content. Structured records are fast to redact **for their fielded columns**, but any **free-text field** within them needs the same variable-content scrutiny as a document. "We can bulk-process all structured data risk-free" would be a slight over-promise.

### Documents (PDFs, scanned forms, meeting minutes) — slower & more variable
- A document repository tends to be **many form types, each with a moderate file count** — often fewer files per type than 911 generates in days. Per-type batches are manageable; "~two hours a night until complete" is realistic.
- The **hard case** is PDFs where exempt content appears in **variable locations** (free-form narrative, body text) rather than fixed positions. Fixed-position forms are template-friendly and fast; variable-content documents need per-document review and are where labor concentrates.

**Correction — for documents, the effort is template configuration, not the connector.** For a simple network-attached file share, connector complexity is a non-issue. The effort is **building the redaction template (zones/rules) per form type** and handling the variable-content documents that resist templating.

---

## 6. Priority order for front-loading

1. **Structured data systems with bulk export** (911 CAD, permitting DBs, ERP) — highest priority. Fast, cheap, often **connector-free** (bulk history export + nightly push). Biggest ROI.
2. **Document file shares (NAS) with fixed-layout forms** — simple connection/export, one template per form type, batch overnight.
3. **Variable-content documents** — the residual that can't be fully front-loaded; some per-request labor remains. Be honest that this slice doesn't go to zero.
4. **Document management systems (Laserfiche, etc.)** — the genuine unknown.

### On Laserfiche specifically
Very common in local government; it **does** have an API and reasonable documentation, so a connector is feasible and not exotic. But **verify against current Laserfiche docs when a real customer requires it** — do not assert specifics about how it stores documents from memory. A connector is probably unavoidable for a DMS; mitigation is a well-documented connector and/or the customer's own admin who knows their system.

---

## 7. The honest reframe of the connector pitch

Drop: "connectors configure quickly with little to no effort and no consultant."

Adopt:

> "For structured-data systems, we often need **no connector at all** — a one-time history export plus a nightly export feed. For file shares, connection is trivial. For document-management systems, we use a connector, and our AI does the heavy lifting of understanding your fields and content. The historical back-catalog is processed **during setup**, so you go live with your records already searchable — and the setup work is front-loaded and AI-accelerated, not an ongoing consultant engagement."

Keeps the strong claims (no-connector where possible, AI-accelerated, front-loaded labor); drops the one that would burn us (universal effortless connectors).

**Product implication:** the Sources list should distinguish **"direct connection"** from **"scheduled import/export,"** so the UI itself tells the honest story. The watermark/drop-folder capability is what makes the universal-fallback claim real.

---

## 8. Throughput & setup-window sizing (measured)

These resolve the two headline open questions. Numbers are from the live pipeline, with caveats stated so they hold up in a real conversation.

### 8.1 Single-job / single-window ceiling — structured records

**Measured:** the full born-redaction pipeline for structured records (drop exempt columns -> render clean PDF -> deposit -> publish -> geocode -> embed/index) runs at **~230 ms/record, single-threaded** = **~260 records/min ~= ~15,000 records/hour**. Over a 12-hour overnight window that is on the order of **~180,000 records/night, single-threaded**, before any parallelism.

**The current policy budget is 500 records/night** (`mass_redaction_nightly_budget`, default 500). That is a **safety throttle, not a hardware limit** — it sits ~100-300x below the measured hardware rate and can be raised freely.

**Honest caveats on the measured number:**
- It uses the **deterministic demo geocoder** (no network). In production, geocoding depends on the geocoder chosen: public Nominatim is rate-limited (~1 request/second) and would dominate; a commercial or self-hosted geocoder is fast. **Geocoding rate is a deployment choice, and for a large back-catalog it may be the binding constraint — validate with the chosen geocoder.**
- Embedding (Voyage) is a real external API call and is the main non-trivial cost in the measured figure; it is batchable and parallelizable.
- The **born-redaction step itself is nearly free** for structured data — the variable cost is the external services (geocode + embed), not the redaction engine.

**Planning takeaway:** for structured/data records, the redaction engine is **not** the bottleneck. Even a large city's multi-year structured history (911 CAD, permitting, ERP — often 1-5M rows) processes in **days, not months**, at hardware rates. The real constraints are (a) how fast the source can export/ingest, and (b) external-service rate limits (geocoder, embeddings) — both addressable with batching, parallelism, and the right service choices. A single job larger than one night's budget simply spans multiple nights (the UI already shows "~N nights").

### 8.2 Documents — a different animal

Not yet measured directly (no page-redaction template exists in the demo to time against; 132 PDF files are on hand but need a template). Reasoned honestly:

- Per-document cost is heavier than a structured record: PDF render, possibly OCR, multi-page, box stamping.
- For **fixed-layout forms**, this is still machine-fast once a template exists.
- For **variable-content documents** (exempt content in variable locations), the limiter is **human review, not machine time.**

So document setup time is driven by two human/config factors, not throughput:
1. **Number of distinct form types** needing a template built (one-time config per type).
2. **Volume of variable-content documents** needing per-document review.

**TODO:** measure the page-redaction path against a representative multi-page form once a pages template exists, to get a real fixed-layout document rate.

### 8.3 Setup-window length — what actually drives it

**Conclusion: the setup window scales with document diversity and variable-content volume — NOT with structured-record count** (which is fast enough to be a rounding error).

Rough planning bands by customer profile (to refine with real pilots):

- **Data-heavy, few document types** -> short window (on the order of **weeks**). Structured history bulk-exports and processes fast; little template config.
- **Mixed** -> **1-2 months.** Structured is quick; the time goes to building templates across the common form types and reviewing the variable-content slice.
- **Document-heavy, many form types, large variable-content archive** -> **~3-4 months.** This is where the headline "~4 months" is justified — it is **template-building + review labor**, not machine throughput.

State it this way to the customer: *"Setup scales with your archive's document diversity, not its size. Your structured records — the bulk of the volume — process in days. The window length is about how many distinct document types we template and how much variable-content review your archive needs."*

---

## 9. Remaining open questions / TODOs

1. **Free-text scrutiny in structured records.** Operational plan for narrative/notes fields inside otherwise-structured exports (auto-flag for review vs. AI redaction vs. hold).
2. **Sources UI: direct vs. export labeling** (product task noted in §7).
3. **Document-path rate** (from §8.2): measure fixed-layout page-redaction throughput against a representative form.
4. **Production geocoder validation** (from §8.1): confirm the geocoding rate under the chosen production geocoder before quoting large back-catalog timelines.
