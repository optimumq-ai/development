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
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, request_number TEXT UNIQUE NOT NULL, is_mrr INTEGER DEFAULT 0, master_request_id TEXT, component_label TEXT, requestor_name TEXT NOT NULL, requestor_email TEXT NOT NULL, requestor_phone TEXT, requestor_type TEXT DEFAULT 'individual', delivery_method TEXT DEFAULT 'email', description TEXT NOT NULL, record_types TEXT, classification TEXT DEFAULT 'standard', department_id TEXT, assigned_to TEXT, stage TEXT DEFAULT 'intake', status TEXT DEFAULT 'active', closure_reason TEXT,
 fee_waiver_requested INTEGER DEFAULT 0, estimated_fee DOUBLE PRECISION DEFAULT 0, actual_fee DOUBLE PRECISION DEFAULT 0, amount_paid DOUBLE PRECISION DEFAULT 0, legal_flag INTEGER DEFAULT 0, legal_flag_type TEXT, deadline_date TEXT, submission_channel TEXT DEFAULT 'portal', created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS request_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, details TEXT, notes TEXT, stage_from TEXT, stage_to TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS fee_matrix (id TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT, rate DOUBLE PRECISION NOT NULL, unit TEXT NOT NULL, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS request_files (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, filename TEXT NOT NULL, original_name TEXT NOT NULL, mimetype TEXT, size INTEGER, status TEXT DEFAULT 'attached', responsive INTEGER DEFAULT 0, uploaded_by TEXT, uploaded_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS agent_rules (id TEXT PRIMARY KEY, rule_text TEXT NOT NULL, enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 100, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), created_by TEXT);
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
