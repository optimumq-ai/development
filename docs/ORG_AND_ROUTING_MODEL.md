# Optimum Q — Org, Routing & Assignment Model

> Source of truth for how Optimum Q models the city organization (City Departments vs Request Fulfillment Teams vs Custodians), how a request is classified and routed to a team, and how Smart Routing assigns it to a person. Captures decisions and known gaps from the 2026-06-30 architecture review. Pairs with TAXONOMY_DESIGN.md (the record-type catalog) and WORKFLOW_DECISIONS.md (every decision point in a request's life).

**Status legend:** BUILT = live today | PARTIAL = partly built | DORMANT = field/scaffold exists but nothing reads it | PLANNED = designed, not built | DECISION = agreed direction, not yet implemented

---

## 1. Terminology — three distinct concepts, one meaning each

These three are routinely blurred (including in casual conversation and in some older code/doc content). Each gets exactly one meaning going forward:

- **City Department** — an organization on the city org chart that *owns / originates* records (e.g. Police Department, Building & Planning). In the data: `departments` rows with `kind = 'department'`. UI label app-wide: **"City Department"**.
- **Request Fulfillment Team** — the open-records unit that *processes and fulfills* requests (e.g. Open Records, Police Records Unit). In the data: `departments` rows with `kind = 'team'`. UI label app-wide: **"Request Fulfillment Team"**.
- **Custodian** — records-law sense: the City Department / official *responsible for* the records. This is NOT the fulfillment team. Today the word "custodian" is overloaded three ways and must be disambiguated:
  1. `classifier.js` returns the owning City Department as `custodianDepartmentId` (custodian = owning City Department). KEEP this meaning.
  2. There is a `CUSTODIAN` *user function-role* (a person who performs custodial duties). Always say "Custodian **role**".
  3. `AWAITING_CUSTODIAN` in the workflow = the internal party (a City Department/person) we are waiting on to produce responsive records. Aligns with meaning 1 (the owning department).
  RULE: "custodian" = the City Department responsible for the records. Never use "custodian" to mean the fulfillment team.

**Known naming wart (BUILT, harmless, invisible to users):** a request's fulfillment team is stored in a column named `requests.department_id`, and a staff member's team is stored in `users.department_id`. These columns hold a TEAM, not a City Department. Record types correctly store their owner in `record_type_departments` (role='owner') / `owner_department_id`, which is a City Department. The column name is a holdover from before teams existed as a concept. Renaming it is a longer-term cleanup; today the UI labels are correct so users never see the mismatch.

---

## 2. Org data model

One `departments` table, distinguished by `kind` ('department' = City Department, 'team' = Request Fulfillment Team). Two relationships connect them:

- `team.parent_id -> department` — "this team is OWNED BY this City Department." Forced single owner. Every team currently has one.
- `department.processed_by -> team` — "this City Department is SERVED BY this team." This is the relationship that actually drives request routing, and it already supports a shared team: e.g. **Open Records serves four City Departments** (Building & Planning, Parks, Public Information, Public Works).

**The limitation:** `parent_id` forces every team into exactly one owning department, which is already arbitrary in practice — Open Records is "owned by" the City Clerk but serves four departments. An "Emergency Services" team serving both Police and Fire breaks the ownership model (you must pick one owner) but works fine on the `processed_by` side (point both departments' `processed_by` at it).

**DECISION:** Treat a Request Fulfillment Team as a **free-standing unit**. Model its connection to City Departments purely as a **"serves these departments" association**; drop or demote `parent_id` (the forced ownership). The cleanest UI is a team-side multi-select ("Emergency Services serves: [x] Police [x] Fire"), which is the same `processed_by` data shown from the team's side. `processed_by` already supports many-departments -> one-team. A department served by *multiple* teams (one dept -> many teams) is the only case not expressible today and would need a small junction table — build only if a real need appears.

**PREREQUISITE before removing `parent_id`:** grep everything that reads it (it may quietly drive UI grouping, a default-team suggestion, or a permission scope). Then delete it or demote it to an optional "home department" label, with the serves-association as the single source of truth.

---

## 3. Repository / system ownership

Repository ownership by a City Department is more meaningful than team ownership, but gets fuzzy when records live in an enterprise DMS that IT runs. Separate two ideas:

- **Authoritative / owning City Department** — who is responsible for and answers for those records.
- **System custodian** — who runs the platform (often IT).

One repository can be IT-custodied but Police-authoritative. The design anticipates this with `is_authoritative` + a primary-department field on repositories (see TAXONOMY_DESIGN.md). Make the distinction explicit so "owns the records" never collapses into "runs the server." Status: PARTIAL (fields anticipated, not fully wired).

---

## 4. Classification & routing to a team  [BUILT, with one gap]

`classifier.js :: classifyAndRoute(description)` makes ONE AI call returning TWO independent signals:
- **Step 1 (record-type match):** pick the ONE record type from the agency catalog whose meaning best fits, using record-type names + synonyms/keywords ("also called") + model understanding. Returns code + confidence.
- **Step 2 (department guess):** independently, using general knowledge of city org structure, name the likely department.

The CODE then applies a strict priority:
1. **Taxonomy wins if confident:** record type matched AND confidence >= TAXONOMY_CONFIDENCE AND it has an owner -> route via record type -> owning City Department -> that department's `processed_by` team. `routing_basis = 'taxonomy'`.
2. **General-knowledge fallback:** else use the Step-2 department guess -> its team. `routing_basis = 'general'`.
3. **Catch-all:** else -> the open-records fallback team. `routing_basis = 'unassigned'`.

This is **record-type-first**: when the taxonomy match is confident, the topical department guess is discarded. This is the behavior that correctly routes "text messages framed as accounting comms" to IT (if a Text Messages record type owned by IT exists) and paper-record requests to the actual custodian — PROVIDED those record types are in the taxonomy. Uploading paper-record index catalogs into the taxonomy is what converts these from mis-routes into correct routes.

`routing_basis` (taxonomy|general|unassigned), `record_type_id`, and `classification_confidence` are stored on the request, plus a plain-language `request_history` note explaining the decision.  [BUILT]

**GAP — owner vs fulfiller cannot yet differ:** routing always goes owner City Department -> `processed_by` team. The per-record-type **"Fulfillment team" override** that exists in the Record Type editor (`fulfillment_team_id`) is **not read by the classifier**. So to send a record type to a team other than its owner's default, you currently have to change its *owner*, which collapses owner and fulfiller. **RESOLVED 2026-06-30 (commit 6fa632f):** the classifier now honors the override — a confident taxonomy match whose record type has a `fulfiller` link routes to that team, while the owning City Department stays the custodian; falls back to `owner.processed_by` when no override. Verified end-to-end (body-cam -> IT override, custodian stayed Police). Latent for existing data (0 fulfiller links today). Status: BUILT.

---

## 5. Catch-all / "Unassigned" as a first-class state  [DECISION]

**Problem today:** when the AI can't decide (`routing_basis = 'unassigned'`), it still stamps the team as Open Records. The truth is preserved one layer down in `routing_basis`, but the team column reads "Open Records" for both a genuine Open-Records match (e.g. City Council Transcripts they truly own) and an AI give-up. Any view grouped by team blurs the two.

**DECISION:**
- When `routing_basis = 'unassigned'`, set the team to **Unassigned** (null) rather than borrowing Open Records' name. (A null team already renders as "Unassigned" in the app.)
- "Route unassigned to Open Records" becomes a **queue rule**, not a team stamp: the Unassigned / triage queue is *worked by* Open Records (or a Smart-Routing-designated triage person), but the requests honestly read "Unassigned" until a human places them.
- Smart Routing keys off the Unassigned state to send those to the triage person; the human's placement (chosen team / corrected record type) is captured as **taxonomy-improvement feedback** (feedback loop or manual review).
- Separate "reassigned because the AI couldn't determine" from operational moves (e.g. vacation coverage) using `routing_basis` (a request that *arrived* unassigned and was then placed is a correction) plus an optional **reason code** on manual reassignment, logged to `request_history` (which already records actor + notes).

**Must be built as a UNIT** (classifier change + triage-queue surfacing + Smart-Routing trigger) so unassigned requests are never orphaned with no team and no queue.

---

## 6. Smart Routing — three levels

- **Level 1 — Agent / search rules.** Mitigates errors in the agent's answers and searches during the citizen chat. This is the **Agent Rules** layer — about *answer quality*, NOT assignment. Keep it conceptually separate from Levels 2-3.  [BUILT, separate concern]

- **Level 2 — assigning to a TEAM.** Today this is the taxonomy chain in Section 4 (+ general-knowledge fallback). A `routing_specialization` text field exists on teams (editable in the team editor) but **nothing reads it** — it is inert for assignment.  [DORMANT field]
  The matching mechanism Level 2 wants already exists one tier down at Level 3 (store specialization text, embed it, semantic-match the request, assign on a confident margin). Level 2 = lift that pattern up to the team tier: consult each team's specialization text as a signal before settling on a team or falling to Unassigned. Build is optional / as-needed.  [PLANNED behavior]

- **Level 3 — assigning to a PERSON.**  [BUILT — `taskRouting.js`]
  `autoRouteOrPool(taskId, requestText)`: pull eligible users on the task's team (right team + required permission role + active), semantically rank them by their `routing_specialization`, and assign the top person ONLY IF score >= floor AND lead over runner-up >= margin (basis `smart_routing`, with score). If no confident specialist: if the team has Auto Load Balancing on, assign the least-loaded eligible person (`load_balanced`); else leave in the pool to claim (`claim`). Priority: smart match -> load balance -> pool. Scans specialization for the ASSIGNED TEAM's members only. Person-routing is **task-centric** — it fires when a workflow stage spawns a task (record search / redaction / estimate), each keyed to the request's current team.

---

## 7. Trigger symmetry (intake vs reassignment)

- **Intake:** team is set by the classifier -> a stage task spawns (e.g. estimate) -> `autoRouteOrPool` runs within the assigned team. Person-routing fires.  [BUILT]
- **Reassignment:** the re-route handler updates the request's team and, if the previously-assigned person isn't on the new team, **clears** that person — but it does NOT re-run person-routing for the new team, and it does NOT move existing open tasks' `team_id` to the new team.  [GAP]

**DECISION:** On manual team reassignment, fire the same person-matching code for the newly assigned team (and move open tasks' `team_id`), so reassignment behaves symmetrically with intake — match to an individual on the new team if confident, else the new team's pool. (The re-route handler already uses correct language — it requires "a fulfillment team" and validates `kind='team'` — so only the re-route *behavior* is incomplete, not the terminology.)

---

## 8. Onboarding vision — guided taxonomy/org builder

Two layers: the **universal record-type catalog** (ships as a curated template, ~55-75 types/13 categories, rarely changes) and the **agency overlay** (which City Departments exist, which Teams serve them, who owns each record type, where records physically live). Onboarding builds the overlay. Taxonomy ships as a curated template + AI-assisted discovery — NOT blank, NOT pure auto-discovery. (See TAXONOMY_DESIGN.md.) The business-license ownership question is purely an overlay decision (which City Department owns it) — exactly what an agency reorganizes.

Optimal flow = a guided wizard that ORCHESTRATES existing capabilities with a human approval gate per phase:
- **Phase 0 — Jurisdiction:** pick state -> Jurisdiction Profile (statute, deadlines, exemptions).
- **Phase 1 — Org chart:** start from seeded standard City Departments; confirm/add/delete/rename; optionally pre-fill from an uploaded org chart or the city's Departments page.
- **Phase 2 — Teams:** define Request Fulfillment Teams and associate each to the City Department(s) it serves (the serves-association from Section 2).
- **Phase 3 — Ownership pass:** confirm the owning City Department (and serving team) for each record type; propose smart defaults. This is where the business-license question is answered once.
- **Phase 4 — Repositories + discovery:** connect each department's source systems, then run `schemaDiscovery` per repository (scan samples -> match to template types or propose new ones as drafts -> staff approve/edit/reject), wiring where each type's records live.
- **Phase 5 — Redaction readiness:** flag types with likely PII, suggest layout profiles, queue high-volume types for mass redaction.

**Built to lean on:** `schemaDiscovery.js` (real: scan repo samples -> AI match/propose -> drafts in an approval queue -> link to repo), department management, `record_type_departments` (ownership), `record_type_repositories` (type<->repo, incl. the connector **"Found in these sources"** checkbox list per record type, written by discovery AND manual toggle), `record_repositories` (connectors w/ scan()), `config_proposals`, `zoneDiscovery.js`.
**Shallow gaps:** org-chart import; repository<->department link (`primary_department`); the approval-queue UI for discovered drafts; the wizard orchestration.
**Net-new:** the Teams-serve-Departments association as a first-class thing; redaction-suggestion step wiring.
**Where AI genuinely earns it:** org-chart parsing, ownership-default suggestion, schema discovery (the hard, valuable part), PII detection. The team<->department wiring and connector forms are mostly structured config — AI can pre-fill but shouldn't masquerade as magic.

Taxonomy is currently **flat** (category -> record type). Granular sub-types / a status facet (e.g. application vs issued permit, single-family vs industrial) are DEFERRED — the same decision the application-vs-issued search test reinforced.

---

## 9. Proposed code changes — prioritized, NOT yet built

| # | Change | Status | Contained? | Notes / depends on |
|---|--------|--------|-----------|--------------------|
| 1 | Honor record-type fulfillment-team override (`role='fulfiller'`) in `classifier.js` (let owner != fulfiller) | **BUILT (6fa632f)** | Contained, latent until a type sets it | Section 4 |
| 2 | Catch-all -> Unassigned + triage queue + Smart-Routing trigger | DECISION | Interlocking UNIT (do together) | Section 5; don't ship classifier change alone |
| 3 | Reassignment re-route symmetry (+ move task `team_id`) | DECISION | Medium | Section 7; interacts with #2 |
| 4 | Lift Smart Routing to the team tier (Level 2 team matching) | PLANNED / optional | Medium | Section 6; build if a need appears |
| 5 | Drop/demote `team.parent_id` -> serves-association | **DEMOTE done (26a...); serves-association was already BUILT** | Small | Dependency check done: `parent_id` reads = 1 display-grouping line only, nothing in routing. Team-side "Fulfills requests for" multi-select + `/fulfills` endpoint already existed. parent_id relabeled display-only. FULL removal = optional page-IA refactor (teams only render nested under a parent today; no standalone teams list) - deferred. |
| 6 | Standardize "custodian" to one meaning; (longer-term) rename `department_id`-holds-a-team | Cleanup | Low risk for terminology; rename is larger | Section 1 |

**Sequencing guidance:** implement deliberately, as coherent units, with explicit go-ahead per item — not all at once. #2 and #3 are the interlocking pair (catch-all + reassignment both touch the assign/triage flow). #5 needs its dependency-check first. #1 is the most self-contained. None is a blocker for the current build sprint; all are enhancements/cleanups recorded here so they aren't lost.

---

## 10. Build log (post-review, 2026-06-30)

- **Fulfillment-team override (change #1): BUILT** (6fa632f) - see Section 4.
- **Paper-record routing + Smart-Routing-to-person, verified end to end.** Created record type "Historical Property & Land Records (paper archive)" - owned by Building & Planning, fulfilled (override) by City Clerk Records & Archives, linked to the two paper-index repositories. A paper request classifies to it and routes to the archives team; Thomas Jackson (paper specialist on that team) auto-assigns via Smart Routing.
  - **Smart Routing spec wording matters:** an instruction-style spec ("all paper requests go to Thomas Jackson") scored 0.42, below the 0.45 floor -> pool. A spec that *describes the records handled* scored 0.60-0.70 -> auto-assigns. Thomas's spec was rewritten to the descriptive form. **Static hint: BUILT** (3ce0663) - the Smart Routing description field now steers staff toward concrete record vocabulary over instruction-style phrasing, with good/weak examples inline. This is the cheap floor; see Section 11 for the more effective (undecided) approach.
- **Queue "Assigned To" reflects work state: BUILT** (048dfd6). The request queue derives the current active task and shows "In pool - <team>" (awaiting claim) / "<person> - assigned" (on their My Tasks) / "<person> - working" (in progress) / a manual request owner - instead of a bare "Unassigned." Reminder of the layering: task assignment still does not write `requests.assigned_to`; the queue now reads the task layer directly to show reality. (Assignment happens when the task lands on a person's My Tasks as `assigned`, before they open it; `in_progress` = they've started; `open` = pooled, on nobody's list.)

---

## 11. OPEN / not yet decided - AI-assisted Smart Routing spec authoring

**Status: NOT nailed down. Revisit when the build is near completion; potentially deferred to a future release.**

The static hint (Section 10) is the cheap floor. A more effective way to get good Smart Routing specs was discussed but not decided. Three tiers, increasing value and effort:

1. **Static hint (BUILT).** Guidance text on the field. Helps only those who read and apply it.
2. **Taxonomy-grounded draft + score preview (recommended direction, high value).** Auto-draft a starting description from the record types that route to the person's team - their names/synonyms/keywords are the exact vocabulary that appears in real requests - and let the person curate it. Then show how the draft actually performs: which representative requests it would catch/miss, and whether it over-matches *other* teams' requests (the invisible failure a hint can't catch; cf. Thomas 0.42 -> pool vs 0.65 -> auto-assign). Turns "write good prose" into "trim a proposal and watch the score."
3. **Guided chat agent (flashiest, least efficient for a single field).** Worth it only if the goal is to *elicit* specialties the person wouldn't volunteer, not merely polish phrasing.

Tier 2 is architecturally consistent with the onboarding-vision theme (AI proposes from what the system already knows; human approves) and could be a component of that wizard rather than a one-off. **Decision deferred - discuss near build completion.**

---

*Recorded 2026-06-30 from the architecture review with Kevin. Decisions captured here are the source of truth; update Status as items move to BUILT.*
