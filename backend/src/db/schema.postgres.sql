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
 fee_waiver_requested INTEGER DEFAULT 0, estimated_fee DOUBLE PRECISION DEFAULT 0, actual_fee DOUBLE PRECISION DEFAULT 0, amount_paid DOUBLE PRECISION DEFAULT 0, legal_flag INTEGER DEFAULT 0, legal_flag_type TEXT, deadline_date TEXT, submission_channel TEXT DEFAULT 'portal', created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS request_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, details TEXT, notes TEXT, stage_from TEXT, stage_to TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS fee_matrix (id TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT, rate DOUBLE PRECISION NOT NULL, unit TEXT NOT NULL, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS request_files (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, filename TEXT NOT NULL, original_name TEXT NOT NULL, mimetype TEXT, size INTEGER, status TEXT DEFAULT 'attached', responsive INTEGER DEFAULT 0, uploaded_by TEXT, uploaded_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS agent_rules (id TEXT PRIMARY KEY, rule_text TEXT NOT NULL, enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 100, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), created_by TEXT);
CREATE TABLE IF NOT EXISTS demo_911_calls (seq BIGSERIAL PRIMARY KEY, call_id TEXT, call_type TEXT, priority TEXT, received_at TEXT, caller_name TEXT, caller_phone TEXT, caller_address TEXT, incident_location TEXT, responding_units TEXT, disposition TEXT, narrative TEXT, created_at TEXT, pulled INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS demo_documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, body TEXT, department TEXT, doc_type TEXT, date_created TEXT, page_count INTEGER, public_availability TEXT DEFAULT 'available', tags TEXT);
CREATE TABLE IF NOT EXISTS email_verifications (token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), verified_at TEXT, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS record_repositories (id TEXT PRIMARY KEY, name TEXT NOT NULL, connector_type TEXT NOT NULL, status TEXT DEFAULT 'active', config TEXT DEFAULT '{}', sort_order INTEGER DEFAULT 100, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS request_selected_records (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, record_id TEXT NOT NULL, title TEXT, source_system TEXT, public_availability TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE INDEX IF NOT EXISTS idx_demodocs_title ON demo_documents(title);
CREATE INDEX IF NOT EXISTS idx_emailverif_email ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_files_request ON request_files(request_id);
CREATE INDEX IF NOT EXISTS idx_requests_dept ON requests(department_id);
CREATE INDEX IF NOT EXISTS idx_requests_stage ON requests(stage);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
ALTER TABLE record_types ADD COLUMN IF NOT EXISTS auto_publish INTEGER DEFAULT 0;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS published INTEGER DEFAULT 0;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS published_at TEXT;
ALTER TABLE fulfilled_records ADD COLUMN IF NOT EXISTS published_by TEXT;
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
  request_id TEXT NOT NULL,
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
INSERT INTO onboarding_progress (phase_key, phase_order, title) VALUES
  ('jurisdiction', 0, 'Jurisdiction Profile'),
  ('departments', 1, 'City Departments'),
  ('teams',       2, 'Request Fulfillment Teams'),
  ('ownership',   3, 'Record Ownership'),
  ('repositories',4, 'Repositories & Discovery'),
  ('redaction',   5, 'Redaction Readiness')
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

-- Parent/child: every scope predicate filters on master_request_id (see services/requestScope.js), so it
-- needs an index or every list query degrades to a sequential scan once children exist.
CREATE INDEX IF NOT EXISTS ix_requests_master ON requests (master_request_id);

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
