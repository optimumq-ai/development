-- Taxonomy core schema (DRAFT for review). Conventions match schema.postgres.sql:
-- TEXT primary keys, INTEGER booleans, TEXT timestamps via to_char, lists stored as TEXT(JSON).
-- All additive (new tables only). FKs left implicit/app-enforced, matching existing schema.
-- NOT yet applied to the live DB and NOT yet wired into the boot schema.

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
