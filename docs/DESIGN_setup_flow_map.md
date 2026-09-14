# Setup-flow map — connectors, discovery and the census (markup item 5)

**Purpose.** Kevin's 2026-09-13 markup, item 5: a discussion of what "Configure with AI", "Scan source", "Find variants"
and fingerprint discovery each do today, their limits, and the optimal flow. This document is the factual half, verified
against the code and the live database on 2026-09-14, plus a proposed target flow and the decisions it needs. It feeds
item 6 (the Document Inventory / Census build, design closed 2026-09-04). Nothing here is built.

Related: `SPEC_sources_imports_connectors.md` (sources), `SPEC_taxonomy_classification.md` §1 and §4 (variants, fingerprint
census, schema discovery), `DESIGN_setup_interdependencies.md` (what links what), HANDOFF 2026-09-04 (inventory design, three
rounds).

## 1. The four mechanisms today

| | Configure with AI | Scan source | Find variants | Fingerprint census |
|---|---|---|---|---|
| **Where** | Record Sources → "Configure with AI" (`SourcesConfig`) | `/discovery` (`SchemaDiscoveryPage`) — **no navigation entry**; reachable only by typing the URL | Taxonomy → any bucket row → "Find variants" | Inside Find variants only; not a screen or a button of its own |
| **API** | `POST /repositories/ai-configure` | `POST /taxonomy/discover-scan` (and `POST /taxonomy/discover`, paste a description → one draft type) | `POST /taxonomy/record-types/:id/discover-variants`, then `POST …/:id/variants` per approval | `schemaDiscovery.fingerprintCensus` → `document_fingerprints` |
| **Reads** | Your free-text description of the system plus pasted documentation (≤12,000 chars) and the 11-entry connector registry | `connector.scan()`: filestore = the top folder only, `.pdf` only, **alphabetical first 50**, 1,500 chars each; structured = every table of a JSON definition file. The digest is cut at 14,000 chars, so roughly **9 files' text** reach the model | The bucket's linked ACTIVE sources. File-backed → fingerprint census (right column). Anything else → the same 50 / 1,500 / 14,000 sample digest as Scan source | Every `.pdf` at the top level of each file-backed source, hashed and read once (persistent, hash-keyed; re-read only when the file or the feature version changes) |
| **AI's job** | Pick the connector type, propose a name and config, list what it cannot infer. Never invents credentials | Identify the distinct record types in the sample; match an existing type or propose a new one, with the full 31-column metadata | Non-file path: group the sample into sub-kinds with a share. File path: **name** the clusters it is handed (two first-page excerpts of ≤1,100 chars + the label set per cluster) | None. 10 layout features; two documents match at 8-of-10; union-find clusters of ≥3; recognition against approved variants' stored signatures runs before clustering |
| **Writes** | **Nothing.** The proposal is poured into the source editor; the human saves | **Immediately**, no approval step: draft record types (`status='draft'`, `source='discovered'`) **and** `record_type_repositories` links for both matched and new types | Scan writes nothing. Each approval inserts ONE draft variant (parent + category aligned), stamps the cluster's fingerprints, writes the variant's source links from where the documents actually live, stores the consensus signature | Fingerprint rows per document (`repository_id`, filename, hash, features, `matched_record_type_id` once approved) |
| **Gate** | SYSTEM_ADMIN / DIRECTOR (source config) | SYSTEM_ADMIN / DIRECTOR (taxonomy write) | Scan: any signed-in user. Approval: taxonomy write | n/a |
| **Model** | claude-sonnet-5, 1,000 tokens | claude-sonnet-5, 3,500 tokens | sample path 3,000; naming path 12,000 tokens | none |

**Which connectors can be read at all.** The registry declares `scan` for exactly two connector types, filestore and structured,
and the discovery service's own connector map holds the same two. Laserfiche, Tyler, Axon, the 911 emulator, email and the paper
index are `search`-only: nothing can enumerate their holdings today. Only filestore exposes `listFiles`, so the fingerprint census
runs on network drives and nowhere else.

**Live state, 2026-09-14.**

| | |
|---|---|
| Sources | 19: 10 filestore drives, 2 paper indexes, 1 each of structured, Tyler, Laserfiche, Axon, 911, email, import |
| Fingerprints | 298 documents across 5 drives; 160 stamped to a variant (all Development Services Shared Drive), 138 unassigned (Finance 70, Public Works 40, Police 20, Sample drive 8) |
| Record types | 76 seeded active · 7 discovered active · 8 discovered drafts (all variants of Building permits) · 1 manual |
| Buckets with no source | 53 of 84 (per the interdependency census) — invisible to Find variants, which only reads linked sources |

## 2. What the map exposes

1. **The dependency runs backwards.** Find variants and the census only read sources already linked to a bucket. The only thing
   that writes those links automatically is Scan source, the weakest path (nine files, top folder, alphabetical). Otherwise a
   human links each drive to each type by hand before discovery can see it. A drive linked to nothing is never read.
2. **No source-level view of holdings exists.** Nothing answers "what is on this drive" until some bucket linked to it is
   variant-scanned. This is the missing holdings / liveness display already recorded in the connector findings batch.
3. **Scan source writes without approval.** Draft types are harmless (drafts do not classify), but the source↔type links it
   inserts are live at once and drive record search. Every other AI path in the system proposes and a human approves.
4. **Two AI sampling paths still coexist.** Scan source and the non-file branch of Find variants share the 50 / 1,500 / 14,000
   sample digest, with the alphabetical skew that the fingerprint census fixed for drives on 2026-08-14.
5. **Top folder only, PDFs only.** Every filestore read (`scan`, `countAll`, `listFiles`, keyword search) lists one directory
   level and filters to `.pdf`. Sub-folders and non-PDF files are invisible.
6. **The census is layout-only.** It cannot tell departments apart in an enterprise-wide store and skips image-only files
   (OCR / vision fingerprinting parked 2026-08-14). Both are known and documented; they bound what step 3 below can do alone.
7. **Configure with AI stops at configuration.** It does not test the connection and learns nothing about the holdings — the
   test-connection and default-inactive items of the connector findings batch still stand.
8. **`/discovery` is an orphan.** The page that runs Scan source has no navigation entry since the setup-hub conversion.

## 3. The target flow (proposal)

Kevin's sketch: connector → census / inventory → AI discovery associates record types to groupings. Mapped onto what exists:

**Step 1 — Connect.** Record Sources → Configure with AI (as today) → save → **test the connection** → the source becomes
active. No knowledge of the holdings is needed or claimed here.

**Step 2 — Census, per source, taxonomy-free.** The 2026-09-04 design: a "Perform Census / Generate Inventory" button on the
source, one source at a time, a background job with progress. Documents: fingerprint every file (walking sub-folders), group
by 8-of-10 layout match into **Identical Groupings**, bucket readable / needs OCR / unsupported, break down by file type.
Data systems: enumerate kinds, counts, fields, date ranges. Result: the **Inventory Information** screen per source. The census
needs no record type linked, which removes the backwards dependency in §2 item 1 and gives every drive a holdings view at once.

**Step 3 — Associate, over groupings not files.** AI discovery runs on the census output: for each grouping, recognition by
stored signature first (an approved variant's template found on a new drive is counted, never re-proposed), then one small
naming / matching call per unrecognized grouping (two excerpts, the label set, the exact count) that either matches an
existing type or variant or proposes a new one. **Human approval writes everything**: the type↔source link, the fingerprint
stamps, the draft variant, the signature. This is the existing Find variants approval path, fed by the census store instead of
a fresh scan, and it replaces Scan source outright (the sample digest has no remaining job on a censused source).

**Step 4 — Bind.** Templates seeded from grouping samples (item 7), estimate profiles, routing, legal gates — all hang off the
type or variant the approval created, as they do today.

**What changes on the screens.** Configure with AI stays. Record Sources gains the census button, progress, and "View Inventory
Information". Scan source retires (or `/discovery` becomes a door into census → associate). Find variants stays where it is
but reads the census store: "review the unassociated groupings of this bucket's sources", same modal, same approval. The
paste-a-description endpoint can stay as a manual "propose a type from a description" helper on the Taxonomy page. The
"Find Same-Format Records" nav label becomes "Identical Grouping" in the same build (rename once, as decided).

**What is retired.** The 50-file sample digest in both places. Immediate link-writing without approval. The orphan route.

## 4. Decisions for Kevin

1. **Order and decoupling.** Confirm connector → census → associate → bind, with the census runnable on a source that has no
   record type linked yet.
2. **Scan source.** Retire the page, or keep `/discovery` as a door into the census? (Recommend retire; nothing it does survives
   a censused source.)
3. **Links on approval only.** Association proposals write type↔source links only when a human approves (recommend yes; this
   is what Find variants already does and what Scan source does not).
4. **Sub-folders.** The census walks sub-folders. Should the folder path be offered as a grouping hint alongside layout
   (a department's drive is usually organised by record series)?
5. **Non-file sources.** For Laserfiche and the other `search`-only systems a census means API enumeration, which needs a real
   API and is not built. Until then: no census for them, and hand-linking stays. Is the legacy sample-digest path kept as a
   fallback for them, or retired with Scan source?
6. **Enterprise-wide stores.** The census cannot separate departments by layout (§2 item 6). Guidance stays as recorded on
   2026-09-14: link buckets to their own department's sources; the approving human is the check; re-parenting is the repair.
   Confirm that no per-grouping department field is wanted.

## 5. What this hands to item 6 (build sketch, for the mockup session)

1. Census job per source: recursive file walk, fingerprint rows gain file type, readable / OCR / unsupported and a census-run
   id; a per-source census table (started, finished, counts, incremental diff against the last run).
2. Inventory Information screen: totals, buckets, file types, Identical Groupings with counts and template status, linked
   types and variants, last census; a "view a sample document" snapshot per grouping (Kevin's add).
3. Associate step: recognition + naming per unassociated grouping; approval writes links, stamps, variant, signature.
4. Find variants rewired to the census store; Scan source retired; nav rename to Identical Grouping.
5. Data-system census (kinds and render recipes; the field-redacted embed tiers) — after documents are done.
