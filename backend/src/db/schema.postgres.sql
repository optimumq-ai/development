-- Postgres schema ported from live SQLite. Parity-first: INTEGER booleans kept, money REAL->DOUBLE PRECISION, timestamps kept as TEXT in same format.
CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL, color TEXT DEFAULT '#2E75B6', is_open_records INTEGER DEFAULT 0, is_catch_all INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'department';
ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_id TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS processed_by TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS routing_specialization TEXT;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, title TEXT, department_id TEXT, password_hash TEXT, mfa_secret TEXT, mfa_enrolled INTEGER DEFAULT 0, temp_password INTEGER DEFAULT 0, status TEXT DEFAULT 'active', last_login TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
ALTER TABLE users ADD COLUMN IF NOT EXISTS routing_specialization TEXT;
CREATE TABLE IF NOT EXISTS function_roles (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS permission_roles (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS user_function_roles (user_id TEXT NOT NULL, function_role_id TEXT NOT NULL, PRIMARY KEY (user_id, function_role_id));
CREATE TABLE IF NOT EXISTS user_permission_roles (user_id TEXT NOT NULL, permission_role_id TEXT NOT NULL, PRIMARY KEY (user_id, permission_role_id));
-- Per-person routable task-type subset (v3 role model). Eligibility = active + on team + subset includes the task type.
CREATE TABLE IF NOT EXISTS user_task_types (user_id TEXT NOT NULL, task_type TEXT NOT NULL, PRIMARY KEY (user_id, task_type));
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, request_number TEXT UNIQUE NOT NULL, is_mrr INTEGER DEFAULT 0, master_request_id TEXT, component_label TEXT, requestor_name TEXT NOT NULL, requestor_email TEXT NOT NULL, requestor_phone TEXT, requestor_type TEXT DEFAULT 'individual', delivery_method TEXT DEFAULT 'email', description TEXT NOT NULL, record_types TEXT, classification TEXT DEFAULT 'standard', department_id TEXT, assigned_to TEXT, stage TEXT DEFAULT 'intake', status TEXT DEFAULT 'active', closure_reason TEXT,
 fee_waiver_requested INTEGER DEFAULT 0, legal_flag INTEGER DEFAULT 0, legal_flag_type TEXT, deadline_date TEXT, submission_channel TEXT DEFAULT 'portal', created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS request_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, details TEXT, notes TEXT, stage_from TEXT, stage_to TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS fee_matrix (id TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT, rate DOUBLE PRECISION NOT NULL, unit TEXT NOT NULL, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS request_files (id TEXT PRIMARY KEY, request_id TEXT, repository_id TEXT, filename TEXT NOT NULL, original_name TEXT NOT NULL, mimetype TEXT, size INTEGER, status TEXT DEFAULT 'attached', responsive INTEGER DEFAULT 0, uploaded_by TEXT, uploaded_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS agent_rules (id TEXT PRIMARY KEY, rule_text TEXT NOT NULL, enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 100, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), created_by TEXT);
CREATE TABLE IF NOT EXISTS demo_911_calls (seq BIGSERIAL PRIMARY KEY, call_id TEXT, call_type TEXT, priority TEXT, received_at TEXT, caller_name TEXT, caller_phone TEXT, caller_address TEXT, incident_location TEXT, responding_units TEXT, disposition TEXT, narrative TEXT, created_at TEXT, pulled INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS demo_documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, body TEXT, department TEXT, doc_type TEXT, date_created TEXT, page_count INTEGER, public_availability TEXT DEFAULT 'available', tags TEXT);
CREATE TABLE IF NOT EXISTS email_verifications (token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), verified_at TEXT, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS record_repositories (id TEXT PRIMARY KEY, name TEXT NOT NULL, connector_type TEXT NOT NULL, status TEXT DEFAULT 'active', config TEXT DEFAULT '{}', sort_order INTEGER DEFAULT 100, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS request_selected_records (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, record_id TEXT NOT NULL, title TEXT, source_system TEXT, public_availability TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));

-- ============================================================================================
-- R9 — SEARCH-COMPLETENESS INTENT + THE REFINE LOOP  (DESIGN_split_canvas_intake.md §R9 + §4b)
--
-- The portal used to flatten intake: every described record's text was concatenated into one
-- `description` string and every selection into one undifferentiated pile. Two things were lost.
--
--   1. WHAT THE SELECTION MEANT. An empty selection read as abandonment rather than "nothing here
--      matches, search for me"; a partial selection was indistinguishable from a complete one, so a
--      request the requestor considered OPEN could be fulfilled from the selected set and closed.
--
--   2. WHAT THE REQUESTOR WAS SHOWN AND PASSED OVER. Those candidates existed only in the chat and
--      died with the session -- so the searcher re-surfaced records the requestor had already
--      rejected, with no way to know.
--
-- One row per DESCRIBED RECORD, not per request. When real parent/child splitting lands
-- (SPEC_tasks_roles_mrr_fees §12), each of these rows IS a child request -- it already carries the
-- child's description, its selections and its intent. This table is the shape that migration wants.
-- ============================================================================================
CREATE TABLE IF NOT EXISTS request_search_intents (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  seq INTEGER NOT NULL,                 -- order the requestor described them in
  description TEXT NOT NULL,
  -- complete       : "these are all the records I want for this description"
  -- search_more    : "these match, but ALSO have the team search for more"  <- fulfilling from the
  --                  selection alone closes a request the requestor considers OPEN
  -- no_match_search: the portal searched and NOTHING matched -- this is an instruction to search,
  --                  NOT abandonment
  -- not_searchable : PATH (b) -- email/audio/photos/data/paper. The portal NEVER searched. Kept
  --                  distinct from no_match_search: the searcher must know which happened.
  intent TEXT NOT NULL,
  queries_tried TEXT DEFAULT '[]',      -- JSON array, in order. NOT bookkeeping: it tells the
                                        -- searcher what the portal ALREADY ran, so they don't repeat it.
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_search_intents_request ON request_search_intents(request_id);

-- THE SEARCHER'S ANSWER TO THE DESCRIPTION (Tier 1 #5 -- the enforcement half of R9).
--
-- R9 captured what the requestor MEANT and the screen showed it in amber. Nothing enforced it, so a
-- request whose requestor explicitly asked us to SEARCH FOR MORE could be fulfilled from their own
-- selection alone and advanced -- closing, in fact, a request they consider OPEN. That is the precise
-- failure the intent column exists to name.
--
-- A gate needs an un-gate, and this is it: the sentence "I searched; there is nothing more."
--   records_added   : the records I attached answer this description.
--   nothing_further : I searched and there is nothing more responsive to it. Requires a NOTE -- this is
--                     the assertion that closes a description the requestor still considers open, and an
--                     unevidenced version of it is indistinguishable from never having looked (the same
--                     reasoning that makes a no-records closure refuse an empty effort trail).
-- NULL = unresolved. Only intents that carry a SEARCH DUTY (search_more / no_match_search /
-- not_searchable) must be resolved; `complete` means the requestor said the selection is everything.
ALTER TABLE request_search_intents ADD COLUMN IF NOT EXISTS searcher_outcome TEXT;
ALTER TABLE request_search_intents ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE request_search_intents ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE request_search_intents ADD COLUMN IF NOT EXISTS resolved_at TEXT;

-- The records the requestor was SHOWN and did NOT take. Written on EVERY results-clear -- each
-- re-search AND the final Proceed -- because one description may be searched several times.
-- INVISIBLE TO THE REQUESTOR, forever. It exists so the searcher never re-surfaces a rejected record.
CREATE TABLE IF NOT EXISTS request_intake_results (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  intent_id TEXT,                       -- the description it was shown under (nullable: legacy rows)
  record_id TEXT NOT NULL,
  title TEXT,
  source_system TEXT,
  public_availability TEXT,
  shown_in_query TEXT,                  -- which of the queries_tried surfaced it
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_intake_results_request ON request_intake_results(request_id);
-- SELECTION WINS. A record passed over in search 1 and SELECTED in search 3 is selected ONLY -- it
-- must never appear to the searcher as "the requestor declined this" when they in fact took it.
-- Enforced in code (publicChat submit) AND here: one row per (request, record) in the not-selected set.
CREATE UNIQUE INDEX IF NOT EXISTS ux_intake_results_record ON request_intake_results(request_id, record_id);

-- Which description a selection answers. Nullable: pre-R9 rows stay NULL and render ungrouped.
ALTER TABLE request_selected_records ADD COLUMN IF NOT EXISTS intent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_demodocs_title ON demo_documents(title);
CREATE INDEX IF NOT EXISTS idx_emailverif_email ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_files_request ON request_files(request_id);
CREATE INDEX IF NOT EXISTS idx_requests_dept ON requests(department_id);
CREATE INDEX IF NOT EXISTS idx_requests_stage ON requests(stage);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
-- (The record_types / fulfilled_records ALTERs that used to sit here have moved DOWN to just after their own
--  CREATE TABLE. They ran BEFORE those tables existed, which is a no-op against a database that already has
--  them -- i.e. against live -- but hard-fails on an EMPTY one. That made this file unable to create a fresh
--  database at all: `ALTER TABLE record_types ... relation "record_types" does not exist`. Found 2026-07-14
--  while standing up the test database; it would have hit the first new city install the same way.)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS nonpayment_dunning_at TEXT;
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON agent_rules(enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_selected_request ON request_selected_records(request_id);

-- ===== Taxonomy core (added 2026-06-05; model in docs/TAXONOMY_MODEL_v2.md) =====
-- 1. Categories: ~13 high-level browse groups that hold record types.
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);

-- 2. Record types: THE HUB. Department, repository, routing, redaction, cost all attach here.
CREATE TABLE IF NOT EXISTS record_types (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL, -- -> categories.id
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  intent TEXT, -- what the record exists to capture (the discriminator)
  expected_content TEXT, -- what is typically in it
  typical_request_reason TEXT, -- situations that drive requests
  synonyms TEXT DEFAULT '[]', -- JSON: alternate names
  disambiguators TEXT DEFAULT '[]', -- JSON: what it is NOT
  keywords TEXT DEFAULT '[]', -- JSON
  identifying_facets TEXT DEFAULT '[]', -- JSON: fields that pin a specific instance (date, location, persons, case #)
  formats TEXT DEFAULT '[]', -- JSON: video|pdf|structured_data|email|physical|mixed
  is_structured_data INTEGER DEFAULT 0, -- data record in a system vs output file
  public_availability TEXT DEFAULT 'review_required', -- releasable|restricted|confidential|review_required
  auto_release_eligible INTEGER DEFAULT 0, -- 1 only if every applicable exemption is AI-detectable
  redaction_profile_id TEXT, -- -> future redaction_profiles library (nullable for now)
  fee_estimate_low DOUBLE PRECISION DEFAULT 0,
  fee_estimate_high DOUBLE PRECISION DEFAULT 0,
  fee_estimate_note TEXT,
  is_canonical INTEGER DEFAULT 0, -- single known document (cost/public-ready bypass)
  status TEXT DEFAULT 'active', -- active|draft|inactive (draft = proposed, pending approval)
  source TEXT DEFAULT 'seed', -- seed|discovered|manual (provenance for AI discovery)
  confidence DOUBLE PRECISION, -- for discovered types awaiting approval
  sort_order INTEGER DEFAULT 100,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
ALTER TABLE record_types ADD COLUMN IF NOT EXISTS auto_publish INTEGER DEFAULT 0;

-- 3. Record type <-> department links (owner vs fulfiller). Feeds Smart Routing.
CREATE TABLE IF NOT EXISTS record_type_departments (
  id TEXT PRIMARY KEY,
  record_type_id TEXT NOT NULL, -- -> record_types.id
  department_id TEXT NOT NULL, -- -> departments.id
  role TEXT NOT NULL DEFAULT 'owner', -- owner|fulfiller
  sort_order INTEGER DEFAULT 100,
  UNIQUE (record_type_id, department_id, role)
);

-- 4. Record type <-> repository links (where it lives), with per-link format + filter.
-- One type can link to several repositories; filter_spec lets paper(pre-2020) + pdf(after) coexist.
CREATE TABLE IF NOT EXISTS record_type_repositories (
  id TEXT PRIMARY KEY,
  record_type_id TEXT NOT NULL, -- -> record_types.id
  repository_id TEXT NOT NULL, -- -> record_repositories.id
  format TEXT, -- per-link medium
  filter_spec TEXT DEFAULT '{}', -- JSON: e.g. {"date_to":"2020-01-01"}
  sort_order INTEGER DEFAULT 100,
  UNIQUE (record_type_id, repository_id, format)
);

-- 5. Taxonomy audit trail (covers discovery proposals + approvals).
CREATE TABLE IF NOT EXISTS taxonomy_audit (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- category|record_type|rt_department|rt_repository
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL, -- create|update|delete|approve|reject|discover
  actor_id TEXT,
  actor_name TEXT,
  details TEXT, -- JSON snapshot/diff
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recordtypes_category ON record_types(category_id);
CREATE INDEX IF NOT EXISTS idx_recordtypes_status ON record_types(status);
CREATE INDEX IF NOT EXISTS idx_rtdept_rt ON record_type_departments(record_type_id);
CREATE INDEX IF NOT EXISTS idx_rtdept_dept ON record_type_departments(department_id);
CREATE INDEX IF NOT EXISTS idx_rtrepo_rt ON record_type_repositories(record_type_id);
CREATE INDEX IF NOT EXISTS idx_taxaudit_entity ON taxonomy_audit(entity_type, entity_id);

-- Public-facing source description (shown to requestors in the portal source picker)
ALTER TABLE record_repositories ADD COLUMN IF NOT EXISTS description TEXT;

-- Record-type medium / fulfillment dimension (so non-searchable types are still cataloged and handled)
ALTER TABLE record_types ADD COLUMN IF NOT EXISTS fulfillment_method TEXT DEFAULT 'electronic_search';
ALTER TABLE record_types ADD COLUMN IF NOT EXISTS medium TEXT DEFAULT 'electronic';

-- Paper Records Index: imported index of physical files in a storage location
CREATE TABLE IF NOT EXISTS paper_index_items (
  id TEXT PRIMARY KEY,
  repository_id TEXT,
  title TEXT,
  description TEXT,
  location TEXT,
  record_date TEXT,
  box TEXT,
  folder TEXT,
  tags TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_paper_index_repo ON paper_index_items(repository_id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS record_type_id TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS classification_confidence INTEGER;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS routing_basis TEXT;

-- Per-page processed view of an uploaded document: rendered image + text layer + word boxes.
-- Coordinates in `words` are normalized 0-1 (origin top-left) so they overlay any render resolution.
CREATE TABLE IF NOT EXISTS document_pages (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  request_id TEXT,
  page_no INTEGER NOT NULL,
  width REAL,
  height REAL,
  image_path TEXT,
  image_width INTEGER,
  image_height INTEGER,
  words TEXT,
  text TEXT,
  has_text_layer INTEGER DEFAULT 0,
  ocr INTEGER DEFAULT 0,
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_document_pages_file ON document_pages(file_id);

-- Jurisdiction Profile: variance (statutes, exemptions, later deadlines/fees) lives here as
-- configuration data, not product forks. Minimal now; expandable.
CREATE TABLE IF NOT EXISTS jurisdiction_profiles (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT,
  statute_name TEXT,
  statute_citation TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')
);

-- Redaction Rules Library: rules (what to redact) + categories + legal sources (many-to-many).
CREATE TABLE IF NOT EXISTS redaction_categories (
  id TEXT PRIMARY KEY,
  key TEXT,
  label TEXT,
  sort_order INTEGER DEFAULT 0
);
-- approval_status = approved | pending_review | rejected ; is_active separates "in effect" from approval ; source = seed | ai | manual
CREATE TABLE IF NOT EXISTS redaction_rules (
  id TEXT PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  category TEXT,
  approval_status TEXT DEFAULT 'pending_review',
  is_active INTEGER DEFAULT 0,
  source TEXT DEFAULT 'seed',
  approved_by TEXT,
  approved_at TEXT,
  source_document TEXT,
  effective_date TEXT,
  expiration_date TEXT,
  metadata TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_redaction_rules_jur ON redaction_rules(jurisdiction_id);
-- source_type = statute | regulation | case_law ; statute_text NULL until populated from a verified source
CREATE TABLE IF NOT EXISTS legal_sources (
  id TEXT PRIMARY KEY,
  jurisdiction_id TEXT,
  name TEXT,
  citation TEXT,
  source_type TEXT DEFAULT 'statute',
  description TEXT,
  statute_text TEXT,
  source TEXT DEFAULT 'seed',
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_legal_sources_jur ON legal_sources(jurisdiction_id);
CREATE TABLE IF NOT EXISTS rule_legal_sources (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  legal_source_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rule_legal_sources_rule ON rule_legal_sources(rule_id);

-- A redaction effort on one uploaded file.
CREATE TABLE IF NOT EXISTS redaction_jobs (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  request_id TEXT,
  jurisdiction_id TEXT,
  status TEXT DEFAULT 'draft',
  output_file_id TEXT,
  review_stage TEXT DEFAULT 'editing',
  reviewed_by TEXT,
  reviewed_at TEXT,
  submitted_by TEXT,
  submitted_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_redaction_jobs_file ON redaction_jobs(file_id);
-- Redaction automation model (SPEC_redaction_automation.md): per-file disposition + its basis (audit).
-- disposition ∈ bypass|simple|standard|elevated|legal; disposition_basis = JSON snapshot of the deciding signals.
ALTER TABLE redaction_jobs ADD COLUMN IF NOT EXISTS disposition TEXT;
ALTER TABLE redaction_jobs ADD COLUMN IF NOT EXISTS disposition_basis TEXT;

-- A single redaction box. Coords normalized 0-1, top-left origin (same frame as document_pages.words).
CREATE TABLE IF NOT EXISTS redaction_zones (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  file_id TEXT,
  page_no INTEGER NOT NULL,
  x REAL, y REAL, w REAL, h REAL,
  rule_id TEXT,
  note TEXT,
  zone_type TEXT DEFAULT 'manual',
  review_state TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_redaction_zones_job ON redaction_zones(job_id);

-- Layout Profile: reusable zone POSITIONS for a recurring form. Kept separate from the
-- exemption library (positions here, legal basis there). zones = JSON [{page_no,x,y,w,h,label,exemption_id?}].
CREATE TABLE IF NOT EXISTS layout_profiles (
  id TEXT PRIMARY KEY,
  name TEXT,
  record_type_id TEXT,
  description TEXT,
  zones TEXT,
  source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'active',
  source_file_id TEXT,
  source_filename TEXT,
  layout_fingerprint TEXT,
  safety_threshold INTEGER DEFAULT 80,
  kind TEXT DEFAULT 'pages',
  field_map TEXT,
  processing_manager_name TEXT,
  processing_manager_email TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT
);

-- Fulfilled Request Index (a.k.a. Released Records Library): records already processed and released.
-- Tier 1 of search reads this so previously-released records surface first and similar future
-- requests can be fast-tracked. public_availability: released (no redaction) | redacted.
CREATE TABLE IF NOT EXISTS fulfilled_records (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  source_file_id TEXT,
  output_file_id TEXT,
  title TEXT,
  summary TEXT,
  record_type_id TEXT,
  department_id TEXT,
  keywords TEXT,
  event_date TEXT,
  public_availability TEXT DEFAULT 'released',
  page_count INTEGER,
  released_by TEXT,
  released_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS'),
  status TEXT DEFAULT 'released',
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')
);
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS published INTEGER DEFAULT 0;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS published_at TEXT;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS published_by TEXT;
CREATE INDEX IF NOT EXISTS idx_fulfilled_source ON fulfilled_records(source_file_id);

-- Mass redaction job queue: durable, resumable, chunked batch jobs processed by a background
-- worker during an after-hours window, drawing from a shared nightly budget across all jobs.
CREATE TABLE IF NOT EXISTS mass_redaction_jobs (
  id TEXT PRIMARY KEY,
  name TEXT,
  template_id TEXT,
  kind TEXT DEFAULT 'pages',
  file_ids TEXT,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  redacted_count INTEGER DEFAULT 0,
  held_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  chunk_size INTEGER DEFAULT 500,
  window_start TEXT DEFAULT '18:00',
  window_end TEXT DEFAULT '06:00',
  priority INTEGER DEFAULT 100,
  status TEXT DEFAULT 'queued',
  error_log TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT,
  last_run_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mass_jobs_status ON mass_redaction_jobs(status, priority, created_at);

-- Per-day shared compute budget counter (UTC date -> items processed that day across all jobs).
CREATE TABLE IF NOT EXISTS mass_job_budget (
  day TEXT PRIMARY KEY,
  used INTEGER DEFAULT 0
);

-- Fee engine: per-jurisdiction, per-context (FR/SS), versioned fee configuration.
-- config_json holds the structured policy the deterministic feeEngine prices against.
CREATE TABLE IF NOT EXISTS fee_profiles (
  id TEXT PRIMARY KEY,
  jurisdiction_id TEXT,
  context TEXT,
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'draft',
  name TEXT,
  config_json TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Per-request fee estimate / final snapshots (immutable feeContext history; estimate vs final).
CREATE TABLE IF NOT EXISTS request_fee_estimates (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  kind TEXT DEFAULT 'estimate',
  config_profile_id TEXT,
  input_json TEXT,
  fee_context_json TEXT,
  total DOUBLE PRECISION,
  deposit_due DOUBLE PRECISION,
  notify_flag INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT
);
-- (fee estimate notice tracking)
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS notified_at TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS notified_to TEXT;

CREATE TABLE IF NOT EXISTS av_redaction_tasks (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  original_file_id TEXT,
  mode TEXT DEFAULT 'external',
  status TEXT DEFAULT 'out',
  redacted_file_id TEXT,
  attested INTEGER DEFAULT 0,
  note TEXT,
  started_by TEXT,
  started_at TEXT,
  checked_in_by TEXT,
  checked_in_at TEXT
);

ALTER TABLE av_redaction_tasks ADD COLUMN IF NOT EXISTS zones_json TEXT;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  owner_type TEXT,
  owner_id TEXT,
  model TEXT,
  dim INTEGER,
  vec TEXT,
  embedding vector(1024),
  content TEXT,
  created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS embeddings_owner_uniq ON embeddings(owner_type, owner_id, model);
CREATE INDEX IF NOT EXISTS embeddings_embedding_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);
CREATE TABLE IF NOT EXISTS workflow_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, enabled INTEGER DEFAULT 1, priority INTEGER DEFAULT 100, conditions TEXT DEFAULT '[]', actions TEXT DEFAULT '{}', source TEXT DEFAULT 'manual', created_by TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS workflow_decisions (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, record_type_id TEXT, record_type_name TEXT, confidence INTEGER, classification TEXT, rule_id TEXT, rule_name TEXT, decided_stage TEXT, decided_team_id TEXT, decided_team_name TEXT, reasoning TEXT, flags TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE INDEX IF NOT EXISTS idx_wf_decisions_req ON workflow_decisions(request_id);
INSERT INTO workflow_rules (id,name,description,enabled,priority,conditions,actions,source) VALUES
('wfr-sensitive','Sensitive matters stay with a person','If the request is flagged as a legal hold, an active investigation, or otherwise sensitive, keep it at intake for a human - even if the match looks confident.',1,5,'[{"field":"flags","op":"contains_any","value":["LEGAL_HOLD","ONGOING_INVESTIGATION","SENSITIVE"]}]','{"stage":"intake","team":"open_records","note":"Held at intake for human review due to a sensitivity flag.","stop":true}','seed'),
('wfr-confident','Confident match goes straight to the right team','If the record type is matched with high confidence and that record type has a known owning team, auto-complete intake and send it to that team for record search.',1,20,'[{"field":"record_type_confidence","op":"gte","value":70},{"field":"has_owner_team","op":"is_true"}]','{"stage":"record_search","team":"matched","note":"Confident record-type match with a known owning team; intake auto-completed.","stop":true}','seed'),
('wfr-uncertain','Uncertain match to Open Records','If confidence in the record-type match is low, route to the Open Records team at intake for human triage.',1,30,'[{"field":"record_type_confidence","op":"lt","value":70}]','{"stage":"intake","team":"open_records","note":"Low match confidence; routed to Open Records for human triage.","stop":true}','seed'),
('wfr-fallback','Fallback to Open Records intake','When no other rule applies, default to Open Records at intake so nothing is ever left unrouted.',1,100,'[]','{"stage":"intake","team":"open_records","note":"No specific rule matched; default to Open Records intake.","stop":true}','seed')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS record_type_estimate_profiles (
  record_type_id TEXT PRIMARY KEY,
  quantities_json TEXT DEFAULT '{}',
  stats_json TEXT DEFAULT '{}',
  sample_size INTEGER DEFAULT 0,
  has_expert_seed INTEGER DEFAULT 0,
  source TEXT,
  notes TEXT,
  seeded_by TEXT,
  seeded_at TEXT,
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS fee_waiver_status TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS fee_waiver_reason TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS fee_waiver_decided_by TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS fee_waiver_decided_at TEXT;
-- Structured mailing address (split-canvas intake, slice 1). Captured only for postal delivery; country implicit US.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mailing_street1 TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mailing_street2 TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mailing_city    TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mailing_state   TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mailing_zip     TEXT;
-- Certification opt-in + email-accuracy method (split-canvas intake, slice 5). Both captured on the Phase-0 form.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS certification_requested INTEGER DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS email_verification_method TEXT;
CREATE TABLE IF NOT EXISTS decision_reasons (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, text TEXT NOT NULL,
  is_active INTEGER DEFAULT 1, usage_count INTEGER DEFAULT 0,
  created_by TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
INSERT INTO decision_reasons (id, category, text, created_by) VALUES
('dr-fw-1','fee_waiver_denial','The request does not demonstrate a public interest that outweighs the cost of providing the records.','seed'),
('dr-fw-2','fee_waiver_denial','The requestor does not qualify under the agency''s fee-waiver criteria.','seed'),
('dr-fw-3','fee_waiver_denial','The request is primarily in the requestor''s commercial or personal interest.','seed'),
('dr-fw-4','fee_waiver_denial','Insufficient information was provided to evaluate the fee-waiver request.','seed'),
('dr-fw-5','fee_waiver_denial','The requested records are already publicly available at no cost.','seed')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  type TEXT NOT NULL,
  title TEXT,
  team_id TEXT,
  role_required TEXT,
  status TEXT DEFAULT 'open',
  assigned_to TEXT,
  assignment_basis TEXT,
  match_score REAL,
  created_by TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  claimed_at TEXT,
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_pool ON tasks(team_id, role_required, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_request ON tasks(request_id);

-- tasks.request_id was an UNENFORCED reference: no FK, so deleting a request left its tasks behind as
-- OPEN rows in a real worklist, pointing at nothing. 15 such orphans were found live on 2026-07-14.
-- Two things produced them, and the second is the nasty one:
--   1. Nothing deleted a request's tasks when the request went away.
--   2. workflowEngine.bg() is fire-and-forget. A caller could DELETE a request while onIntake was still
--      in flight, and the in-flight insert would then create a task for a request that no longer existed.
--      The verify suite hit this on EVERY run, leaking one open routing_review task into the live DB.
-- The FK closes both: CASCADE takes the tasks with the request, and the racing insert now fails loudly
-- (caught by bg's handler) instead of silently manufacturing an orphan. A task for a deleted request is
-- not work anyone can do.
-- NOTE: this is deliberately scoped to `tasks`. Fifteen OTHER tables reference requests(id) with no FK,
-- including money/audit tables (request_payment_events, request_clocks, workflow_decisions). Whether a
-- request deletion should CASCADE away its payment trail is a POLICY question, not a mechanical one --
-- see the (wq) handoff entry. Do not blanket-apply this without deciding that.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tasks'::regclass AND conname = 'fk_tasks_request_id'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT fk_tasks_request_id
      FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE departments ADD COLUMN IF NOT EXISTS auto_load_balancing INTEGER DEFAULT 0;

ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS accepted_at TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS accepted_by TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS declined_at TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS declined_reason TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS deposit_paid_at TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS deposit_paid_by TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS deposit_paid_amount REAL;

ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS baseline_total REAL;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS variance_pct REAL;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS renotify_required INTEGER;

ALTER TABLE requests ADD COLUMN IF NOT EXISTS tickler_flag TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS tickler_flagged_at TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS lapsed_at TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS final_paid_at TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS final_paid_by TEXT;
ALTER TABLE request_fee_estimates ADD COLUMN IF NOT EXISTS final_paid_amount REAL;

-- Cashiering ledger: one row per collected payment (internal payment mode). Supports
-- cash-drawer reconciliation and a per-transaction audit trail; cumulative deposit/final
-- amounts still live on request_fee_estimates.
CREATE TABLE IF NOT EXISTS fee_payments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  estimate_id TEXT,
  target TEXT,
  method TEXT,
  amount REAL,
  tendered REAL,
  change_given REAL,
  reference TEXT,
  clerk TEXT,
  drawer_date TEXT,
  created_at TEXT,
  voided INTEGER DEFAULT 0,
  voided_by TEXT,
  voided_at TEXT
);

-- Fee-estimate objection overlay (operational objection layer). An objection rides on a request
-- without changing its process stage; while open (and clock_frozen) the tickler holds its clocks.
-- Manual person-based ownership (assignee_id), freely reassignable. Resolution splits by financial
-- effect: non-financial clears directly; financial is tentative pending a Fee Authorizer approval.
CREATE TABLE IF NOT EXISTS objections (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  source_type TEXT,
  evidence_file_id TEXT,
  recap_text TEXT,
  reason TEXT,
  assignee_id TEXT,
  assignee_name TEXT,
  raised_by TEXT,
  raised_by_name TEXT,
  raised_at TEXT,
  clock_frozen INTEGER DEFAULT 0,
  resolution_type TEXT,
  resolution_detail TEXT,
  resolution_amount REAL,
  approval_status TEXT,
  approved_by TEXT,
  approved_at TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_objections_request ON objections(request_id);
CREATE INDEX IF NOT EXISTS idx_objections_assignee ON objections(assignee_id);
CREATE INDEX IF NOT EXISTS idx_objections_status ON objections(status);

-- ERP settlement tracking: charges Optimum Q handed off to the ERP (erp mode). Matches the ERP's
-- payment-applied webhook back to a request so the balance/gate update. Optimum Q never holds the money.
CREATE TABLE IF NOT EXISTS erp_charges (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  estimate_id TEXT,
  target TEXT,
  amount REAL,
  reference TEXT,
  erp_charge_id TEXT,
  status TEXT DEFAULT 'sent',
  paid_amount REAL DEFAULT 0,
  method TEXT,
  sent_by TEXT,
  sent_at TEXT,
  paid_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_erpcharges_request ON erp_charges(request_id);
CREATE INDEX IF NOT EXISTS idx_erpcharges_erpid ON erp_charges(erp_charge_id);

-- Payment-status event log (Financial Profile phase 3). The dated film of financial events; the
-- current status is derived, and each event records the status it produced (photograph after event).
CREATE TABLE IF NOT EXISTS request_payment_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  type TEXT,
  amount REAL,
  reason TEXT,
  reference TEXT,
  actor TEXT,
  approver TEXT,
  status_current TEXT,
  status_label TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_paymentevents_request ON request_payment_events(request_id);

-- Manual fee adjustments (credit = non-cash reduction of the receivable, with reason; refund = cash
-- out on overpayment). Corrections are handled as re-estimates, not rows here. Credits reduce the
-- effective total (like approved objection credits); refunds reduce net cash paid.
CREATE TABLE IF NOT EXISTS fee_adjustments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  type TEXT,
  amount REAL,
  reason TEXT,
  actor TEXT,
  created_at TEXT,
  voided INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_feeadjust_request ON fee_adjustments(request_id);

-- Demo email-system table for the email COUNT-ONLY connector (synthetic; a real deployment swaps
-- in a live Microsoft Graph/Purview or Google Vault connector). Content is never exposed - only counts.
CREATE TABLE IF NOT EXISTS demo_emails (id TEXT PRIMARY KEY, sender TEXT, recipients TEXT, subject TEXT, body TEXT, sent_date TEXT);
CREATE TABLE IF NOT EXISTS tickler_runs (id TEXT PRIMARY KEY, ran_at TEXT, trigger TEXT, scanned INTEGER, flagged INTEGER, summary_json TEXT);

CREATE TABLE IF NOT EXISTS request_clocks (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, clock_type TEXT NOT NULL, label TEXT, basis TEXT NOT NULL DEFAULT 'calendar_days', duration INTEGER NOT NULL, started_at TEXT, status TEXT NOT NULL DEFAULT 'running', satisfied_at TEXT, is_primary INTEGER DEFAULT 0, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE INDEX IF NOT EXISTS idx_request_clocks_req ON request_clocks(request_id);
CREATE TABLE IF NOT EXISTS clock_tolls (id TEXT PRIMARY KEY, clock_id TEXT NOT NULL, reason TEXT, tolled_from TEXT, tolled_until TEXT, note TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE INDEX IF NOT EXISTS idx_clock_tolls_clock ON clock_tolls(clock_id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS purpose TEXT DEFAULT 'standard';
-- PHASE 7 / WS4 — evidence a requester supplied and STAFF VERIFIED, as a JSON array of evidence keys
-- ('indigency_affidavit', 'appointment_letter', 'victim_status', ...). It is the firing condition for a
-- statutorily MANDATORY fee waiver (services/approvalModules.js): those waivers are compelled by statute,
-- so they fire regardless of whether the city runs a discretionary program — but only on VERIFIED
-- evidence, never on the request alone. Nothing infers this from free text; a person ticks it.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS verified_evidence TEXT;
ALTER TABLE jurisdiction_profiles ADD COLUMN IF NOT EXISTS exemption_model TEXT;
CREATE TABLE IF NOT EXISTS config_sources ( id text PRIMARY KEY, jurisdiction_id text, domain text, label text, url text, active integer DEFAULT 1, last_checked_at text, last_change_at text, last_version_hash text, notes text, created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS') );
CREATE TABLE IF NOT EXISTS config_proposals ( id text PRIMARY KEY, jurisdiction_id text, domain text, status text DEFAULT 'pending', summary text, proposed_json text, source_ref text, created_by text, created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS'), reviewed_by text, reviewed_at text );
CREATE TABLE IF NOT EXISTS config_freshness_runs ( id text PRIMARY KEY, trigger text, jurisdiction_id text, summary_json text, emailed integer DEFAULT 0, created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS') );
CREATE TABLE IF NOT EXISTS config_source_snapshots ( id text PRIMARY KEY, source_id text, jurisdiction_id text, domain text, hash text, text text, fetched_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS') );
ALTER TABLE config_proposals ADD COLUMN IF NOT EXISTS snapshot_id text;
ALTER TABLE config_proposals ADD COLUMN IF NOT EXISTS current_json text;
ALTER TABLE config_proposals ADD COLUMN IF NOT EXISTS applied_json text;
ALTER TABLE config_proposals ADD COLUMN IF NOT EXISTS attested_by text;
ALTER TABLE config_proposals ADD COLUMN IF NOT EXISTS attested_at text;
CREATE TABLE IF NOT EXISTS jurisdiction_profile_sections ( id text PRIMARY KEY, jurisdiction_id text, section text, label text, content_hash text, version integer DEFAULT 0, status text DEFAULT 'not_configured', source text DEFAULT 'seed', last_changed_at text, last_changed_by text, attested_by text, attested_at text, attested_version integer, attested_hash text, notes text, created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS'), updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS') );
CREATE UNIQUE INDEX IF NOT EXISTS jps_jur_section ON jurisdiction_profile_sections (jurisdiction_id, section);
CREATE TABLE IF NOT EXISTS scheduled_config_changes ( id text PRIMARY KEY, jurisdiction_id text, domain text, effective_date text, config_json text, summary text, source_ref text, proposal_id text, status text DEFAULT 'scheduled', created_by text, created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS'), applied_at text, cancelled_at text, cancelled_by text );
CREATE INDEX IF NOT EXISTS scc_due ON scheduled_config_changes (status, effective_date);
CREATE TABLE IF NOT EXISTS config_history ( id text PRIMARY KEY, jurisdiction_id text, domain text, config_json text, summary text, effective_from text, effective_to text, source text, created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS') );
CREATE INDEX IF NOT EXISTS ch_window ON config_history (jurisdiction_id, domain, effective_from);

-- Onboarding wizard: guided-setup progress with per-phase completion audit
CREATE TABLE IF NOT EXISTS onboarding_progress (
  phase_key TEXT PRIMARY KEY,
  phase_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  completed_by TEXT,
  completed_at TIMESTAMP,
  notes TEXT,
  updated_at TIMESTAMP DEFAULT now()
);
-- SEVEN phases. `fees` was missing here while existing in the live DB (added by hand), so a FRESH INSTALL
-- produced a wizard with no Fees & Estimates phase at all — and therefore no fee sandbox gate, which is the
-- strongest configuration gate in the product. `redaction` moves to 6 to make room; the convergence UPDATE
-- below repairs any database seeded from the older six-phase list.
INSERT INTO onboarding_progress (phase_key, phase_order, title) VALUES
  ('jurisdiction', 0, 'Jurisdiction Profile'),
  ('departments', 1, 'City Departments'),
  ('teams',       2, 'Request Fulfillment Teams'),
  ('ownership',   3, 'Record Ownership'),
  ('repositories',4, 'Repositories & Discovery'),
  ('fees',        5, 'Fees & Estimates'),
  ('redaction',   6, 'Redaction Readiness')
ON CONFLICT (phase_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS import_ingest_log (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, file_key TEXT NOT NULL, original_name TEXT, request_file_id TEXT, status TEXT, detail TEXT, ingested_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE UNIQUE INDEX IF NOT EXISTS ux_import_ingest ON import_ingest_log (repository_id, file_key);

-- Per-jurisdiction rule store. Until 2026-07-13 the two clock-relevant configs ('deadline_rules' and
-- 'clarification_policy') lived as GLOBAL singletons in system_config, so there was no way to hold a
-- second state's rules — clarificationPolicy.read(jid) literally discarded its jurisdiction argument.
-- This is the slot a rule lives in. One row per (jurisdiction, domain); domain names match the
-- configExtractors adapters ('deadline', 'clarification', ...) so the AI extraction + config-history +
-- attestation plumbing works unchanged. See docs/SPEC_parent_child_lifecycle.md §10.
CREATE TABLE IF NOT EXISTS jurisdiction_rules (
  id TEXT PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  config_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_jurisdiction_rules ON jurisdiction_rules (jurisdiction_id, domain);

-- One-time, idempotent backfill: lift the two global blobs onto the ACTIVE jurisdiction. Reads (below)
-- fall back to the legacy system_config key when a row is absent, so this is safe to re-run and safe if
-- it finds nothing.
INSERT INTO jurisdiction_rules (id, jurisdiction_id, domain, config_json, updated_by)
SELECT 'jr-' || j.id || '-deadline', j.id, 'deadline', sc.value, 'backfill'
  FROM jurisdiction_profiles j
  JOIN system_config sc ON sc.key = 'deadline_rules'
 WHERE j.id = (SELECT value FROM system_config WHERE key = 'jurisdiction_profile')
ON CONFLICT (jurisdiction_id, domain) DO NOTHING;

INSERT INTO jurisdiction_rules (id, jurisdiction_id, domain, config_json, updated_by)
SELECT 'jr-' || j.id || '-clarification', j.id, 'clarification', sc.value, 'backfill'
  FROM jurisdiction_profiles j
  JOIN system_config sc ON sc.key = 'clarification_policy'
 WHERE j.id = (SELECT value FROM system_config WHERE key = 'jurisdiction_profile')
ON CONFLICT (jurisdiction_id, domain) DO NOTHING;

-- Statutory clock EXTENSIONS. Distinct from a toll: a toll suspends the clock and pushes the due date out
-- by ELAPSED WALL TIME, which structurally cannot express "+10 statutory days for unusual volume"
-- (5 ILCS 140/3(e); Cal. Gov't Code § 7922.535(b)). An extension LENGTHENS the clock's duration by a fixed
-- number of days. Statutes cap these (IL: one 5-business-day extension; CA: one, max 14 days), so the
-- ledger is what enforces the cap. See docs/SPEC_parent_child_lifecycle.md §10.4 step 4.
CREATE TABLE IF NOT EXISTS clock_extensions (
  id TEXT PRIMARY KEY,
  clock_id TEXT NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT,
  note TEXT,
  actor TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS ix_clock_extensions_clock ON clock_extensions (clock_id);

-- WRAP-IN-PARENT (ARCHITECTURE item 1, ratified 2026-07-16; SPEC_parent_child_lifecycle.md §8).
-- `child_no` is 1..n and NEVER 0: a zero would make the single-record case a different shape from a
-- multi-record component, which is exactly what always-wrap exists to prevent (§5.1). NULL on a parent, and
-- NULL on the LIBRARY/SYS-* infrastructure containers, which are not citizen requests and never grow a parent.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS child_no INTEGER;

-- `description` becomes NULLABLE — but only for PARENTS. §5.1: "description — Child only. The parent has no
-- description." That is not cosmetic: the description is the work, and a copy on the parent makes every
-- description lookup match TWO rows (proved by the suite the moment the wrap went in). The NOT NULL predates
-- parent/child and was protecting the right thing on the wrong row, so it is replaced by a CHECK that keeps
-- the guarantee exactly where it belongs: a CHILD must always have one. Roots (parents, and the LIBRARY/SYS-*
-- containers) may not.
ALTER TABLE requests ALTER COLUMN description DROP NOT NULL;
ALTER TABLE requests DROP CONSTRAINT IF EXISTS chk_child_has_description;
ALTER TABLE requests ADD CONSTRAINT chk_child_has_description CHECK (child_no IS NULL OR description IS NOT NULL);

-- Parent/child: every scope predicate filters on master_request_id (see services/requestScope.js), so it
-- needs an index or every list query degrades to a sequential scan once children exist.
CREATE INDEX IF NOT EXISTS ix_requests_master ON requests (master_request_id);

-- DROP the two dead money columns (2026-07-19). These NEVER had a writer — not one line in the codebase ever
-- set `requests.actual_fee` or `requests.amount_paid`. Money is recorded on `request_fee_estimates`
-- (`deposit_paid_amount` / `final_paid_amount`), written by routes/feeEstimates.js and routes/settlement.js.
--
-- ⚠️ THEY WERE NOT HARMLESS. `amount_paid` had exactly ONE reader in the entire repo — `reportEngine`'s
-- fee_revenue metric summed it — so every revenue figure in the product reported $0 no matter how much a city
-- had collected. Not an error; a plausible, empty report. That reader was cut over to the real source on
-- 2026-07-19 (58aac73) and the columns are now genuinely unreferenced.
--
-- Verified before dropping: both were 0 in every live row (all 13), so no value is destroyed — they only ever
-- held their DEFAULT 0. Keeping them would leave a second, always-zero money source for a future query to find
-- and believe, which is exactly how the $0-revenue defect happened in the first place.
--
-- `IF EXISTS` makes this idempotent: the schema re-applies on every boot, and a fresh install never has them
-- (they are gone from the CREATE TABLE above).
ALTER TABLE requests DROP COLUMN IF EXISTS actual_fee;
ALTER TABLE requests DROP COLUMN IF EXISTS amount_paid;

-- `estimated_fee` goes too, and it was the MIRROR IMAGE of those two: it had a writer
-- (routes/feeEstimates.js, immediately after inserting the authoritative `request_fee_estimates` row) and no
-- reader anywhere. A write-only denormalized copy.
--
-- ⚠️ IT WAS STALE BY DESIGN, which is the real reason it goes. That single write was the ONLY one in the
-- codebase: reconciliation, reissue and adjustment each write a NEW `request_fee_estimates` snapshot and never
-- touched this column. So the moment a request was reconciled it held a superseded total — a believable money
-- number that was wrong, the same trap `amount_paid` set. It also landed on the ADDRESSED row (a child today),
-- putting a money fact on the work row, contrary to §4.3.
--
-- Verified 0 in all 13 live rows before dropping. The estimate total lives on `request_fee_estimates.total`.
ALTER TABLE requests DROP COLUMN IF EXISTS estimated_fee;

-- ============================================================================================
-- REFERENTIAL INTEGRITY FOR requests(id)  +  THE PAYMENT-HISTORY DELETE GUARD
--
-- Sixteen tables referenced requests(id) and NOT ONE had a foreign key. Deleting a request left
-- its children behind pointing at nothing: 15 orphan tasks sat OPEN in real worklists, plus 36
-- more orphaned rows across clocks, payment events, and workflow decisions (found 2026-07-14).
--
-- Two rules, and they are deliberately different:
--
--   1. ORDINARY CHILDREN CASCADE. A clock, a task, a history row, a file for a request that no
--      longer exists is not data — it is litter. It goes when the request goes.
--
--   2. A REQUEST WITH PAYMENT HISTORY CANNOT BE DELETED AT ALL. (Kevin's call, 2026-07-14.)
--      CASCADE is exactly WRONG here: it would silently erase the record that money changed
--      hands. If a citizen paid us, that fact outlives any convenience of deleting the row, and
--      the database — not the application — is where that guarantee belongs.
--
-- Why a TRIGGER and not ON DELETE RESTRICT: `request_payment_events` is a MIXED ledger with a
-- free-text `type` (paymentStatus.recordEvent writes `evt.type || 'event'`). Most rows in it are
-- `estimate_issued` — an estimate being CALCULATED, which is not a payment. RESTRICT on that
-- table would block deleting any request that ever got an estimate, which is broader than the
-- rule. The trigger asks the precise question instead: DID MONEY ACTUALLY MOVE?
-- ============================================================================================

DO $$
DECLARE
  t TEXT;
  child_tables TEXT[] := ARRAY[
    'av_redaction_tasks','document_pages','erp_charges','fee_adjustments','fee_payments',
    'fulfilled_records','objections','redaction_jobs','request_clocks','request_fee_estimates',
    'request_files','request_history','request_payment_events','request_selected_records',
    -- R9: intake provenance. Pure children of a request -- meaningless without it, so CASCADE is
    -- correct. (The payment-history delete guard still blocks deleting any request that took money,
    -- so this cannot cascade away a financial trail.)
    'request_search_intents','request_intake_results',
    'workflow_decisions'
  ];
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = t::regclass AND conname = 'fk_' || t || '_request_id'
       ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE',
        t, 'fk_' || t || '_request_id'
      );
    END IF;
  END LOOP;
END $$;

-- The guard. Money received is recorded in three places; any one of them makes the request permanent.
-- Note this asks whether money was RECEIVED, not merely OWED: an unpaid estimate or an unpaid ERP
-- charge is not payment history, and such a request stays deletable.
CREATE OR REPLACE FUNCTION block_delete_of_paid_request() RETURNS TRIGGER AS $$
DECLARE
  what TEXT;
BEGIN
  SELECT x INTO what FROM (
    SELECT 'a counter payment (fee_payments)' AS x
      WHERE EXISTS (SELECT 1 FROM fee_payments WHERE request_id = OLD.id)
    UNION ALL
    SELECT 'a fee adjustment or refund (fee_adjustments)'
      WHERE EXISTS (SELECT 1 FROM fee_adjustments WHERE request_id = OLD.id)
    UNION ALL
    SELECT 'a PAID ERP charge (erp_charges)'
      WHERE EXISTS (SELECT 1 FROM erp_charges WHERE request_id = OLD.id
                    AND (paid_at IS NOT NULL OR COALESCE(paid_amount, 0) > 0))
    UNION ALL
    SELECT 'a paid deposit or final payment (request_fee_estimates)'
      WHERE EXISTS (SELECT 1 FROM request_fee_estimates WHERE request_id = OLD.id
                    AND (deposit_paid_at IS NOT NULL OR final_paid_at IS NOT NULL))
  ) s LIMIT 1;

  IF what IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to delete request % (%): it has PAYMENT HISTORY — %. A request that took money cannot be deleted; the payment record must outlive it. Close or withdraw the request instead.',
      OLD.request_number, OLD.id, what
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_delete_of_paid_request ON requests;
CREATE TRIGGER trg_block_delete_of_paid_request
  BEFORE DELETE ON requests
  FOR EACH ROW EXECUTE FUNCTION block_delete_of_paid_request();

-- ============================================================================================
-- SCHEMA DRIFT REPAIR (2026-07-14)
--
-- These objects existed in the LIVE database but NOT in this file. Live had been ALTERed directly and this
-- schema was never updated to match, so it had quietly stopped describing the database it supposedly defines.
--
-- Nobody noticed because every existing environment ALREADY had them, and this file only ever ran against
-- those environments. The victim would have been THE FIRST NEW CITY INSTALL: it would have come up missing an
-- entire table and 20 columns, and the code uses all of them -- mapping (latitude/longitude/geo_address),
-- import review (import_review_jobs), and onboarding review/test tracking. Broken on day one, in features
-- nobody would think to re-test on a "fresh" deploy.
--
-- Found by standing up the test database, which is the first thing that ever built this schema from EMPTY.
-- That is the point of a test database.
-- ============================================================================================
CREATE TABLE IF NOT EXISTS import_review_jobs (
  job_id TEXT PRIMARY KEY,
  repository_id TEXT,
  review_assignee TEXT,
  kind TEXT,
  review_task_id TEXT,
  created_at TEXT DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS latitude REAL;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS longitude REAL;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS geo_address TEXT;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS geocoded_at TEXT;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS geocode_source TEXT;
ALTER TABLE record_types ADD COLUMN IF NOT EXISTS mappable INTEGER DEFAULT 1;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS test_notes TEXT;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS test_by TEXT;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS test_status TEXT;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS test_at TEXT;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS test_config_ref TEXT;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS requires_review BOOLEAN DEFAULT false;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS review_requested_at TEXT;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS reviewer_id TEXT;

-- WHICH ONBOARDING PHASES ARE GATED — the seed baseline, converged on every boot.
--
-- THE DEFECT THIS FIXES: `requires_review` was added with DEFAULT false and **nothing in the codebase ever
-- wrote it**. The live database carried it as true on jurisdiction / fees / redaction because someone set it
-- by hand. A fresh city install therefore came up with ZERO gated phases — every phase completable by any
-- authenticated user with a plain PATCH, no designated reviewer, no approval — which is the exact opposite of
-- the intended posture (`AUTO_CONFIG_DESIGN.md` §11, `DESIGN_go_live_readiness.md`).
--
-- These three are gated because each carries legal weight the city must own: the jurisdiction profile sets
-- statutory deadlines and the exemption basis; fees decide what a citizen is lawfully charged (and this phase
-- carries the version-bound sandbox gate); redaction decides what is withheld. Nothing sets `requires_review`
-- at runtime, so converging it here cannot clobber a customer's choice — there is no way for them to make one.
--
-- Both statements are guarded to be genuine no-ops when already correct, so this rewrites nothing on an
-- existing install (the schema is re-applied on every server boot).
UPDATE onboarding_progress SET phase_order = 6
  WHERE phase_key = 'redaction' AND phase_order IS DISTINCT FROM 6;
UPDATE onboarding_progress SET requires_review = true
  WHERE phase_key IN ('jurisdiction', 'fees', 'redaction') AND requires_review IS DISTINCT FROM true;

-- Notification model + nullable task/file request link (Tasks spec §1-2; Sources spec §4). A task is a
-- request-processing stop; a NOTIFICATION is an ad-hoc heads-up (description + link, no completion UI) that
-- must NOT depend on a request_id. Making tasks.request_id and request_files.request_id nullable removes the
-- structural trap that forced the SYS-IMPORT pseudo-request. Idempotent; converge existing DBs on boot.
ALTER TABLE tasks ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE request_files ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS repository_id TEXT;
CREATE INDEX IF NOT EXISTS idx_files_repository ON request_files(repository_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,               -- recipient
  kind TEXT,                           -- category, e.g. 'import_template', 'import_processed'
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,                           -- hyperlink target (a screen); NOT a request dependency
  context_type TEXT,                   -- optional grouping/dedupe, e.g. 'repository'
  context_id TEXT,                     -- optional entity id; the notification does not DEPEND on it
  read_at TEXT,
  dismissed_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- Returned-for-rework flag (BACKLOG R10, slice 8b). A task KEEPS its status and its place in the owner's My
-- Tasks list, but is flagged as returned by a reviewer with the reason. taskRouting.markTaskReturned() sets
-- these + pushes a notification; clearReturned() clears them when the author re-submits. Idempotent.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS return_reason TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS returned_by TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS returned_at TEXT;

-- ============================================================================================
-- TASK TIMING / BOOKMARK TRAIL (Slice A). Every task status change drops a bookmark (task_events row) so any
-- "elapsed time between bookmarks" is derivable — days in queue, in process, in review, etc. Immutable history:
-- never edited. Tolling/resets live on the legal deadline clock (request_clocks), NOT here. The request's own
-- created_at is the submit anchor. See docs/SPEC_tasks_roles_mrr_fees.md §2.
-- ============================================================================================
CREATE TABLE IF NOT EXISTS task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  request_id TEXT,
  task_type TEXT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_request ON task_events(request_id);

-- Denormalized convenience stamps (latest of each) for cheap current-state reads; the log is the source of truth.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS in_progress_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS done_at TEXT;

-- BEFORE: stamp the denormalized timestamps on transition. in_progress_at is stamped ONCE (first work-start),
-- so a correction round (returned -> in_progress) does not reset "when work first started".
CREATE OR REPLACE FUNCTION tasks_stamp_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'assigned' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'assigned' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    NEW.assigned_at := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
  END IF;
  IF NEW.status = 'in_progress' AND NEW.in_progress_at IS NULL THEN
    NEW.in_progress_at := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
  END IF;
  IF NEW.status = 'done' THEN
    NEW.done_at := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tasks_stamp ON tasks;
CREATE TRIGGER trg_tasks_stamp BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION tasks_stamp_transition();

-- AFTER: write a bookmark row on the initial insert and on every status change.
CREATE OR REPLACE FUNCTION tasks_log_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_events (task_id, request_id, task_type, from_status, to_status)
      VALUES (NEW.id, NEW.request_id, NEW.type, NULL, NEW.status);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO task_events (task_id, request_id, task_type, from_status, to_status)
      VALUES (NEW.id, NEW.request_id, NEW.type, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tasks_log ON tasks;
CREATE TRIGGER trg_tasks_log AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION tasks_log_event();

-- Redaction on-entry automation gate: discovery runs ONCE per job (first entry), never re-run on re-open.
ALTER TABLE redaction_jobs ADD COLUMN IF NOT EXISTS discovered_at TEXT;

-- TIME BUDGETS (Slice C). Best-guess calendar-days budget per step, keyed by (record_type_id, task_type);
-- record_type_id NULL is the GENERIC default for that task type. Mirrors the estimate-profile pattern so the
-- future budget "brain" (AI best-fit + supervisor override) slots in the same way. Compared against the
-- Slice-B actual elapsed to yield "budgeted days remaining / over budget". Seeded values are PROVISIONAL.
CREATE TABLE IF NOT EXISTS time_budgets (
  id TEXT PRIMARY KEY,
  record_type_id TEXT,
  task_type TEXT NOT NULL,
  budget_days REAL NOT NULL,
  source TEXT DEFAULT 'generic',
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_time_budgets ON time_budgets (COALESCE(record_type_id,''), task_type);
INSERT INTO time_budgets (id, record_type_id, task_type, budget_days, source) VALUES
  ('tb-estimate', NULL, 'estimate', 2, 'generic'),
  ('tb-record_search', NULL, 'record_search', 3, 'generic'),
  ('tb-redaction', NULL, 'redaction', 4, 'generic'),
  ('tb-legal_redaction', NULL, 'legal_redaction', 6, 'generic'),
  ('tb-legal_review', NULL, 'legal_review', 4, 'generic'),
  ('tb-redaction_qa', NULL, 'redaction_qa', 2, 'generic'),
  ('tb-fee_waiver', NULL, 'fee_waiver', 1, 'generic'),
  ('tb-routing_review', NULL, 'routing_review', 1, 'generic')
ON CONFLICT (id) DO NOTHING;

-- WORK TIMER / actual labor capture (Slice D). The per-task active-work timer heartbeats its running total into
-- work_seconds; on completion it is finalized (accepted or adjusted-with-reason). This is ACTUAL LABOR — a
-- separate number from the calendar clocks — feeding estimate→actual reconciliation and profile self-correction.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_seconds INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_measured_seconds INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_adjust_reason TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_finalized INTEGER DEFAULT 0;

-- =====================================================================================================
-- PHASE 7 / WS5 — THE REQUESTOR-LEDGER (docs/rules_research/workflow/DESIGN_requestor_ledger.md).
--
-- The parent request is a PER-REQUEST financial processor, and a family of statutes is about state that
-- CROSSES requests: "unpaid fees from previous requests" (TX § 552.263(c) > $100, OK, GA, MA, MI, UT, WI),
-- "36 hours of free staff time per requestor per 12 months" (TX § 552.275), "at least 7 requests in the
-- last 7 days" (IL recurrent), "10 physical deliveries per month" (OH). A per-request parent cannot hold
-- any of it. These tables are that one mechanism, sitting BESIDE the parent processors, never above them.
--
-- MVP is CLASS A — the balance ledger — built fully and fed by events from the parent processor. Classes
-- B/C/D (allowances, counters/history, flags) ship as config stubs with manual values: every knob, notice
-- and timer exists, so a staff-entered number produces fully compliant output; only the automatic COUNTING
-- is deferred until a city elects those regimes (Kevin, 2026-07-26, decision 2).
-- =====================================================================================================

-- The identity anchor. Created lazily, and ONLY on an affirmative anchor — a portal account, a verified
-- email, or a staff-confirmed walk-in. Never fuzzy-matched: most states forbid conditioning access on
-- identity, so an adverse trigger fired on a guessed match would deny a right on a coincidence of names.
CREATE TABLE IF NOT EXISTS requestor_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  primary_email TEXT,
  portal_account_id TEXT,
  identity_basis TEXT,                 -- portal_account | verified_email | staff_confirmed
  class_attestations TEXT,             -- JSON: news_media / elected_official / legal_aid / scholar (+ artifact)
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_requestor_email ON requestor_profiles (lower(primary_email)) WHERE primary_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_requestor_portal ON requestor_profiles (portal_account_id) WHERE portal_account_id IS NOT NULL;

-- Which profile a request was anchored to, and HOW — or that it was not anchored at all. The row is
-- written either way: "we looked and this request is anonymous" is a fact worth keeping, because it is the
-- reason no adverse trigger fired.
CREATE TABLE IF NOT EXISTS requestor_request_links (
  request_id TEXT PRIMARY KEY,
  profile_id TEXT,                     -- NULL = anonymous / no affirmative anchor
  identity_basis TEXT,
  reason TEXT,
  linked_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_rrl_profile ON requestor_request_links (profile_id);

-- CLASS A. The balance is EVENTED, never recomputed from the parents at read time: an A/R figure that a
-- deposit demand is based on has to be reconstructable, and a live SUM over mutable request rows is not.
CREATE TABLE IF NOT EXISTS requestor_ledger_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  request_id TEXT,
  type TEXT NOT NULL,                  -- invoiced | paid | credited | waived | written_off | closed_nonpayment
  amount NUMERIC,
  reason TEXT,
  source TEXT,                         -- the payment event that produced it
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_rle_profile ON requestor_ledger_events (profile_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rle_source ON requestor_ledger_events (source) WHERE source IS NOT NULL;

-- CLASS B stub — named period accumulators (TX § 552.275: >= 36 hrs / 12 months, >= 15 hrs / month).
CREATE TABLE IF NOT EXISTS requestor_allowances (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT,                           -- hours | records | requests
  -- `window` is a RESERVED WORD in Postgres (the window-function clause), so it cannot be a bare column
  -- name here. Named `window_spec` rather than quoted, so nothing downstream has to remember to quote it.
  window_spec TEXT,                    -- rolling_12_months | calendar_month | rolling_n_days
  allowance NUMERIC,
  consumed NUMERIC DEFAULT 0,
  period_start TEXT,
  source TEXT DEFAULT 'manual',        -- manual until a city elects the regime; then 'evented'
  updated_by TEXT,
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_req_allowance ON requestor_allowances (profile_id, name);

-- CLASS C stub — request-frequency counters (IL recurrent 12mo/30d/7d, OH 10 deliveries/month).
CREATE TABLE IF NOT EXISTS requestor_counters (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  window_spec TEXT,                    -- see the note on requestor_allowances: `window` is reserved
  count INTEGER DEFAULT 0,
  period_start TEXT,
  source TEXT DEFAULT 'manual',
  updated_by TEXT,
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_req_counter ON requestor_counters (profile_id, name);

-- CLASS D stub — time-boxed status flags. The system RECORDS and APPLIES an externally-established status
-- until it expires or its clearing event arrives; it never decides one. The OH vexatious list is the
-- court's, the UT designation is the director's order, and MI's increased deposit MUST stop the moment the
-- requestor proves payment — which is why `clearing_event` is a column and not a comment.
CREATE TABLE IF NOT EXISTS requestor_flags (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  flag TEXT NOT NULL,                  -- vexatious | increased_deposit | recurrent | prisoner
  source TEXT,                         -- court_order | director_order | proof_of_nonpayment | computed
  citation TEXT,
  set_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  expires_at TEXT,
  cleared_at TEXT,
  clearing_event TEXT,
  note TEXT,
  set_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_req_flag ON requestor_flags (profile_id, flag);

-- PHASE 7 / BW2 — WHY A TASK EXISTS, recorded on the task itself.
--
-- `intake_review` is TRIGGER-spawned, not stage-spawned (DRAFT_processing_ui_intake_review §0.5): a JSON
-- array of trigger keys from services/intakeReview.js TRIGGERS. The queue's "Why it's here" column and the
-- screen's "Here because:" line read it, and the auto-close-on-route inherited from `routing_review` reads
-- it too — a task raised ONLY because the team could not be determined is finished when the team is
-- determined; one raised for other reasons as well is not.
--
-- Nullable and generic on purpose: any future trigger-spawned type can use the same column rather than
-- growing a parallel one, and every existing row keeps meaning exactly what it meant (no trigger recorded).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS spawn_triggers TEXT;

-- PHASE 7 / BW3 — THE STRUCTURED ELIGIBILITY FINDING (DRAFT_processing_ui_intake_review.md §4.5).
--
-- Until now an eligibility evaluation persisted ONLY as a prose `request_history` note
-- (ELIGIBILITY_REVIEW / ELIGIBILITY_ADVISORY, written by services/requestCreate.js). Prose is fine for an
-- audit trail and useless for three things the intake screen needs:
--   * SPAWN TIME — "did a review come back?" is trigger (ii) of intake_review, and it has to be answerable
--     without regex-ing an English sentence written for a human.
--   * RENDER TIME — the panel draws advisories ghost/dashed and reviews amber-with-a-confirm-button
--     (rule c). That is a per-dimension distinction the summary string flattens.
--   * THE CONFIRM — a review is CLOSED by a named person. There is nowhere on a history row to record that
--     against the finding it answers.
-- So the evaluation is written here as rows AS WELL AS the note. The note is not replaced: it is the audit
-- trail, and rewriting history for a new read model would be the wrong trade.
--
-- `finding_class` is the evaluator's own three-way split (blocks / reviews / advisories). A `block` never
-- reaches this table today — a blocked submission is refused at the portal before a row exists — but the
-- class is stored rather than inferred so a future recorded-block has a home and nothing has to guess.
--
-- CONFIRMATION IS THE PERSON'S, NOT THE CONFIG'S. `config_confirmed` is whether the CITY confirmed the
-- dimension (eligibilityGate's gate-4 test); `confirmed_at`/`confirmed_by` are whether a REVIEWER cleared
-- this finding on this request. Two different facts that a single `confirmed` column would silently merge.
CREATE TABLE IF NOT EXISTS request_eligibility_findings (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  dimension TEXT NOT NULL,             -- residency | identity | purpose | requester_class | incarceration | vexatious
  finding_class TEXT NOT NULL,         -- block | review | advisory
  label TEXT,
  action TEXT,                         -- the city's configured action: advise | route_review | block
  config_confirmed INTEGER DEFAULT 0,  -- did the CITY confirm the dimension
  fact_known INTEGER DEFAULT 0,        -- did the submission carry the fact at all
  why TEXT,                            -- the evaluator's sentence for this finding
  note TEXT,                           -- the dimension's standing help text
  source_rule_ids TEXT,                -- JSON array of imported rule ids
  evaluated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  confirmed_at TEXT,                   -- the REVIEWER's act (reviews only)
  confirmed_by TEXT,
  confirm_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_elig_finding_request ON request_eligibility_findings (request_id);
-- One row per dimension per request: re-evaluating a request updates its findings rather than stacking a
-- second opinion beside the first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_elig_finding_req_dim ON request_eligibility_findings (request_id, dimension);

-- PHASE 7 / BW3 — THE RECORD OWNER, per request (DRAFT_processing_ui_intake_review.md §0b.5).
--
-- The EditInfoFrame's three dropdowns correct three AI-produced facts: the classification
-- (`record_type_id`, already a column), the routed fulfillment TEAM (`department_id`, already a column) and
-- the OWNING CITY DEPARTMENT — which had nowhere to live. The taxonomy carries an owner per record TYPE
-- (`record_type_departments.role = 'owner'`, read by services/classifier.js), but that is the type's
-- default, not this request's fact: a reviewer correcting "Public Works, not Parks" on ONE request must not
-- rewrite the taxonomy for every future request of that type.
--
-- Nullable, and read by nothing else yet: it is context that travels with the item (it shows on the item
-- for whoever searches it) plus the reviewer's correction of it, recorded. When a later workstream wants a
-- request-level owner, this is it — rather than a second column meaning the same thing.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS record_owner_department_id TEXT;

-- PHASE 7 / BW4 — THE COMMERCIAL-RATE CLASSIFICATION, PERSISTED.
--
-- BW3 shipped the intake screen's commercial panel with an honest confession printed on it: "recording a
-- classification is not built yet, so this does not block Proceed." That was literally true — nothing in
-- the system persisted a classification (no column, no history action, no task outcome), so
-- `approvalModules.evaluateCommercial` returned `needs_decision` forever and a gate on it would have been a
-- stop no act could clear. See the ⚠ block in services/intakeReview.proceedGate.
--
-- This is the classification's home. Four facts, deliberately separate:
--   commercial_classification       what the CITY concluded: 'commercial' | 'standard'. NULL = undecided,
--                                   which is not the same as 'standard' — the requester's own DECLARATION
--                                   lives in `purpose` and is not overwritten here. Overriding a
--                                   declaration must be communicated (design doc), and that comparison is
--                                   only possible while both values survive.
--   commercial_classified_by/_at    a PERSON's act, named and dated (rule c: the system never decides a
--                                   judgment call). NJ/IL change the response clock on this classification,
--                                   so "who said so, and when" is the audit answer to a moved deadline.
--   commercial_classification_note  why — travels to the requester when the classification overrides what
--                                   they declared.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS commercial_classification TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS commercial_classified_by TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS commercial_classified_at TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS commercial_classification_note TEXT;

-- PHASE 7 / BW4 — THE ESTIMATE TASK'S PAUSE (DRAFT_processing_ui_estimate.md §4.1).
--
-- Marking a request VAGUE pauses the estimate task: you cannot price what you cannot parse, and the
-- estimator who could not scope it has just discovered the vagueness. The reply resumes it. (Overly Broad
-- deliberately does NOT pause — "too large is not a mark, it IS the estimate", Kevin 2026-07-28.)
--
-- WHY A COLUMN AND NOT A `paused` STATUS. Every actionable-task query in this codebase is spelled
-- `status IN ('open','assigned','in_progress','returned','awaiting_review')` — twenty-odd of them, in the
-- queue, the router, the close-on-route path, the notice/send sweep that closes the estimate task. A new
-- status value would silently drop a paused task out of ALL of them, including the sweep that closes it,
-- which is exactly the "stranded estimate task" the hard rule forbids. A nullable marker beside the status
-- changes nothing anywhere that does not read it: every existing row is `paused_at IS NULL` = not paused,
-- and a task paused by a deploy of this column is still claimable, still closable, still routable.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS paused_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS paused_reason TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS paused_by TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 7 / BW5 — CLOSE, DISPOSITION, THE AUTO-RELEASE PIPELINE, REOPEN, AND THE RM-HOLD GUARD.
-- (docs/DRAFT_processing_ui_disposition_close.md rev 2 · docs/SPEC_processing_ui.md §4)
--
-- Every column below is nullable or defaulted, and every default is TODAY'S BEHAVIOUR. A live install that
-- deploys this and confirms nothing behaves exactly as it did: no request auto-ships, no hold changes, no
-- close is refused that was not already refused.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

-- THE RELEASE EVENT'S THREE FACTS. `Closed – Delivered` is WRITTEN BY the release event and never asserted
-- by a person (rev 2 constant), so the event's own record has to live on the row: when it shipped, and as
-- which installment. `installment_no` is 1 for the ordinary single-delivery request — n>1 exists because
-- WA/TX/CA installment production is per-record, and a notice that says "installment 2" has to be able to
-- prove which one it was.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS delivered_at TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS installment_no INTEGER;

-- REOPEN (Director authority, required note, resume-point choice). Counted, not just flagged: a request
-- reopened four times is a fact a city should be able to see. CLOCKS ARE NEVER RESET — there is deliberately
-- no clock column here, and the original history stands (decided 7/29).
ALTER TABLE requests ADD COLUMN IF NOT EXISTS reopened_at TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS reopen_count INTEGER DEFAULT 0;

-- THE RM HOLD OF A READY RECORD (§5.9 — NEVER a payment hold; feeRelease owns money gating and is not
-- double-gated here). A hold is a named state with a note, exactly like every other stop in the product:
-- spec §2.4's "no manual hold anywhere" bans the UNNAMED hold, not the recorded one.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS release_hold INTEGER DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS release_hold_note TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS release_hold_by TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS release_hold_at TEXT;

-- THE INSTALLMENT REQUEST ON FILE. This is the fact the prevention guard turns on: in a jurisdiction with
-- the installment ENTITLEMENT, a requester who has asked for installments cannot lawfully be made to wait
-- for the whole production, so the hold control is disabled with the citation shown — and an installment
-- request arriving mid-hold AUTO-LIFTS the hold and notifies the RM. Statute on verified facts (the same
-- asymmetry as the mandatory fee waiver), which is why it may act without a person.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS installment_requested_at TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS installment_requested_note TEXT;

-- A TASK THAT WAS BYPASSED IS STILL A RECORD, NEVER A SILENT SKIP (rev 2 §2, the pipeline's hard rule).
-- The auto-release evaluator may only treat a step as terminal if it was completed by a person OR bypassed
-- WITH A BASIS. These two columns are that basis: `bypass_kind` is the DecidedByBadge value (rule c —
-- 'statute' | 'system_condition' | 'recorded'), `bypass_basis` the sentence a later reader needs.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS bypass_kind TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS bypass_basis TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS bypassed_at TEXT;

-- CLOSE PENDING APPROVAL — the visible state, not just a task.
--
-- The lightweight approval TASK is how the close reaches a supervisor; this row is what makes "Close
-- pending approval" a thing the queue, the bars and the disposition record can all render, and what
-- carries the evidence snapshot so the approver sees the gate AS IT STOOD when the close was requested.
-- `requested_by` exists for one rule: the approver must differ from the requester (a weaker, different rule
-- than two-eyes — see services/disposition.js).
CREATE TABLE IF NOT EXISTS request_close_approvals (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  task_id TEXT,
  approval_task_id TEXT,
  ending TEXT NOT NULL,
  payload_json TEXT,
  gate_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  requested_by_name TEXT,
  requested_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  decided_by TEXT,
  decided_by_name TEXT,
  decided_at TEXT,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_close_approvals_request ON request_close_approvals(request_id, status);
CREATE INDEX IF NOT EXISTS idx_close_approvals_task ON request_close_approvals(approval_task_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 7 / BW6 — THE MRR MANAGEMENT HUB.
-- (docs/DRAFT_processing_ui_mrr_hub.md rev 5b + §0b · docs/SPEC_processing_ui.md §3 screen 5)
--
-- `mrr_management` tasks ALREADY EXIST on live installs (requestCreate spawns one on child_count > 1);
-- what they have never had is a screen. Everything below gives them one. Every column is nullable or
-- defaulted and nothing here changes an existing row's meaning: a live install that deploys this and
-- opens nothing behaves exactly as it did.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

-- ── THE CHILD ACTIVITY RECORD, AND WHY IT IS NOT A FLOW TASK ─────────────────────────────────────
--
-- Kevin, 7/28: the MRR search / estimate / redaction work "does not move forward in a process". That is
-- a STRUCTURAL claim, not a UI one, so it is enforced by where the row lives: an `mrr_tasks` row is an
-- ACTIVITY on one child record, and completing it writes here and nowhere else. It is deliberately NOT
-- an `applyStageTransition` consumer — no stage advance, no spawnForStage, no pipeline read. The
-- manager, not the engine, moves an MRR along.
--
-- `task_id` points at the ordinary hand-assigned `tasks` row (type mrr_search / mrr_estimate /
-- mrr_redaction) that puts the work on the assignee's My Tasks. Two rows for one activity is on purpose:
-- the `tasks` row is how a person FINDS the work; this row is what the work MEANS. Completing the
-- activity closes the task; closing the task does not advance anything.
--
-- `status` is the honest five-value set the bars render: not_started · queued · in_process · complete ·
-- not_required. `not_started` and `not_required` are different facts and the draft is explicit that both
-- must show — "nothing has been asked for yet" is not "nothing is needed".
CREATE TABLE IF NOT EXISTS mrr_tasks (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,  -- the CHILD record (the item)
  parent_request_id TEXT,                                              -- its master, denormalised for the hub read
  activity TEXT NOT NULL,                                              -- 'search' | 'estimate' | 'redaction'
  status TEXT NOT NULL DEFAULT 'not_started',
  task_id TEXT,                                                        -- the hand-assigned tasks row, if spawned
  assignee_id TEXT,
  assignee_name TEXT,
  assignment_basis TEXT,                                               -- 'manual' | 'self' | 'external'
  external_email TEXT,                                                 -- external contributor, if that is the shape
  not_required_reason TEXT,
  note TEXT,
  spawned_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  completed_by TEXT,
  completed_by_name TEXT,
  completion_basis TEXT,                                               -- 'person' | 'fulfilling_record'
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mrr_tasks_item_activity ON mrr_tasks(request_id, activity);
CREATE INDEX IF NOT EXISTS idx_mrr_tasks_parent ON mrr_tasks(parent_request_id);
CREATE INDEX IF NOT EXISTS idx_mrr_tasks_task ON mrr_tasks(task_id);

-- ── ESTIMATE DATA, PER CHILD — THE READINESS METER'S NUMERATOR ───────────────────────────────────
--
-- Kevin, 7/28 item 7: the master card says whether ALL child estimate data is complete, and only then
-- does Generate Estimate arm. So "complete" has to be a per-child FACT somebody wrote, not an inference
-- from an activity status — a searcher marking their activity done is not the same as the estimate
-- numbers existing. One row per child; `complete` is the meter's unit.
--
-- These figures feed the STANDARD estimate engine at the master level (§6.4). Nothing here prices
-- anything by itself: this is gathered data, and one estimate is generated for the master record.
CREATE TABLE IF NOT EXISTS mrr_estimate_data (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,  -- the CHILD record
  parent_request_id TEXT,
  labor_minutes INTEGER,
  page_count INTEGER,
  media_count INTEGER,
  other_cost NUMERIC,
  estimated_cost NUMERIC,
  notes TEXT,
  complete INTEGER DEFAULT 0,
  entered_by TEXT,
  entered_by_name TEXT,
  entered_at TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mrr_estdata_item ON mrr_estimate_data(request_id);
CREATE INDEX IF NOT EXISTS idx_mrr_estdata_parent ON mrr_estimate_data(parent_request_id);

-- ── DENIAL DESIGNATION AT THE CHILD LEVEL — A FLAG, NEVER AN ENDING ──────────────────────────────
--
-- Kevin, 7/28 item 6: "designate denial at the child level AND submit for Legal Review". The draft is
-- emphatic that DESIGNATION IS NOT A DENIAL — it spawns `legal_review` with the manager's grounds
-- attached, legal decides, and BW5's deny-close-notify writes the ending if it is upheld. These columns
-- therefore record a REFERRAL, and there is deliberately no column here that could close anything.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mrr_denial_designated INTEGER DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mrr_denial_grounds TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mrr_denial_by TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mrr_denial_at TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mrr_denial_legal_task_id TEXT;
